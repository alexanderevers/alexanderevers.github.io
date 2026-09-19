/**
 * A fake MYLAPS proxy for the browser test. buildStubScript() returns a <script> block that the test
 * server injects into the <head> of index.html and replay.html. It replaces window.fetch, so the pages talk
 * to the fake data in fake-mylaps-data.js instead of the real proxy; requests for local files (for example
 * the GPX track files) still go to the test server.
 *
 * It also replaces window.open, so "Open replay" records the address instead of opening a new tab.
 *
 * The laps of the reference rider are delayed on purpose: on the replay page the other riders' laps then
 * arrive first, which is the situation where the replay must still start at the reference rider's start.
 */
function buildStubScript(data, { referenceLapsDelayMs = 800 } = {}) {
    const payload = {
        activities: data.activities,
        lapsById: data.lapsById,
        names: data.names,
        referenceId: data.referenceId
    };
    return `<script>
(() => {
    const DATA = ${JSON.stringify(payload)};
    const DELAY_MS = ${Number(referenceLapsDelayMs)};
    const realFetch = window.fetch.bind(window);
    window.__opened = null;
    window.__proxyRequests = [];
    window.open = url => { window.__opened = url; return null; };

    const ok = body => ({ ok: true, status: 200, json: async () => body });
    const missing = () => ({ ok: false, status: 404, json: async () => ({ error: 'not found' }) });
    const byChip = chip => Object.values(DATA.activities).find(a => a.chipCode === chip);

    window.fetch = async input => {
        const url = String(input);
        const match = url.match(/\\/api\\/mylaps\\/([a-z]+)\\/?([^?\\/]*)/);
        if (!match) return realFetch(input);              // local files, such as tracks/*.gpx
        const [, endpoint, id] = match;
        window.__proxyRequests.push(url);

        if (endpoint === 'userid') return byChip(id) ? ok({ userId: 'U-' + id }) : missing();
        if (endpoint === 'activities') {
            const owner = byChip(id.replace(/^U-/, ''));
            return ok({ activities: owner ? [owner] : [] });
        }
        if (endpoint === 'account') {
            const name = DATA.names[id.replace(/^U-/, '')];
            return name ? ok({ name: { givenName: name[0], surName: name[1], nickName: name[2] } }) : missing();
        }
        if (endpoint === 'locations') {
            const offset = Number(new URL(url).searchParams.get('offset') || 0);
            const newestFirst = Object.values(DATA.activities).sort((a, b) => Date.parse(b.endTime) - Date.parse(a.endTime));
            return ok({ activities: offset === 0 ? newestFirst : [] });
        }
        if (endpoint === 'laps') {
            if (Number(id) === DATA.referenceId) await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            return DATA.lapsById[id] ? ok(DATA.lapsById[id]) : missing();
        }
        return missing();                                   // avatars and everything else
    };
})();
</script>`;
}

module.exports = { buildStubScript };
