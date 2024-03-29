const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const router = express.Router();
const bodyParser = require('body-parser');
const {
	cognitoServiceProvider,
	s3Client,
	documentClient
} = require('../aws.js')

const app = express();
const bcrypt = require("bcrypt");
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
	const {
		firstName,
		lastName,
		emailAddress,
		phoneNumber,
		country,
		city,
		dateOfBirth,
		gender,
		highestEducation,
		interestedJobSectors,
		language1,
		proficiency1,
		language2,
		proficiency2,
		language3,
		proficiency3,
		consentData
	 } = req.body;
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
		firstName = :firstName
		lastName = :lastName
		emailAddress = :emailAddress
		phoneNumber = :phoneNumber
		country = :country
		city = :city
		dateOfBirth = :dateOfBirth
		gender = :gender
		highestEducation = :highestEducation
		interestedJobSectors = :interestedJobSectors
		language1 = :language1
		proficiency1 = :proficiency1
		language2 = :language2
		proficiency2 = :proficiency2
		language3 = :language3
		proficiency3 = :proficiency3
        consentData = :consentData,
       `,
		ExpressionAttributeValues: {
			":firstName": firstName,
			":lastName": lastName,
			":emailAddress": emailAddress,
			":phoneNumber": phoneNumber,
			":country": country,
			":city": city,
			":dateOfBirth": dateOfBirth,
			":gender": gender,
			":highestEducation": highestEducation,
			":interestedJobSectors": interestedJobSectors,
			":language1": language1,
			":proficiency1": proficiency1,
			":language2": language2,
			":proficiency2": proficiency2,
			":language3": language3,
			":proficiency3": proficiency3,
			":consentData": consentData,
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

router.post('/createApplication', async (req, res) => {
	const {
		candidateId,
		jobId,
		cvDocument,
		coverLetterDocument,
		candidatePicture
	} = req.params

	try {
		const item = {
			job_id: jobId,
			candidate_id: candidateId,
			dateApplied: Date.now(),
		}

		let dynamoDBParams = {
			TableName: 'applications-table',
			Item: item
		}


		await documentClient.put(dynamoDBParams).promise()
		// will send email to candidate and recruiter once application has been submitted
		// might have to save application documents into an s3 bucket too


	} catch(error){
		console.error("Error saving data to applications table:", error);
		throw error;
	}

})

router.post('/searchJobs', () => {
	//will use ElasticSearch

})

router.put('/updateProfile', () => {
	// will have to call Skrill API to update payment information
	// will have to update CV, profile pic and cover letter s3 buckets

})


router.post('/paymentSubscribe', () => {
	//will use SkrillAPI
	// might need to save SOME payment information into dynamodb

})

router.post('/cancelSubscription', () => {
	//will use SkrillAPI
})

router.get('/getCurrentAuthenticatedCandidate', async (req, res) => {
	const { id } = req.params
	// also need to retrieve the photo from the s3 bucket
	// will also need to retrieve some card information from Skrill API

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
		console.error('Error finding candidate', error)
		res.status(500).send('Error finding candidate')
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