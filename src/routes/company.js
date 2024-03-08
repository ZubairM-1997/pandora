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
	const hasher = createHmac('sha256', process.env.AWS_USER_POOL_CLIENT_SECRET_COMPANIES);
	// AWS wants `"Username" + "Client Id"`
	hasher.update(`${username}${process.env.AWS_USER_POOL_CLIENT_COMPANIES}`);
	const secretHash = hasher.digest('base64');
	return secretHash
}

router.post('/sign_up', async (req, res) => {
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
		const companyRep = {
			fullName,
			email,
			password: hashedPassword,
			id: data.UserSub
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

			return res.status(200).json({
				message: 'Successfully signed up user',
				userId: companyRep.id
			})
		})
	})
});

router.post('/confirmSignUp', async (req, res) => {
	const { username, confirmationCode } = req.body

	const authParams = {
		"ClientId": process.env.AWS_USER_POOL_CLIENT_COMPANIES,
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

router.post('/sign_in', async (req, res) => {
	const { username, password } = req.body

	const authParams = {
		"AuthFlow": "USER_PASSWORD_AUTH",
		"AuthParameters": {
			"PASSWORD": password,
			"USERNAME": username,
			"SECRET_HASH": generateSecretHash(username)
		},
		"ClientId": process.env.AWS_USER_POOL_CLIENT_COMPANIES
	 }

	 cognitoServiceProvider.initiateAuth(authParams, (err, data) => {
		if (err) {
			console.error('Error signing in:', err);
			return res.status(500).json({ error: 'Failed to authenticate user' });
		}

		return res.status(200).json(data)
	 })
})

router.put('/complete', async (req, res) => {
	const { companyName, country, city } = req.body;
	const { id } = req.params

	const S3Params = {
		Bucket: 'company-profile-pics-bucket',
		Key: id
	}

	try {
		const response = await s3Client.headObject(S3Params).promise();
		if (response.status === 200){
			  await s3Client.deleteObject(S3Params).promise();
			  console.log("Previous picture deleted successfully")
		}
	  } catch (error) {
		  console.error("Error deleting previous photo from S3:", error);
		  throw error;
	  }

	  const s3Link = s3Client.getSignedUrl('putObject', S3Params)


	const documentClientParams = {
		TableName: 'companies-details-table',
		Key: { id: id },
		UpdateExpression: `SET
        companyName = :companyName,
        country = :country
		city = :city`,
		ExpressionAttributeValues: {
			"companyName": companyName,
			":country": country,
			":city": city
		}
	}

	documentClient.update(documentClientParams, (err, data) => {
		if (err) {
			console.error('Error signing up:', err);
			return res.status(500).json({ error: 'Failed to update company data' });
		}

		res.status(200).json({
			message: 'Company profile updated successfully',
			s3Link: s3Link
		 });
	})
})

router.post('/createJob', async (req, res) => {
	const {
		jobTitle,
		jobType,
		relocationAssistance,
		industry,
		description
	} = req.body;

	const job = {
		job_id: uuid(),
		jobTitle,
		jobType,
		relocationAssistance,
		industry,
	}

	const documentClientParams = {
		TableName: 'jobs-table',
		Item: job
	}

	try {
		await documentClient.put(documentClientParams).promise();

		const s3Params = {
			Bucket: 'jobsdescriptions-bucket',
			Key: `${job.job_id}_${Date.now()}.txt`,
			Body: description
		}

		await s3Client.putObject(s3Params).promise();

		res.status(200).send('Job created successfully')

	} catch(error) {
		console.error('Error creating job', error)
		res.status(500).send('Error creating job')
	}
})

router.get('/getAllCandidates', async (req, res) => {
	const getParams = {
		TableName: 'candidates-details-table'
	}

	try {
		const candidates = [];
		const items = await documentClient.scan(getParams).promise();
		items.Items.forEach((candidate) => {
			candidates.push(candidate)
		})
		res.status(200).json({
			candidates
		})
	} catch (error) {
		console.error("Error fetching data from candidates table:", error);
		throw error;
	}
})

router.get('/getOneCandidate/:id', async (req, res) => {
	const {
		id
	} = req.params

	const getParams = {
		TableName: 'candidates-details-table',
		KeyConditionExpression: "id=:id",
		ExpressionAttributeValues: {
			":id": id
		}
	}

	try {
		 const foundCandidate = await documentClient.query(getParams).promise();
		 res.status(200).json({
			foundCandidate
		 })
	} catch(error) {
		console.error("Error fetching data from candidates table:", error);
		throw error;
	}

})

router.post('/searchCandidates', () => {

})

module.exports = router;