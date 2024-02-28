const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const bodyParser = require('body-parser');
const {
	cognitoServiceProvider,
	dynamoDB,
	s3Client
} = require('./aws.js')

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON request body
app.use(bodyParser.json());

// Endpoint for company sign-up
app.post('/api/company/sign_up', (req, res) => {
    const { username, email, password } = req.body;

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
        // User signed up successfully
        const cognitoUser = data.user;
        res.status(200).json({ message: 'User signed up successfully' });
	})
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
