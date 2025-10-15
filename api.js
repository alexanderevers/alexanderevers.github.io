/**
 * API module for fetching data from the MYLAPS proxy.
 */

const PROXY_BASE_URL = 'https://us-central1-proxyapi-475018.cloudfunctions.net/mylapsProxyFunction/api/mylaps';

async function fetchActivities(transponder) {
    let url = `${PROXY_BASE_URL}/userid/${transponder}`;
    let response = await fetch(url);
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `User ID lookup failed: ${response.status}`);
    }
    const userData = await response.json();
    
    const userID = userData.userId;
    url = `${PROXY_BASE_URL}/activities/${userID}`;
    response = await fetch(url);
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Activities fetch failed: ${response.status}`);
    }
    
    const activitiesResponse = await response.json();
    return activitiesResponse.activities || [];
}

async function fetchLaps(activityId) {
    const url = `${PROXY_BASE_URL}/laps/${activityId}`;
    const response = await fetch(url);
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Laps fetch failed: ${response.status}`);
    }
    return await response.json();
}