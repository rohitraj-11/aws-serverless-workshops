const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const util = require('util');

const tableName = process.env.RIDER_PHOTOS_DDB_TABLE;

const client = new DynamoDBClient({
    region: process.env.AWS_REGION
});
const docClient = DynamoDBDocumentClient.from(client);

exports.handler = async (event, context) => {
    console.log("Reading input from event:\n", util.inspect(event, {depth: 5}));

    const dynamoItem = {
        userId: event.userId,
        s3key: event.s3Key,
        s3bucket: event.s3Bucket
    };

    const indexDetails = event['parallelResult'][0];
    const thumbnailDetails = event['parallelResult'][1];
    dynamoItem['faceId'] = indexDetails['FaceId'];
    dynamoItem['thumbnail'] = thumbnailDetails['thumbnail'];

    try {
        const command = new PutCommand({
            TableName: tableName,
            Item: dynamoItem
            // uncomment below if you want to disallow overwriting if the user is already in the table
            // ,ConditionExpression: 'attribute_not_exists (Username)'
        });
        const data = await docClient.send(command);
        return data;
    } catch (err) {
        throw err;
    }
};
