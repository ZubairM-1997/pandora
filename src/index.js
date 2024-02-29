const dotenv = require('dotenv');
dotenv.config();
const express = require('express');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 4000;


// Middleware to parse JSON request body
app.use(bodyParser.json());

// Endpoint for company sign-up
app.use('/api/company', require('./routes/company.js'))
app.use('/api/candidates', require('./routes/candidate.js'))

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
