/**
 * API module for fetching data from the MYLAPS proxy.
 */

// Cloudflare Worker (see cloudflare-worker/README.md).
const PROXY_BASE_URL = 'https://mylaps-proxy.iceskater.workers.dev/api/mylaps';

// The most activities we ask for (the proxy accepts up to 500). Without it only the newest 100 come back.
const ACTIVITIES_COUNT = 500;

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

    // Fetch activities and account profile in parallel. Without a count the proxy returns only the newest 100.
    const activitiesUrl = `${PROXY_BASE_URL}/activities/${userID}?count=${ACTIVITIES_COUNT}`;
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

// An activity that started on an earlier day (and has ended) can no longer get new laps, so the proxy may keep its laps for a long
// time. Activities of today, and the ones that are live, are not kept: they can still change and are seen once or twice only.
const FINISHED_AFTER_MS = 15 * 60 * 1000;

function isFinishedActivity(startTime, endTime) {
    const start = Date.parse(startTime);
    const end = Date.parse(endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return start < midnight.getTime() && Date.now() - end > FINISHED_AFTER_MS;
}

/**
 * @param {number|string} activityId
 * @param {string} [endTime]   the activity's endTime, when known
 * @param {string} [startTime] the activity's startTime, when known. With both, the laps of an activity that started on an
 *                             earlier day are cached by the proxy for a long time; those of today are not.
 */
async function fetchLaps(activityId, endTime, startTime) {
    const finished = isFinishedActivity(startTime, endTime) ? '?finished=1' : '';
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

/**
 * The newest activities of a rink, for the live page. ?live=1 makes the proxy keep the answer for one second
 * only (see cloudflare-worker/src/index.js). The list is sorted by END time, newest first, and a page holds at most 200.
 */
async function fetchLiveActivities(locationId, sport = 'IceSkating', count = 100) {
    const year = new Date().getFullYear();
    const url = `${PROXY_BASE_URL}/locations/${locationId}?year=${year}&sport=${sport}&count=${count}&offset=0&live=1`;
    const response = await fetchWithRetry(url);
    if (!response.ok) throw new Error(await readErrorMessage(response, 'The rink could not be loaded'));
    const data = await response.json();
    return data.activities || [];
}

/**
 * The laps of an activity that may still be running (kept only one second by the proxy).
 * Riders who keep their results private answer 401/403: that gives { private: true }.
 */
async function fetchLiveLaps(activityId) {
    const response = await fetchWithRetry(`${PROXY_BASE_URL}/laps/${activityId}?live=1`);
    if (response.status === 401 || response.status === 403) return { private: true };
    if (!response.ok) throw new Error(await readErrorMessage(response, 'Laps fetch failed'));
    return response.json();
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
