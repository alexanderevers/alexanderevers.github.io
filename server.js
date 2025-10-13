const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Use node-fetch for server-side HTTP requests

const app = express();
const port = 3000; // Your proxy server will run on port 3000

// Enable CORS for your frontend to talk to this proxy
app.use(cors());
app.use(express.json()); // To parse JSON request bodies

const MYLAPS_API_HEADERS = {
    "Accept": "application/json",
    // These are the headers you want the MYLAPS API to see
    "Origin": "https://speedhive.mylaps.com",
    "Referer": "https://speedhive.mylaps.com/",
};

// Proxy endpoint to get User ID
app.get('/api/mylaps/userid/:transponder', async (req, res) => {
    const transponder = req.params.transponder;
    const url = `https://usersandproducts-api.speedhive.com/api/v2/products/chips/code/${transponder}/account`;

    try {
        const response = await fetch(url, { headers: MYLAPS_API_HEADERS });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`MYLAPS API Error: ${response.status} ${response.statusText} - ${errorText}`);
        }
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Proxy Error fetching User ID:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Proxy endpoint to get activities
app.get('/api/mylaps/activities/:userId', async (req, res) => {
    const userId = req.params.userId;
    const url = `https://practice-api.speedhive.com/api/v1/accounts/${userId}/training/activities?count=100`;

    try {
        const response = await fetch(url, { headers: MYLAPS_API_HEADERS });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`MYLAPS API Error: ${response.status} ${response.statusText} - ${errorText}`);
        }
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Proxy Error fetching activities:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Proxy endpoint to get laps
app.get('/api/mylaps/laps/:activityId', async (req, res) => {
    const activityId = req.params.activityId;
    const url = `https://practice-api.speedhive.com/api/v1/training/activities/${activityId}/sessions`;

    try {
        const response = await fetch(url, { headers: MYLAPS_API_HEADERS });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`MYLAPS API Error: ${response.status} ${response.statusText} - ${errorText}`);
        }
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Proxy Error fetching laps:', error.message);
        res.status(500).json({ error: error.message });
    }
});


app.listen(port, () => {
    console.log(`MYLAPS Proxy server listening at http://localhost:${port}`);
});
