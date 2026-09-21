const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts } = require('../helpers/browser-scripts');
const { createFakeLocationFetch, makeActivities } = require('../fixtures/fake-location-server');

// Retries wait 500 ms * attempt in real life; the tests do not want to wait.
const app = loadBrowserScripts(['utils.js', 'api.js'], { setTimeout: fn => setImmediate(fn) });
const { fetchWithRetry, readErrorMessage, fetchLaps, fetchAllActivitiesFromLocation, isFinishedActivity } = app.sandbox;
const PROXY = app.get('PROXY_BASE_URL');

const ok = body => ({ ok: true, status: 200, json: async () => body });
const failure = (status, body, isJson = true) => ({
    ok: false, status,
    json: async () => { if (!isJson) throw new SyntaxError('not JSON'); return body; }
});

describe('fetchWithRetry', () => {
    it('returns a good answer straight away', async () => {
        let calls = 0;
        app.sandbox.fetch = async () => { calls++; return ok({}); };
        const response = await fetchWithRetry('x');
        assert.equal(response.status, 200);
        assert.equal(calls, 1);
    });
    it('retries a 500 and returns the good answer that follows', async () => {
        const answers = [failure(500), failure(500), ok({})];
        let calls = 0;
        app.sandbox.fetch = async () => answers[calls++];
        assert.equal((await fetchWithRetry('x')).status, 200);
        assert.equal(calls, 3);
    });
    it('gives up after three tries and hands back the last error answer', async () => {
        let calls = 0;
        app.sandbox.fetch = async () => { calls++; return failure(500); };
        assert.equal((await fetchWithRetry('x')).status, 500);
        assert.equal(calls, 3);
    });
    it('does not retry a client error (4xx)', async () => {
        let calls = 0;
        app.sandbox.fetch = async () => { calls++; return failure(404); };
        assert.equal((await fetchWithRetry('x')).status, 404);
        assert.equal(calls, 1);
    });
    it('retries a network error and throws after the last try', async () => {
        let calls = 0;
        app.sandbox.fetch = async () => { calls++; throw new Error('offline'); };
        await assert.rejects(() => fetchWithRetry('x'), /offline/);
        assert.equal(calls, 3);
    });
});

describe('readErrorMessage', () => {
    it('uses the error text of a JSON answer', async () => {
        assert.equal(await readErrorMessage(failure(401, { error: 'MYLAPS API error: Unauthorized' }), 'Laps fetch failed'), 'MYLAPS API error: Unauthorized');
    });
    it('falls back to the status when the body is not JSON (a plain "Internal Server Error")', async () => {
        assert.equal(await readErrorMessage(failure(500, null, false), 'Laps fetch failed'), 'Laps fetch failed: 500');
    });
    it('falls back to the status when the JSON has no error field', async () => {
        assert.equal(await readErrorMessage(failure(502, {}), 'Laps fetch failed'), 'Laps fetch failed: 502');
    });
});

