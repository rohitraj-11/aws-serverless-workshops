const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const Jimp = require('jimp');
const crypto = require('crypto');

// Security-focused configuration
const CONFIG = {
    maxWidth: Math.min(parseInt(process.env.MAX_WIDTH) || 250, 2000), // Limit max size
    maxHeight: Math.min(parseInt(process.env.MAX_HEIGHT) || 250, 2000),
    quality: Math.min(parseInt(process.env.IMAGE_QUALITY) || 80, 100),
    thumbnailBucket: process.env.THUMBNAIL_BUCKET,
    maxFileSize: 15 * 1024 * 1024, // 15MB max file size
    allowedMimeTypes: new Set(['image/jpeg', 'image/png', 'image/gif']),
};
// Initialize S3 client with secure configuration
const s3Client = new S3Client({
    maxAttempts: 3,
    requestTimeout: 5000,
    followRegionRedirects: false // Prevent SSRF
});
/**
 * Validates and sanitizes the input parameters
 * @param {Object} event - The Lambda event object
 * @throws {Error} If validation fails
 */
const validateInput = (event) => {
    // Required parameters check
    if (!event.s3Bucket || !event.s3Key) {
        throw new Error('Missing required parameters');
    }

    // Validate destination bucket
    if (!CONFIG.thumbnailBucket) {
        throw new Error('Destination bucket not configured');
    }

    // S3 key validation
    const keyPattern = /^[a-zA-Z0-9!_.*'()-\/]+$/;
    if (!keyPattern.test(event.s3Key)) {
        throw new Error('Invalid characters in S3 key');
    }

    // Path traversal prevention
    if (event.s3Key.includes('..')) {
        throw new Error('Path traversal detected');
    }

    // Length limits
    if (event.s3Key.length > 1024) {
        throw new Error('S3 key exceeds maximum length');
    }
};

/**
 * Safely converts a stream to buffer with size limits
 * @param {ReadableStream} stream - The input stream
 * @returns {Promise<Buffer>} The resulting buffer
 */
const streamToBuffer = async (stream) => {
    const chunks = [];
    let totalSize = 0;

    for await (const chunk of stream) {
        totalSize += chunk.length;
        if (totalSize > CONFIG.maxFileSize) {
            throw new Error('File size exceeds maximum limit');
        }
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
};

/**
 * Generates a secure filename for the thumbnail
 * @param {string} originalKey - Original S3 key
 * @returns {string} Secure filename
 */
const generateSecureFilename = (originalKey) => {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const extension = originalKey.split('.').pop().toLowerCase();
    return `${timestamp}-${random}.${extension}`;
};

/**
 * Processes the image securely
 * @param {Buffer} imageBuffer - The input image buffer
 * @returns {Promise<{buffer: Buffer, mime: string}>}
 */
const processImage = async (imageBuffer) => {
    // Validate buffer size
    if (imageBuffer.length > CONFIG.maxFileSize) {
        throw new Error('Input file too large');
    }

    let image;
    try {
        image = await Jimp.read(imageBuffer);
    } catch (error) {
        throw new Error('Invalid image format');
    }

    // Validate mime type
    const mime = image.getMIME();
    if (!CONFIG.allowedMimeTypes.has(mime)) {
        throw new Error('Unsupported image type');
    }

    // Get dimensions with bounds checking
    const originalWidth = Math.min(image.getWidth(), 10000);
    const originalHeight = Math.min(image.getHeight(), 10000);

    // Calculate safe dimensions
    const scalingFactor = Math.min(
        CONFIG.maxWidth / originalWidth,
        CONFIG.maxHeight / originalHeight,
        1
    );

    const width = Math.round(scalingFactor * originalWidth);
    const height = Math.round(scalingFactor * originalHeight);

    // Process image
    if (width < originalWidth || height < originalHeight) {
        image.resize(width, height);
    }

    image.quality(CONFIG.quality);

    return {
        buffer: await image.getBufferAsync(Jimp.AUTO),
        mime: mime
    };
};

exports.handler = async (event) => {
    try {
        // Sanitize logging
        console.log('Processing event:', JSON.stringify(sanitizeLogData(event)));
        
        // Validate input
        validateInput(event);

        // Decode S3 key safely
        const srcKey = decodeURIComponent(event.s3Key.replace(/\+/g, ' '));

        // Get object from S3
        let imageBuffer;
        try {

            const { Body, ContentType } = await s3Client.send(new GetObjectCommand({
                Bucket: event.s3Bucket,
                Key: srcKey
            }));

            // Validate content type early
            if (!CONFIG.allowedMimeTypes.has(ContentType)) {
                throw new Error('Invalid content type');
            }

            imageBuffer = await streamToBuffer(Body);
        } catch (error) {
            console.error('S3 fetch error:', sanitizeError(error));
            throw new Error('Failed to fetch image');
        }

        // Process image
        const { buffer: resizedBuffer, mime } = await processImage(imageBuffer);

        // Generate secure filename
        const destKey = generateSecureFilename(srcKey);

        // Upload to S3 with security headers
        try {

            await s3Client.send(new PutObjectCommand({
                Bucket: CONFIG.thumbnailBucket,
                Key: `${event.userId}/${destKey}`,
                Body: resizedBuffer,
                ContentType: mime,
                CacheControl: 'public, max-age=31536000',
                ContentDisposition: 'inline',
                Metadata: {
                    'original-key': srcKey,
                    'processing-date': new Date().toISOString(),
                    'content-security-policy': "default-src 'none'; img-src 'self'"
                }

            }));

        } catch (error) {
            console.error('S3 upload error:', sanitizeError(error));
            throw new Error('Failed to upload thumbnail');
        }

        return {
            statusCode: 200,
            thumbnail: {
                s3key: `${event.userId}/${destKey}`,
                s3bucket: CONFIG.thumbnailBucket,
                contentType: mime
            }
        };

    } catch (error) {
        console.error('Error:', sanitizeError(error));
        
        return {
            statusCode: 500,
            error: {
                message: 'Image processing failed',
                type: error.name
            }
        };
    }
};

/**
 * Sanitizes data for logging
 * @param {Object} data - Data to sanitize
 * @returns {Object} Sanitized data
 */
const sanitizeLogData = (data) => {
    const sanitized = { ...data };
    // Remove sensitive fields
    delete sanitized.credentials;
    delete sanitized.authorization;
    return sanitized;
};

/**
 * Sanitizes error messages for logging
 * @param {Error} error - Error to sanitize
 * @returns {Object} Sanitized error
 */
const sanitizeError = (error) => {
    return {
        message: error.message,
        type: error.name,
        // Don't include stack trace in production
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
};
