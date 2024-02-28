const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const bodyParser = require('body-parser');
const {
	cognitoServiceProvider,
	dynamoDB,
	s3Client,
	documentClient
} = require('./aws.js')

const app = express();
const PORT = process.env.PORT || 3000;
const bcrypt = require("bcrypt");
const uuid = require("uuid").v4;
const jwt = require("jsonwebtoken")

// Middleware to parse JSON request body
app.use(bodyParser.json());

// Endpoint for company sign-up
app.post('/api/company/sign_up', async (req, res) => {
    const { username, email, password, fullName } = req.body;
	const hashedPassword = await bcrypt.hash(password, 10)

	const params = {
		DesiredDeliveryMediums: [
		   "SMS"
		],
		MessageAction: "SUPPRESS",
		UserAttributes: [
		{
		  Name: "email",
		  Value: email
		 }
		],
		UserPoolId: process.env.AWS_USER_POOL_ID_COMPANIES,
		Username: username
	   }

	cognitoServiceProvider.adminCreateUser(params, (err, data) => {
		if (err) {
			console.error('Error signing up:', err);
			return res.status(500).json({ error: 'Failed to sign up user' });
		}
	})

	const companyRep = {
		fullName,
		id: uuid(),
		email,
		password: hashedPassword
	}
	let dynamoDBParams = {
		TableName: 'companies-details-table',
		Item: companyRep
	}

	documentClient.put(dynamoDBParams, (err, data) => {
		if (err) {
			console.error('Error signing up:', err);
			return res.status(500).json({ error: 'Failed to save user data' });
		}

		 // User signed up successfully
		 const secretKey = process.env.JWT_KEY
		 const token = jwt.sign({companyRep}, secretKey, { expiresIn: "1h" });

		 res.status(200).json({
			message: 'User signed up successfully',
			token
		 });
	})
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
