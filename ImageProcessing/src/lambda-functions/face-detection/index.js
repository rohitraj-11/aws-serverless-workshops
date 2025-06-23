const util = require('util');
const { RekognitionClient, DetectFacesCommand } = require("@aws-sdk/client-rekognition");

// Initialize the Rekognition client
const rekognition = new RekognitionClient();

exports.handler = async (event, context) => {
    try {
        console.log("Reading input from event:\n", util.inspect(event, {depth: 5}));

        const srcBucket = event.s3Bucket;
        // Object key may have spaces or unicode non-ASCII characters.
        const srcKey = decodeURIComponent(event.s3Key.replace(/\+/g, " "));

        const params = {
            Image: {
                S3Object: {
                    Bucket: srcBucket,
                    Name: srcKey
                }
            },
            Attributes: ['ALL']
        };

        // Create command and send request
        const command = new DetectFacesCommand(params);
        const data = await rekognition.send(command);
        
        console.log("Detection result from rekognition:\n", util.inspect(data, {depth: 5}));

        if (data.FaceDetails.length != 1) {
            throw new PhotoDoesNotMeetRequirementError("Detected " + data.FaceDetails.length + " faces in the photo.");
        }
        
        if (data.FaceDetails[0].Sunglasses.Value === true) {
            throw new PhotoDoesNotMeetRequirementError("Face is wearing sunglasses");
        }

        var detectedFaceDetails = data.FaceDetails[0];
        // remove some fields not used in further processing to de-clutter the output.
        delete detectedFaceDetails['Landmarks'];

        return detectedFaceDetails;

    } catch (err) {
        console.log(err);
        if (err.name === "ImageTooLargeException") {
            throw new PhotoDoesNotMeetRequirementError(err.message);
        }
        if (err.name === "InvalidImageFormatException") {
            throw new PhotoDoesNotMeetRequirementError("Unsupported image file format. Only JPEG or PNG is supported");
        }
        throw err;
    }
};

class PhotoDoesNotMeetRequirementError extends Error {
    constructor(message) {
        super(message);
        this.name = "PhotoDoesNotMeetRequirementError";
    }
}