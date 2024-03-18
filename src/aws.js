const dotenv = require('dotenv');
dotenv.config();
const AWS = require('aws-sdk')

AWS.config.update({
	accessKeyId: process.env.AWS_ACCESS_KEY,
	secretAccessKey: process.env.AWS_SECRET_KEY,
	region: process.env.AWS_REGION
});

const dynamoDB = new AWS.DynamoDB();
const s3Client = new AWS.S3();
const cognitoServiceProvider = new AWS.CognitoIdentityServiceProvider();
const documentClient = new AWS.DynamoDB.DocumentClient();

module.exports = {
	dynamoDB,
	s3Client,
	cognitoServiceProvider,
	documentClient,
}