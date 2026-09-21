/**
 * A fake live rink for the browser test of live.html. buildLiveStubScript() returns a <script> block that the test server
 * injects into the <head> of every page. It replaces window.fetch, so the page talks to a rink where laps come in
 * while the test runs: every lap is worked out from the clock of the page (Date.now()), like a session that is running.
 *
 * The cast, all at rink 2497 (any other rink is empty):
 *   9001  "Fast Fanny"    on the ice, a lap every 6 s, started 60 s before the page loaded
 *   9002  "Steady Sam"    on the ice, a lap every 9 s, started 60 s before
 *   9003  (no label)      has been resting for 6 minutes: her last lap ended 6 minutes ago
 *   9004  "Private Pete"  active a moment ago, but his laps answer 401 (results are private)
 *   9005  "Old Olga"      her last lap ended 40 minutes ago: not looked at at all
 *   9006  "Just Started"  started 2 s after the page loaded; the first lap arrives 12 s after that
 *
 * Switches for the test: window.__liveFail = true makes the list of the rink fail with a server error.
 * window.__liveRequests holds the addresses that were requested.
 */
function buildLiveStubScript() {
    return `<script>
(() => {
    const T0 = Date.now();
    const realFetch = window.fetch.bind(window);
    window.__liveFail = false;
    window.__liveRequests = [];

    const RIDERS = [
        { id: 9001, chip: 'FA-10001', label: 'Fast Fanny', start: T0 - 60000, pace: 6000 },
        { id: 9002, chip: 'ST-10002', label: 'Steady Sam', start: T0 - 60000, pace: 9000 },
        { id: 9003, chip: 'RE-10003', label: '', start: T0 - 660000, pace: 10000, stopAt: T0 - 360000 },
        { id: 9004, chip: 'PR-10004', label: 'Private Pete', start: T0 - 120000, pace: 10000, stopAt: T0 - 20000, isPrivate: true },
        { id: 9005, chip: 'OL-10005', label: 'Old Olga', start: T0 - 4000000, pace: 12000, stopAt: T0 - 2400000 },
        { id: 9006, chip: 'JU-10006', label: 'Just Started', start: T0 + 2000, pace: 12000 }
    ];

    // The laps a rider has finished by now, as the API gives them.
    function lapsOf(rider, now) {
        const until = Math.min(now, rider.stopAt === undefined ? now : rider.stopAt);
        const count = Math.max(0, Math.floor((until - rider.start) / rider.pace));
        return Array.from({ length: count }, (_, i) => ({
            nr: i + 1,
            dateTimeStart: new Date(rider.start + i * rider.pace).toISOString(),
            duration: (rider.pace / 1000).toFixed(3),
            sessionDuration: '1:00.000',
            speed: { kph: (400 / (rider.pace / 1000)) * 3.6 },
            status: 'FASTER', diffPrevLap: '0.000', sections: [], dataAttributes: []
        }));
    }
    function activityOf(rider, now) {
        const laps = lapsOf(rider, now);
        const end = laps.length ? rider.start + laps.length * rider.pace : rider.start;
        return {
            id: rider.id, name: 'Practice', chipCode: rider.chip, chipLabel: rider.label,
            startTime: new Date(rider.start).toISOString(), endTime: new Date(end).toISOString(), accountId: rider.id,
            location: { id: 2497, name: 'Thialf Heerenveen', sport: 'IceSkating', trackLength: 0 }
        };
    }

    const ok = body => ({ ok: true, status: 200, json: async () => body });
    const failure = (status, error) => ({ ok: false, status, json: async () => ({ error }) });

    window.fetch = async input => {
        const url = String(input);
        const match = url.match(/\\/api\\/mylaps\\/([a-z]+)\\/?([^?\\/]*)/);
        if (!match) return realFetch(input);
        const [, endpoint, id] = match;
        window.__liveRequests.push(url);
        const now = Date.now();

        if (endpoint === 'locations') {
            if (window.__liveFail) return failure(500, 'MYLAPS API error: Internal Server Error');
            if (id !== '2497') return ok({ activities: [] });
            const offset = Number(new URL(url).searchParams.get('offset') || 0);
            const list = RIDERS.filter(r => r.start <= now + 60000).map(r => activityOf(r, now))
                .sort((a, b) => Date.parse(b.endTime) - Date.parse(a.endTime));
            return ok({ activities: offset === 0 ? list : [] });
        }
        if (endpoint === 'laps') {
            const rider = RIDERS.find(r => String(r.id) === id);
            if (!rider) return failure(404, 'not found');
            if (rider.isPrivate) return failure(401, 'MYLAPS API error: Unauthorized');
            const laps = lapsOf(rider, now);
            return ok({ stats: { lapCount: laps.length, fastestTime: (rider.pace / 1000).toFixed(3) }, sessions: [{ id: 1, laps }] });
        }
        return failure(404, 'not found');
    };
})();
</script>`;
}

module.exports = { buildLiveStubScript };
