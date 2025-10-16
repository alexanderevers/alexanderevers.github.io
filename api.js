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

    if (!userID) {
        throw new Error('User ID not found for the given transponder.');
    }

    // Fetch activities and account profile in parallel
    const activitiesUrl = `${PROXY_BASE_URL}/activities/${userID}`;
    const accountUrl = `${PROXY_BASE_URL}/account/${userID}`;

    const [activitiesResponse, accountResponse] = await Promise.all([
        fetch(activitiesUrl),
        fetch(accountUrl)
    ]);

    if (!activitiesResponse.ok) {
        const errorData = await activitiesResponse.json();
        throw new Error(errorData.error || `Activities fetch failed: ${activitiesResponse.status}`);
    }
    
    const activitiesData = await activitiesResponse.json();
    const activities = activitiesData.activities || [];

    let accountData = null;
    if (accountResponse.ok) {
        accountData = await accountResponse.json();
    } else {
        // It's not a critical error if the profile can't be fetched, so just warn.
        console.warn(`Could not fetch account details: ${accountResponse.status}`);
    }

    return { activities, account: accountData, userId: userID };
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