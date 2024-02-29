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
const { createHmac } = require('crypto');

// Middleware to parse JSON request body
app.use(bodyParser.json());

// Endpoint for company sign-up
app.post('/api/company/sign_up', async (req, res) => {
    const { username, email, password, fullName } = req.body;
	const hashedPassword = await bcrypt.hash(password, 10)
	const hasher = createHmac('sha256', process.env.AWS_USER_POOL_CLIENT_SECRET_COMPANIES);
	// AWS wants `"Username" + "Client Id"`
	hasher.update(`${username}${process.env.AWS_USER_POOL_CLIENT_COMPANIES}`);
	const secretHash = hasher.digest('base64');

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
		 "SecretHash": secretHash
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

	const user = cognitoServiceProvider.signUp(params, (err, data) => {
		if (err) {
			console.error('Error signing up:', err);
			return res.status(500).json({ error: 'Failed to sign up user' });
		}

		return data;
	})

	if(user){
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
	}
});

app.post('/api/company/confirmSignUp', async (req, res) => {
	const { username, confirmationCode } = req.body
	const hasher = createHmac('sha256', process.env.AWS_USER_POOL_CLIENT_SECRET_COMPANIES);
	// AWS wants `"Username" + "Client Id"`
	hasher.update(`${username}${process.env.AWS_USER_POOL_CLIENT_COMPANIES}`);
	const secretHash = hasher.digest('base64');


	const authParams = {
		"ClientId": process.env.AWS_USER_POOL_CLIENT_COMPANIES,
		"ConfirmationCode": confirmationCode,
		"SecretHash": secretHash,
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

app.post('/api/company/sign_in', async (req, res) => {
	const { username, password } = req.body
	const hasher = createHmac('sha256', process.env.AWS_USER_POOL_CLIENT_SECRET_COMPANIES);
	// AWS wants `"Username" + "Client Id"`
	hasher.update(`${username}${process.env.AWS_USER_POOL_CLIENT_COMPANIES}`);
	const secretHash = hasher.digest('base64');


	const authParams = {
		"AuthFlow": "USER_PASSWORD_AUTH",
		"AuthParameters": {
			"PASSWORD": password,
			"USERNAME": username,
			"SECRET_HASH": secretHash
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

app.put('/api/company/complete', async (req, res) => {
	const { companyName, country, city, photo } = req.body;
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
			return res.status(500).json({ error: 'Failed to update candidate data' });
		}

		res.status(200).json({
			message: 'Company profile updated successfully',
			s3Link: s3Link
		 });
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
			data: data,
			candidateId: candidate.id
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

app.put('/api/candidate/complete', async (req, res) => {
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
			await s3client.deleteObject(cvS3Params).promise();
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
			message: 'Company profile updated successfully',
			cvUploadLink: cvS3UploadLink,
			profilePicUploadLink: profilePicUploadLink
		 });
	})
})

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
