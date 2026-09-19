/**
 * API module for fetching data from the MYLAPS proxy.
 */

const PROXY_BASE_URL = 'https://us-central1-proxyapi-475018.cloudfunctions.net/mylapsProxyFunction/api/mylaps';

const FETCH_RETRIES = 2;
const FETCH_RETRY_DELAY_MS = 500;

/**
 * fetch() that retries on network errors and 5xx responses. The proxy sometimes answers with a
 * transient "Internal Server Error" when many requests arrive at once (e.g. loading many riders' laps).
 */
async function fetchWithRetry(url) {
    let lastError;
    for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
        if (attempt > 0) await new Promise(resolve => setTimeout(resolve, FETCH_RETRY_DELAY_MS * attempt));
        try {
            const response = await fetch(url);
            if (response.status < 500 || attempt === FETCH_RETRIES) return response;
            lastError = null; // 5xx: try again
        } catch (error) {
            lastError = error;
            if (attempt === FETCH_RETRIES) throw error;
        }
    }
    throw lastError;
}

/** Error text from a failed proxy response; the body is not always JSON (e.g. a plain "Internal Server Error"). */
async function readErrorMessage(response, fallback) {
    try {
        const data = await response.json();
        if (data && data.error) return data.error;
    } catch {
        // body was not JSON
    }
    return `${fallback}: ${response.status}`;
}

async function fetchActivities(transponder) {
    let url = `${PROXY_BASE_URL}/userid/${transponder}`;
    let response = await fetchWithRetry(url);
    if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'User ID lookup failed'));
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
        fetchWithRetry(activitiesUrl),
        fetchWithRetry(accountUrl)
    ]);

    if (!activitiesResponse.ok) {
        throw new Error(await readErrorMessage(activitiesResponse, 'Activities fetch failed'));
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
    const response = await fetchWithRetry(url);
    if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Laps fetch failed'));
    }
    return await response.json();
}
async function fetchAllActivitiesFromLocation(locationId, year, sport, sessionStartDate) {
    let allActivities = [];
    let offset = 0;
    const count = 250;
    let hasMore = true;
    const sessionDate = new Date(sessionStartDate);

    while (hasMore) {
        const url = `${PROXY_BASE_URL}/locations/${locationId}?year=${year}&sport=${sport}&count=${count}&offset=${offset}`;
        const response = await fetchWithRetry(url);

        if (!response.ok) {
            throw new Error(await readErrorMessage(response, `Failed to fetch activities for location ${locationId}`));
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

async function fetchAccountDetails(transponder) {
    try {
        const url = `${PROXY_BASE_URL}/userid/${transponder}`;
        const response = await fetchWithRetry(url);
        if (!response.ok) {
            // It's not a critical error if a user can't be found, so just return null.
            return null;
        }
        const userData = await response.json();
        const userID = userData.userId;

        if (!userID) {
            return null;
        }

        const accountUrl = `${PROXY_BASE_URL}/account/${userID}`;
        const accountResponse = await fetchWithRetry(accountUrl);

        if (accountResponse.ok) {
            const accountData = await accountResponse.json();
            // The user ID is needed for the avatar URL, so we add it to the returned object.
            return { ...accountData, id: userID };
        }
    } catch (error) {
        console.warn(`Could not fetch account details for transponder ${transponder}:`, error);
    }
    return null;
}
