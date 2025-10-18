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
async function fetchAllActivitiesFromLocation(locationId, year, sport, sessionStartDate) {
    let allActivities = [];
    let offset = 0;
    const count = 50; // Fetch 50 activities per page for efficiency
    let hasMore = true;
    const sessionDate = new Date(sessionStartDate);

    while (hasMore) {
        const url = `${PROXY_BASE_URL}/locations/${locationId}?year=${year}&sport=${sport}&count=${count}&offset=${offset}`;
        const response = await fetch(url);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Failed to fetch activities for location ${locationId}: ${response.status}`);
        }

        const data = await response.json();
        const newActivities = data.activities || [];

        if (newActivities.length > 0) {
            allActivities = allActivities.concat(newActivities);

            // Check if the last activity fetched is older than the session start date
            const lastActivityDate = new Date(newActivities[newActivities.length - 1].startTime);
            if (lastActivityDate < sessionDate) {
                hasMore = false; // Stop fetching if we've gone past the session date
            } else {
                offset += count;
            }
        } else {
            hasMore = false;
        }
    }

    return allActivities;
}