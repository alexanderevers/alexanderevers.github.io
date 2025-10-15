/**
 * Strava API integration module.
 */

// --- CONFIGURATIE ---
// Vul hier je eigen Strava Client ID en de URLs naar je backend functies in.
const STRAVA_CLIENT_ID = 'JOUW_CLIENT_ID'; // Vervang dit!
const STRAVA_EXCHANGE_PROXY_URL = 'URL_NAAR_JE_EXCHANGE_TOKEN_FUNCTIE'; // Vervang dit!
const STRAVA_REFRESH_PROXY_URL = 'URL_NAAR_JE_REFRESH_TOKEN_FUNCTIE'; // Vervang dit!

// De Redirect URI moet exact overeenkomen met wat je in Strava hebt ingesteld.
const STRAVA_REDIRECT_URI = window.location.origin + window.location.pathname;
const STRAVA_TOKEN_DATA_KEY = 'strava_token_data';

// --- AUTHENTICATIE ---

function connectWithStrava() {
    const scope = 'activity:write,read'; // activity:write is voor upload, read is goed om te hebben
    window.location.href = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(STRAVA_REDIRECT_URI)}&approval_prompt=force&scope=${scope}`;
}

async function exchangeCodeForTokens(code) {
    try {
        const response = await fetch(STRAVA_EXCHANGE_PROXY_URL, {
            method: 'POST',
            body: JSON.stringify({ code: code })
        });
        if (!response.ok) throw new Error('Token exchange failed.');
        
        const tokenData = await response.json();
        if (tokenData.access_token) {
            saveTokens(tokenData);
            // Verwijder de code uit de URL na succes
            window.history.pushState({}, '', STRAVA_REDIRECT_URI);
            return true;
        } else {
            throw new Error(tokenData.message || 'Invalid token data received.');
        }
    } catch (error) {
        console.error('Strava callback error:', error);
        return false;
    }
}

function saveTokens(tokenData) {
    // We slaan alles op als één object
    const dataToStore = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: tokenData.expires_at,
    };
    localStorage.setItem(STRAVA_TOKEN_DATA_KEY, JSON.stringify(dataToStore));
}

function getTokens() {
    const data = localStorage.getItem(STRAVA_TOKEN_DATA_KEY);
    return data ? JSON.parse(data) : null;
}

function isTokenExpired(tokenData) {
    // Huidige tijd in seconden, met een buffer van 5 minuten
    const nowInSeconds = (Date.now() / 1000) + 300;
    return nowInSeconds > tokenData.expiresAt;
}

async function ensureValidToken() {
    let tokenData = getTokens();
    if (!tokenData) return null;

    if (isTokenExpired(tokenData)) {
        console.log('Strava token expired, refreshing...');
        try {
            const response = await fetch(STRAVA_REFRESH_PROXY_URL, {
                method: 'POST',
                body: JSON.stringify({ refreshToken: tokenData.refreshToken })
            });
            if (!response.ok) throw new Error('Refresh token exchange failed.');
            
            const newTokenData = await response.json();
            if (newTokenData.access_token) {
                saveTokens(newTokenData);
                return newTokenData.accessToken;
            } else {
                throw new Error('Invalid new token data received.');
            }
        } catch (error) {
            console.error('Could not refresh token:', error);
            // Verwijder ongeldige tokens
            localStorage.removeItem(STRAVA_TOKEN_DATA_KEY);
            return null;
        }
    }
    return tokenData.accessToken;
}

// --- UPLOAD ---

async function uploadToStrava(gpxContent, buttonElement) {
    const accessToken = await ensureValidToken();
    if (!accessToken) {
        alert('Could not get a valid Strava token. Please reconnect.');
        updateStravaButtonUI(buttonElement);
        return;
    }
    if (!gpxContent) {
        alert('No GPX data available to upload.');
        return;
    }

    const formData = new FormData();
    formData.append('file', new Blob([gpxContent], { type: 'application/gpx+xml' }), 'training.gpx');
    formData.append('data_type', 'gpx');
    formData.append('name', 'Jaap Edenbaan Training');
    formData.append('description', 'Uploaded via MYLAPS Activity Viewer');
    
    buttonElement.textContent = 'Uploading...';
    buttonElement.disabled = true;

    try {
        const response = await fetch('https://www.strava.com/api/v3/uploads', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${accessToken}` },
            body: formData
        });

        const data = await response.json();
        if (response.status === 201) { // 201 Created = Success
            alert('Upload successful! Please wait a moment for Strava to process the activity.');
            buttonElement.textContent = 'Uploaded!';
        } else {
            throw new Error(data.errors ? data.errors[0].resource + ': ' + data.errors[0].code : 'Unknown error');
        }
    } catch (error) {
        console.error('Strava upload failed:', error);
        alert('Upload failed: ' + error.message);
        buttonElement.textContent = 'Upload to Strava';
        buttonElement.disabled = false;
    }
}

// --- UI UPDATE ---

function updateStravaButtonUI(buttonElement) {
    if (getTokens()) {
        buttonElement.textContent = 'Upload to Strava';
        buttonElement.onclick = () => uploadToStrava(generatedGpxContent, buttonElement);
    } else {
        buttonElement.textContent = 'Connect with Strava';
        buttonElement.onclick = connectWithStrava;
    }
}