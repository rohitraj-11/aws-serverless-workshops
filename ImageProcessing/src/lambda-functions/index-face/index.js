const util = require('util');
const { RekognitionClient, IndexFacesCommand } = require("@aws-sdk/client-rekognition");

const rekognition = new RekognitionClient();

exports.handler = async (event, context) => {
    try {
        const srcBucket = event.s3Bucket;
        // Object key may have spaces or unicode non-ASCII characters.
        const srcKey = decodeURIComponent(event.s3Key.replace(/\+/g, " "));

        const params = {
            CollectionId: process.env.REKOGNITION_COLLECTION_ID,
            DetectionAttributes: [],
            ExternalImageId: event.userId,
            Image: {
                S3Object: {
                    Bucket: srcBucket,
                    Name: srcKey
                }
            }
        };

        const command = new IndexFacesCommand(params);
        const data = await rekognition.send(command);
        
        return data.FaceRecords[0].Face;

    } catch (err) {
        console.error('Error:', err);
        throw err;
    }
};
