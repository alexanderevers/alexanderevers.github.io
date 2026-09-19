/**
 * A fake "locations" endpoint that behaves like the real one:
 *  - a page holds at most `pageCap` activities, even when more are requested
 *  - the list is sorted by END time, newest first
 * Returns a fetch() replacement and the log of the requests it received.
 */
function createFakeLocationFetch(activities, { pageCap = 200 } = {}) {
    const sorted = [...activities].sort((a, b) => Date.parse(b.endTime) - Date.parse(a.endTime));
    const requests = [];
    const fake = async url => {
        requests.push(String(url));
        const query = new URL(url).searchParams;
        const offset = Number(query.get('offset') || 0);
        const count = Math.min(Number(query.get('count') || pageCap), pageCap);
        return { ok: true, status: 200, json: async () => ({ activities: sorted.slice(offset, offset + count) }) };
    };
    return { fetch: fake, requests, sorted };
}

/** N activities that end 20 minutes apart, going back from `endOfNewest`; every 7th started 6 hours before it ended. */
function makeActivities(count, endOfNewest = Date.parse('2026-03-20T00:00:00Z')) {
    return Array.from({ length: count }, (_, i) => {
        const end = endOfNewest - i * 20 * 60000;
        const longSession = i % 7 === 0;
        return {
            id: count - i,
            startTime: new Date(end - (longSession ? 6 : 1) * 3600000).toISOString(),
            endTime: new Date(end).toISOString()
        };
    });
}

module.exports = { createFakeLocationFetch, makeActivities };
