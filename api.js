/**
 * API module for fetching data from the MYLAPS proxy.
 */

// Cloudflare Worker (see cloudflare-worker/). The old Google Cloud Function was:
// https://us-central1-proxyapi-475018.cloudfunctions.net/mylapsProxyFunction/api/mylaps
const PROXY_BASE_URL = 'https://mylaps-proxy.iceskater.workers.dev/api/mylaps';

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

// An activity that ended a while ago can no longer get new laps, so the proxy may keep its laps for a long time.
const FINISHED_AFTER_MS = 15 * 60 * 1000;

function isFinishedActivity(endTime) {
    const end = Date.parse(endTime);
    return Number.isFinite(end) && Date.now() - end > FINISHED_AFTER_MS;
}

/**
 * @param {number|string} activityId
 * @param {string} [endTime] the activity's endTime, when known. Passing it lets the proxy cache the laps
 *                           of a finished activity for a long time.
 */
async function fetchLaps(activityId, endTime) {
    const finished = endTime && isFinishedActivity(endTime) ? '?finished=1' : '';
    const url = `${PROXY_BASE_URL}/laps/${activityId}${finished}`;
    const response = await fetchWithRetry(url);
    if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Laps fetch failed'));
    }
    return await response.json();
}
/**
 * All activities of a location that could overlap a session starting at sessionStartDate.
 *
 * Two things about the locations endpoint matter here:
 *  - A page holds at most 200 activities, even when 250 are requested, so the next offset has to
 *    advance by the number of activities actually returned (advancing by the requested count
 *    silently skipped 50 activities per page).
 *  - The list is sorted by END time, newest first. Once the last activity of a page ended before the
 *    session started, nothing further down can overlap it. (Comparing start times stops too early:
 *    someone who started hours before the session but ended after it would not be seen.)
 */
async function fetchAllActivitiesFromLocation(locationId, year, sport, sessionStartDate) {
    const MAX_PAGES = 100; // safety net
    const requestedCount = 250;
    const activitiesById = new Map(); // ids can repeat if new activities shift the pages while we page through
    let offset = 0;
    const sessionDate = new Date(sessionStartDate);

    for (let page = 0; page < MAX_PAGES; page++) {
        const url = `${PROXY_BASE_URL}/locations/${locationId}?year=${year}&sport=${sport}&count=${requestedCount}&offset=${offset}`;
        const response = await fetchWithRetry(url);

        if (!response.ok) {
            throw new Error(await readErrorMessage(response, `Failed to fetch activities for location ${locationId}`));
        }

        const data = await response.json();
        const newActivities = data.activities || [];
        if (newActivities.length === 0) break;

        newActivities.forEach(activity => activitiesById.set(activity.id, activity));
        offset += newActivities.length;

        // Everything after this page ended even earlier than its last activity.
        const last = newActivities[newActivities.length - 1];
        if (last.endTime && new Date(last.endTime) < sessionDate) break;
    }

    return [...activitiesById.values()];
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
