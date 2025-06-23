const util = require('util');
const { RekognitionClient, SearchFacesByImageCommand } = require("@aws-sdk/client-rekognition");

const rekognition = new RekognitionClient();

exports.handler = async (event, context) => {
    try {
        console.log("Reading input from event:\n", util.inspect(event, {depth: 5}));

        const srcBucket = event.s3Bucket;
        // Object key may have spaces or unicode non-ASCII characters.
        const srcKey = decodeURIComponent(event.s3Key.replace(/\+/g, " "));

        const params = {
            CollectionId: process.env.REKOGNITION_COLLECTION_ID,
            Image: {
                S3Object: {
                    Bucket: srcBucket,
                    Name: srcKey
                }
            },
            FaceMatchThreshold: 95.0,
            MaxFaces: 3
        };

        const command = new SearchFacesByImageCommand(params);
        const data = await rekognition.send(command);
        console.log("Face search result: ",data)
        if (data.FaceMatches.length > 0) {
            throw new FaceAlreadyExistsError();
        }
        return null;

    } catch (err) {
        if (err instanceof FaceAlreadyExistsError) {
            throw err;
        }
        console.error('Error:', err);
        throw err;
    }
};

class FaceAlreadyExistsError extends Error {
    constructor() {
        super("Face in the picture is already in the system.");
        this.name = "FaceAlreadyExistsError";
    }
}
