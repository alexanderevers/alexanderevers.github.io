const fetch = require('node-fetch');
const cors = require('cors')();

const MYLAPS_API_HEADERS = {
    "Accept": "application/json",
    "Origin": "https://speedhive.mylaps.com",
    "Referer": "https://speedhive.mylaps.com/",
};

exports.mylapsProxy = (req, res) => {
    cors(req, res, async () => {
        if (req.method !== 'GET') {
            return res.status(405).send('Method Not Allowed');
        }

        const path = req.path;
        let mylapsUrl = '';
        const parts = path.split('/');

        // Expected path from frontend: /api/mylaps/endpoint/param
        const endpoint = parts[3];
        const param = parts[4];

        if (endpoint === 'userid' && param) {
            mylapsUrl = `https://usersandproducts-api.speedhive.com/api/v2/products/chips/code/${param}/account`;
        } else if (endpoint === 'activities' && param) {
            mylapsUrl = `https://practice-api.speedhive.com/api/v1/accounts/${param}/training/activities?count=100`;
        } else if (endpoint === 'laps' && param) {
            mylapsUrl = `https://practice-api.speedhive.com/api/v1/training/activities/${param}/sessions`;
        } else if (endpoint === 'account' && param) {
            mylapsUrl = `https://usersandproducts-api.speedhive.com/api/v2/accounts/${param}/profiles`;
        } else if (endpoint === 'avatar' && param) {
            mylapsUrl = `https://usersandproducts-api.speedhive.com/api/v2/image/id/${param}`;
        } else {
            return res.status(400).json({ error: 'Invalid MYLAPS API endpoint or missing parameter. Expected format: /api/mylaps/{userid|activities|laps|account|avatar}/{id}' });
        }

        if (!mylapsUrl) {
            return res.status(500).json({ error: 'Failed to construct MYLAPS API URL.' });
        }

        try {
            console.log(`Proxying request to: ${mylapsUrl}`);
            const response = await fetch(mylapsUrl, { headers: MYLAPS_API_HEADERS });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`MYLAPS API Error (${mylapsUrl}): ${response.status} ${response.statusText} - ${errorText}`);
                return res.status(response.status).json({
                    error: `MYLAPS API error: ${response.statusText}`,
                    details: errorText,
                    mylapsUrl: mylapsUrl
                });
            }

            if (endpoint === 'avatar') {
                res.set('Content-Type', response.headers.get('content-type'));
                response.body.pipe(res);
            } else {
                const data = await response.json();
                res.status(200).json(data);
            }

        } catch (error) {
            console.error(`Error in Cloud Function proxy for ${mylapsUrl}:`, error);
            res.status(500).json({ error: 'Internal server error during proxy operation.', details: error.message });
        }
    });
};
