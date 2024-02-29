const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const {
	cognitoServiceProvider,
	dynamoDB,
	s3Client,
	documentClient
} = require('../aws.js')

const app = express();
const bcrypt = require("bcrypt");
const uuid = require("uuid").v4;
const { createHmac } = require('crypto');

// Middleware to parse JSON request body
app.use(bodyParser.json());

const generateSecretHash = (username) => {
	const hasher = createHmac('sha256', process.env.AWS_USER_POOL_CLIENT_SECRET_CANDIDATES);
	// AWS wants `"Username" + "Client Id"`
	hasher.update(`${username}${process.env.AWS_USER_POOL_CLIENT_CANDIDATES}`);
	const secretHash = hasher.digest('base64');

	return secretHash
}

router.post('/sign_up', async (req, res) => {
	const {
		username,
		password,
		email,
		firstName,
		lastName,
	} = req.body

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
				"Name": "given_name",
				"Value": firstName
		 	},
			{
				"Name": "family_name",
				"Value": lastName
			},

		],
		"Username": username,
		"SecretHash": generateSecretHash(username)
   }

   return new Promise((resolve, reject) => {
		cognitoServiceProvider.signUp(params, (err, data) => {
			console.log('inside');
			if (err) {
			console.log(err.message);
			reject(err);
			return;
			}

			resolve(data);
		})
	}).then((data) => {
		const candidate = {
			firstName,
			lastName,
			id: data.UserSub,
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

			return res.status(200).json({
				message: 'Successfully signed up candidate',
				candidateId: candidate.id
			})
		})
	})
});

router.post('/sign_in', async (req, res) => {
	const { username, password } = req.body

	const authParams = {
		"AuthFlow": "USER_PASSWORD_AUTH",
		"AuthParameters": {
			"PASSWORD": password,
			"USERNAME": username,
			"SECRET_HASH": generateSecretHash(username)
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

router.post('/confirmSignUp', async (req, res) => {
	const { username, confirmationCode } = req.body

	const authParams = {
		"ClientId": process.env.AWS_USER_POOL_CLIENT_CANDIDATES,
		"ConfirmationCode": confirmationCode,
		"SecretHash": generateSecretHash(username),
		"Username": username
	 }

	 cognitoServiceProvider.confirmSignUp(authParams, (err, data) => {
		if (err) {
			console.error('Error signing in:', err);
			return res.status(500).json({ error: 'Failed to authenticate user' });
		}

		return res.status(200).json({
			message: "User has now been confirmed"
		})
	 })
})

router.put('/complete', async (req, res) => {
	const { age, country } = req.body;
	const { id } = req.params

	const profilePicS3Params = {
		Bucket: 'candidate-profile-pics-bucket',
		Key: id
	}

	const cvS3Params = {
		Bucket: 'candidate-cv-bucket',
		Key: id
	}

	try {
		const response = await s3Client.headObject(profilePicS3Params).promise();
		const secondResponse = await s3Client.headObject(cvS3Params).promise();

		if (response.status === 200 && secondResponse.status === 200){
			await s3Client.deleteObject(profilePicS3Params).promise();
			await s3Client.deleteObject(cvS3Params).promise();
			console.log("Previous picture and previous CV successfully deleted")
	  }


	  } catch (error) {
		  console.error("Error deleting previous photo from S3:", error);
		  throw error;
	  }

	  const cvS3UploadLink = s3Client.getSignedUrl('putObject', cvS3Params);
	  const profilePicUploadLink = s3Client.getSignedUrl('putObject', profilePicS3Params)

	const documentClientParams = {
		TableName: 'candidates-details-table',
		Key: { id: id },
		UpdateExpression: `SET
        age = :age,
        country = :country`,
		ExpressionAttributeValues: {
			":age": age,
			"country": country
		}
	}

	documentClient.update(documentClientParams, (err, data) => {
		if (err) {
			console.error('Error signing up:', err);
			return res.status(500).json({ error: 'Failed to update candidate data' });
		}

		res.status(200).json({
			message: 'Candidate profile updated successfully',
			cvUploadLink: cvS3UploadLink,
			profilePicUploadLink: profilePicUploadLink
		 });
	})
})

module.exports = router;