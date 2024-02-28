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
const jwt = require("jsonwebtoken");

// Middleware to parse JSON request body
app.use(bodyParser.json());

// Endpoint for company sign-up
app.post('/api/company/sign_up', async (req, res) => {
    const { username, email, password, fullName } = req.body;
	const hashedPassword = await bcrypt.hash(password, 10)

	const params = {
		 "ClientId": process.env.AWS_USER_POOL_CLIENT_COMPANIES,
		 "Password": password,
		 "UserAttributes": [
			{
			   "Name": "email",
			   "Value": email
			}
		 ],
		 "Username": username,
	}

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
	})

	cognitoServiceProvider.signUp(params, (err, data) => {
		if (err) {
			console.error('Error signing up:', err);
			return res.status(500).json({ error: 'Failed to sign up user' });
		}

		return res.status(200).json({
			message: 'Successfully signed up user',
			data: data
		})
	})
});

app.post('/api/company/sign_in', async (req, res) => {
	const { username, password } = req.body

	const authParams = {
		"AuthFlow": "USER_PASSWORD_AUTH",
		"AuthParameters": {
			"PASSWORD": password,
			"USERNAME": username
		},
		"ClientId": process.env.AWS_USER_POOL_CLIENT_COMPANIES,
	 }


	 cognitoServiceProvider.initiateAuth(authParams, (err, data) => {
		if (err) {
			console.error('Error signing in:', err);
			return res.status(500).json({ error: 'Failed to authenticate user' });
		}

		return res.status(200).json(data)
	 })

})


app.post('/api/candidate/sign_up', async (req, res) => {
    const { username, email, password, fullName } = req.body;
	const hashedPassword = await bcrypt.hash(password, 10)

	const params = {
		"ClientId": process.env.AWS_USER_POOL_CLIENT_CANDIDATES,
		"Password": password,
		"UserAttributes": [
		   {
			  "Name": "email",
			  "Value": email
		   },
		   {
			"Name": "Full Name",
			"Value": fullName
		 }
		],
		"Username": username,
   }

	const candidate = {
		fullName,
		id: uuid(),
		email,
		password: hashedPassword
	}
	let dynamoDBParams = {
		TableName: 'candidates-details-table',
		Item: candidate
	}

	documentClient.put(dynamoDBParams, (err, data) => {
		if (err) {
			console.error('Error signing up:', err);
			return res.status(500).json({ error: 'Failed to save candidate data' });
		}
	})

	cognitoServiceProvider.signUp(params, (err, data) => {
		if (err) {
			console.error('Error signing up:', err);
			return res.status(500).json({ error: 'Failed to sign up candidate' });
		}

		return res.status(200).json({
			message: 'Successfully signed up candidate',
			data: data
		})
	})
});

app.post('/api/canididate/sign_in', async (req, res) => {
	const { username, password } = req.body

	const authParams = {
		"AuthFlow": "USER_PASSWORD_AUTH",
		"AuthParameters": {
			"PASSWORD": password,
			"USERNAME": username
		},
		"ClientId": process.env.AWS_USER_POOL_CLIENT_CANDIDATES,
	 }


	 cognitoServiceProvider.initiateAuth(authParams, (err, data) => {
		if (err) {
			console.error('Error signing in:', err);
			return res.status(500).json({ error: 'Failed to authenticate user' });
		}

		return res.status(200).json(data)
	 })

})

app.put('/api/candidate/complete', (req, res) => {
	const { age, country } = req.body;
	const { id } = req.params

	const documentClientParams = {
		TableName: 'candidates-details-table',
		Key: { userId: id },
		UpdateExpression: `SET
        age = :age,
        country = :country`,
		ExpressionAttributeValues: {
			":age": age,
			"country": country
		}
	}

	documentClient.update(documentClientParams, (req, res) => {
		if (err) {
			console.error('Error signing up:', err);
			return res.status(500).json({ error: 'Failed to update candidate data' });
		}

		res.status(200).json({
			message: 'Candidate updated successfully',
		 });
	})

})

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