describe('fetchLaps: the "finished" hint for the proxy cache (only for activities that started on an earlier day)', () => {
    let requested;
    beforeEach(() => { requested = []; app.sandbox.fetch = async url => { requested.push(url); return ok({ sessions: [] }); }; });
    const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
    const yesterday = hour => { const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
    const today = (hour, minute = 0) => { const d = new Date(); d.setHours(hour, minute, 0, 0); return d.toISOString(); };

    it('adds ?finished=1 for an activity that started yesterday (or earlier) and has ended', async () => {
        await fetchLaps(7561524117, yesterday(20), yesterday(19));
        await fetchLaps(2, '2026-01-05T11:00:00Z', '2026-01-05T10:00:00Z');
        assert.deepEqual(requested, [`${PROXY}/laps/7561524117?finished=1`, `${PROXY}/laps/2?finished=1`]);
    });
    it('leaves it out for an activity of today, even when it ended hours ago', async () => {
        await fetchLaps(1, ago(300), today(0, 0));
        assert.equal(requested[0], `${PROXY}/laps/1`);
        assert.equal(isFinishedActivity(today(0, 0), ago(0.1)), false);
    });
    it('leaves it out when the start or the end is unknown, or the activity has only just ended', async () => {
        await fetchLaps(1, yesterday(20));                // no start time
        await fetchLaps(2, null, yesterday(19));          // still going
        await fetchLaps(3);
        await fetchLaps(4, ago(5), yesterday(0));         // ended 5 minutes ago (started before midnight)
        assert.deepEqual(requested, [1, 2, 3, 4].map(id => `${PROXY}/laps/${id}`));
    });
    it('isFinishedActivity ignores times it cannot read', () => {
        assert.equal(isFinishedActivity('nonsense', yesterday(20)), false);
        assert.equal(isFinishedActivity(yesterday(19), 'nonsense'), false);
        assert.equal(isFinishedActivity(yesterday(19), yesterday(20)), true);
    });
    it('turns an error answer into an Error with a readable message', async () => {
        app.sandbox.fetch = async () => failure(500, null, false);
        await assert.rejects(() => fetchLaps(1), /Laps fetch failed: 500/);
    });
});

describe('fetchAllActivitiesFromLocation: paging through a rink like the real API does', () => {
    // 1000 activities, a page holds at most 200, sorted by END time; some long sessions started hours earlier.
    const activities = makeActivities(1000);
    const newest = Date.parse('2026-03-20T00:00:00Z');

    it('finds every activity that ended after the session started: no skipped ones, no duplicates', async () => {
        const server = createFakeLocationFetch(activities);
        app.sandbox.fetch = server.fetch;
        const sessionStart = new Date(newest - 300 * 20 * 60000 - 3600000).toISOString();   // 300 activities back
        const found = await fetchAllActivitiesFromLocation(2040, 2026, 'IceSkating', sessionStart);

        const ids = new Set(found.map(a => a.id));
        const shouldContain = activities.filter(a => Date.parse(a.endTime) >= Date.parse(sessionStart));
        assert.equal(ids.size, found.length, 'duplicates');
        assert.deepEqual(shouldContain.filter(a => !ids.has(a.id)), [], 'missing activities');
        assert.ok(server.requests.length <= 3, `${server.requests.length} requests`);
    });

    it('moves on by the number of activities it received, not by the number it asked for', async () => {
        const server = createFakeLocationFetch(activities);
        app.sandbox.fetch = server.fetch;
        await fetchAllActivitiesFromLocation(2040, 2026, 'IceSkating', new Date(newest - 900 * 20 * 60000).toISOString());
        const offsets = server.requests.map(url => Number(new URL(url).searchParams.get('offset')));
        assert.deepEqual(offsets.slice(0, 3), [0, 200, 400]);
    });

    it('also finds a long session that started long before but ended after the session began', async () => {
        const server = createFakeLocationFetch(activities);
        app.sandbox.fetch = server.fetch;
        // The 8th activity (index 7) has a start 1 h before its end; index 14 started 6 h before its end.
        const sessionStart = new Date(newest - 300 * 20 * 60000).toISOString();
        const found = await fetchAllActivitiesFromLocation(2040, 2026, 'IceSkating', sessionStart);
        const longSessions = activities.filter((a, i) => i % 7 === 0 && Date.parse(a.endTime) >= Date.parse(sessionStart));
        assert.ok(longSessions.length > 10);
        assert.ok(longSessions.every(a => found.some(f => f.id === a.id)));
    });

    it('stops after one page when that page already reaches back before the session', async () => {
        const server = createFakeLocationFetch(activities);
        app.sandbox.fetch = server.fetch;
        await fetchAllActivitiesFromLocation(2040, 2026, 'IceSkating', new Date(newest - 10 * 20 * 60000).toISOString());
        assert.equal(server.requests.length, 1);
    });

    it('passes the location, year, sport and paging to the proxy', async () => {
        const server = createFakeLocationFetch(activities);
        app.sandbox.fetch = server.fetch;
        await fetchAllActivitiesFromLocation(2040, 2026, 'IceSkating', new Date(newest).toISOString());
        const url = new URL(server.requests[0]);
        assert.equal(url.pathname.endsWith('/locations/2040'), true);
        assert.equal(url.searchParams.get('year'), '2026');
        assert.equal(url.searchParams.get('sport'), 'IceSkating');
    });

    it('throws a readable error when the proxy fails', async () => {
        app.sandbox.fetch = async () => failure(500, null, false);
        await assert.rejects(
            () => fetchAllActivitiesFromLocation(2040, 2026, 'IceSkating', new Date().toISOString()),
            /Failed to fetch activities for location 2040: 500/);
    });
});


describe('fetchActivities: the whole activity list', () => {
    const asked = [];
    const answer = routes => async url => {
        asked.push(url);
        for (const [part, response] of routes) if (url.includes(part)) return typeof response === 'function' ? response(url) : response;
        return failure(404, { error: 'not found' });
    };
    const list = count => Array.from({ length: count }, (_, i) => ({ id: 1000 - i, startTime: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}T12:00:00Z` }));

    it('asks for up to 500 activities (without a count the proxy returns only the newest 100)', async () => {
        asked.length = 0;
        app.sandbox.fetch = answer([
            ['/userid/', ok({ userId: 'U1' })],
            ['/activities/', ok({ activities: list(144) })],
            ['/account/', ok({ name: { givenName: 'A' } })]
        ]);
        const result = await app.sandbox.fetchActivities('PZ-28583');
        assert.equal(app.get('ACTIVITIES_COUNT'), 500);
        assert.ok(asked.includes(`${PROXY}/activities/U1?count=500`), asked.join('\n'));
        assert.equal(result.activities.length, 144);
        assert.equal(result.userId, 'U1');
        assert.equal(result.account.name.givenName, 'A');
    });
    it('still works when the profile cannot be fetched', async () => {
        app.sandbox.fetch = answer([['/userid/', ok({ userId: 'U1' })], ['/activities/', ok({ activities: list(3) })], ['/account/', failure(500, null, false)]]);
        const result = await app.sandbox.fetchActivities('PZ-28583');
        assert.equal(result.account, null);
        assert.equal(result.activities.length, 3);
    });
    it('gives a readable error for an unknown transponder or a missing user id', async () => {
        app.sandbox.fetch = answer([['/userid/', failure(404, null, false)]]);
        await assert.rejects(() => app.sandbox.fetchActivities('XX-00000'), /User ID lookup failed: 404/);
        app.sandbox.fetch = answer([['/userid/', ok({})]]);
        await assert.rejects(() => app.sandbox.fetchActivities('XX-00000'), /User ID not found/);
    });
    it('reports a failing activity list', async () => {
        app.sandbox.fetch = answer([['/userid/', ok({ userId: 'U1' })], ['/activities/', failure(500, null, false)], ['/account/', ok({})]]);
        await assert.rejects(() => app.sandbox.fetchActivities('PZ-28583'), /Activities fetch failed: 500/);
    });
});

describe('fetchAccountByUserId: the real name behind a transponder name', () => {
    const { fetchAccountByUserId } = app.sandbox;
    it('asks for the account of the user id of the list of a rink, and gives the profile', async () => {
        const requested = [];
        app.sandbox.fetch = async url => { requested.push(url); return ok({ userId: 'MYLAPS-GA-1', name: { givenName: 'Peter', surName: 'van Buiten' } }); };
        const account = await fetchAccountByUserId('MYLAPS-GA-1');
        assert.equal(account.name.surName, 'van Buiten');
        assert.deepEqual(requested, [`${PROXY}/account/MYLAPS-GA-1`]);
    });
    it('gives null for a profile that cannot be read (private, unknown, or the proxy is down)', async () => {
        app.sandbox.fetch = async () => failure(404, { error: 'not found' });
        assert.equal(await fetchAccountByUserId('x'), null);
        app.sandbox.fetch = async () => { throw new TypeError('Failed to fetch'); };
        assert.equal(await fetchAccountByUserId('x'), null);
    });
});
