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
const { UserImportJobStatusType } = require('@aws-sdk/client-cognito-identity-provider');

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
			password: hashedPassword,
			username: username
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

router.get('/getAllJobs', async (req, res) => {
	const getParams = {
		TableName: 'jobs-table'
	}

	try {
		const jobs = [];
		const items = await documentClient.scan(getParams).promise();
		items.Items.forEach((job) => {
			jobs.push(job)
		})
		res.status(200).json({
			jobs
		})
	} catch (error) {
		console.error("Error fetching data from jobs table:", error);
		throw error;
	}
})

router.get('/getOneJob/:job_id', async (req, res) => {
	const {
		job_id
	} = req.params

	const getParams = {
		TableName: 'jobs-table',
		KeyConditionExpression: "job_id=:job_id",
		ExpressionAttributeValues: {
			":job_id": job_id
		}
	}

	try {
		 const foundJob = await documentClient.query(getParams).promise();
		 res.status(200).json({
			foundJob
		 })
	} catch(error) {
		console.error("Error fetching data from jobs table:", error);
		throw error;
	}
})

router.post('/createApplication', () => {

})

router.post('/searchJobs', () => {
	//will use ElasticSearch

})

router.post('/payment', () => {
	//will use StripeAPI

})

router.get('/getCurrentAuthenticatedCandidate', async (req, res) => {
	const { id } = req.params

	const getParams = {
		TableName: 'candidates-details-table',
		KeyConditionExpression: 'id = :id',
		ExpressionAttributeNames: {
			":id": id
		}
	}

	try {
		const found = documentClient.query(getParams).promise()
		res.status(200).json({
			found
		})
	} catch(error){
		console.error('Error finding recruiter', error)
		res.status(500).send('Error finding recruiter')
	}
})


router.post('/forgotPassword', (req, res) => {
	const {
		username
	} = req.body

	const cognitoParams = {
		"ClientId": process.env.AWS_USER_POOL_CLIENT_CANDIDATES,
		"SecretHash": generateSecretHash(username),
		"Username": username
	 }

	return new Promise((resolve, reject) => {
		cognitoServiceProvider.forgotPassword(cognitoParams, (err, data) => {
			if (err) {
			  console.error(err);
			  reject(err)
			  return;
			} else {
			resolve(data);
			}
		});
	})
})

router.post('/resetPassword', () => {
	const {
		username,
		verificationCode,
		newPassword
	} = req.body

	const cognitoParams = {
		"ClientId": process.env.AWS_USER_POOL_CLIENT_CANDIDATES,
		"SecretHash": generateSecretHash(username),
		"ConfirmationCode": verificationCode,
		"Username": username,
		"Password": newPassword
	 }

	return new Promise((resolve, reject) => {
		cognitoServiceProvider.confirmForgotPassword(cognitoParams, (err, data) => {
			if (err) {
			  console.error(err);
			  reject(err)
			  return;
			} else {
			resolve(data);
			}
		});
	}).then( async () => {
	const password = await bcrypt.hash(newPassword, 10)

	const documentClientParams = {
		TableName: 'candidates-details-table',
		Key: { username: username },
		UpdateExpression: `SET
        password = :password,
		`,
		ExpressionAttributeValues: {
			":password": password,
		}
	}

	documentClient.update(documentClientParams, (err, data) => {
		if (err) {
			console.error('Error changing password:', err);
			return res.status(500).json({ error: 'Failed to change password' });
		}

		res.status(200).json({
			message: 'Password changed successfully'
		 });
	})
	})
})

module.exports = router;