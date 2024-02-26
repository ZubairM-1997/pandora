const express = require('express');
const app = express();

// Define routes
app.post('/api/company/sign_up', (req, res) => {
    // Handle POST /api/company/sign_up
    // You can access request body using req.body
    console.log('Received POST request at /api/company/sign_up');
    res.status(200).json({ message: 'Company signed up successfully!' });
});

