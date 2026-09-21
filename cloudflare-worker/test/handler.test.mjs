// Tests for the Worker's request handling, with a fake MYLAPS. Run: npm test
import { handleRequest } from '../src/index.js';

let failures = 0;
const check = (name, condition, detail = '') => {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

// ---- fake MYLAPS ----
let calls = [];
let nextResponse = () => new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json', 'cf-cache-status': 'MISS' } });
globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return nextResponse(); };
const lastCall = () => calls[calls.length - 1];

const SITE = 'https://alexanderevers.github.io';
const get = (path, headers = {}) => handleRequest(new Request(`https://proxy.example${path}`, { headers }), {});

// ---- routing: each endpoint calls the right MYLAPS address ----
const routes = [
    ['/api/mylaps/userid/PZ-28583', 'https://usersandproducts-api.speedhive.com/api/v2/products/chips/code/PZ-28583/account'],
    ['/api/mylaps/account/MYLAPS-GA-abc123', 'https://usersandproducts-api.speedhive.com/api/v2/accounts/MYLAPS-GA-abc123/profiles'],
    ['/api/mylaps/avatar/MYLAPS-GA-abc123', 'https://usersandproducts-api.speedhive.com/api/v2/image/id/MYLAPS-GA-abc123'],
    ['/api/mylaps/activities/MYLAPS-GA-abc123', 'https://practice-api.speedhive.com/api/v1/accounts/MYLAPS-GA-abc123/training/activities?count=100'],
    ['/api/mylaps/activities/MYLAPS-GA-abc123?count=1&order=desc', 'https://practice-api.speedhive.com/api/v1/accounts/MYLAPS-GA-abc123/training/activities?count=1&order=desc'],
    ['/api/mylaps/laps/7561524117', 'https://practice-api.speedhive.com/api/v1/training/activities/7561524117/sessions'],
    ['/api/mylaps/locations/2040?year=2026&sport=IceSkating&count=250&offset=200', 'https://practice-api.speedhive.com/api/v1/locations/2040/activities?year=2026&sport=IceSkating&count=250&offset=200'],
    ['/api/mylaps/chips/PZ-28583', 'https://practice-api.speedhive.com/api/v1/chips/code/PZ-28583/training/activities'],
    ['/api/mylaps/search?term=jaap&count=2', 'https://search.speedhive.com/api/search?term=jaap&count=2&offset=0&category=Active&type=Profiles']
];
for (const [path, expected] of routes) {
    calls = [];
    const response = await get(path);
    check(`route ${path}`, response.status === 200 && lastCall()?.url === expected, response.status === 200 ? '' : `status ${response.status}`);
}

// ---- MYLAPS gets the headers it expects ----
calls = [];
await get('/api/mylaps/userid/PZ-28583');
const sent = lastCall().init.headers;
check('sends Origin, Referer and Accept to MYLAPS', sent.Origin === 'https://speedhive.mylaps.com' && sent.Referer === 'https://speedhive.mylaps.com/' && sent.Accept === 'application/json');
check('turns on Cloudflare caching for the request', lastCall().init.cf?.cacheEverything === true);

// ---- caching times ----
const ttlOf = async path => { calls = []; await get(path); return lastCall().init.cf.cacheTtlByStatus['200-299']; };
check('laps of a finished activity are kept for 30 days', await ttlOf('/api/mylaps/laps/1?finished=1') === 30 * 86400);
check('laps without the finished hint are kept for 1 minute', await ttlOf('/api/mylaps/laps/1') === 60);
check('any other value for finished is not trusted', await ttlOf('/api/mylaps/laps/1?finished=yes') === 60);
check('transponder and account lookups are kept for a day', await ttlOf('/api/mylaps/userid/X-1') === 86400 && await ttlOf('/api/mylaps/account/X') === 86400);
check('activity lists are kept for 2 minutes', await ttlOf('/api/mylaps/activities/X') === 120);
check('location lists are kept for 5 minutes', await ttlOf('/api/mylaps/locations/2040?year=2026&sport=IceSkating') === 300);
calls = []; await get('/api/mylaps/laps/1?finished=1');
check('errors are never cached', lastCall().init.cf.cacheTtlByStatus['300-599'] === -1);
const finishedResponse = await get('/api/mylaps/laps/1?finished=1');
check('browser cache is capped at one day', finishedResponse.headers.get('Cache-Control') === 'public, max-age=86400', finishedResponse.headers.get('Cache-Control'));
const quick = await get('/api/mylaps/laps/1');
check('short answers get a short browser cache', quick.headers.get('Cache-Control') === 'public, max-age=60');
check('live requests (?live=1) are kept for 1 second only: laps and the list of a rink', await ttlOf('/api/mylaps/laps/1?live=1') === 1 && await ttlOf('/api/mylaps/locations/2497?year=2026&sport=IceSkating&live=1') === 1);
check('live wins over finished: a session that is still running is never kept long', await ttlOf('/api/mylaps/laps/1?finished=1&live=1') === 1);
check('any other value for live is not trusted', await ttlOf('/api/mylaps/laps/1?live=yes') === 60 && await ttlOf('/api/mylaps/locations/2497?live=2') === 300);
calls = []; await get('/api/mylaps/locations/2497?year=2026&sport=IceSkating&count=60&live=1');
check('the live parameter is not passed on to MYLAPS', !lastCall().url.includes('live'), lastCall()?.url);
check('a live answer tells the browser to keep it 1 second at most', (await get('/api/mylaps/laps/1?live=1')).headers.get('Cache-Control') === 'public, max-age=1');
check('reports Cloudflare cache status', quick.headers.get('X-Upstream-Cache') === 'MISS');

// ---- the answer is passed on unchanged ----
nextResponse = () => new Response('{"laps":[1,2,3]}', { status: 200, headers: { 'Content-Type': 'application/json' } });
check('body is passed through', (await (await get('/api/mylaps/laps/1')).text()) === '{"laps":[1,2,3]}');
nextResponse = () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/png' } });
const avatar = await get('/api/mylaps/avatar/abc');
check('avatar keeps its image type and bytes', avatar.headers.get('Content-Type') === 'image/png' && (await avatar.arrayBuffer()).byteLength === 3);
nextResponse = () => new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });

// ---- validation ----
const status = async path => (await get(path)).status;
check('unknown endpoint -> 400', await status('/api/mylaps/nope/1') === 400);
check('wrong prefix -> 400', await status('/other/laps/1') === 400);
check('missing id -> 400', await status('/api/mylaps/laps') === 400);
check('id with path tricks -> 400', await status('/api/mylaps/laps/..%2F..%2Fadmin') === 400);
check('id with a slash -> 400', await status('/api/mylaps/laps/1/2') === 400);
check('search without a term -> 400', await status('/api/mylaps/search') === 400);
check('invalid count -> 400', await status('/api/mylaps/activities/X?count=abc') === 400);
check('count too large -> 400', await status('/api/mylaps/activities/X?count=99999') === 400);
check('invalid order -> 400', await status('/api/mylaps/activities/X?order=sideways') === 400);
calls = [];
check('the whole activity list can be requested (count=500)', await status('/api/mylaps/activities/X?count=500') === 200 && lastCall().url.endsWith('/activities?count=500'), lastCall()?.url);
check('one more than the maximum is refused (count=501)', await status('/api/mylaps/activities/X?count=501') === 400);
check('invalid sport -> 400', await status('/api/mylaps/locations/2040?sport=../x') === 400);
calls = [];
await get('/api/mylaps/locations/2040?year=2026&sport=IceSkating&evil=1&count=5');
check('unknown query parameters are not passed on', !lastCall().url.includes('evil'));
check('root path answers', (await get('/')).status === 200);
check('POST is refused', (await handleRequest(new Request('https://proxy.example/api/mylaps/laps/1', { method: 'POST' }), {})).status === 405);

// ---- CORS ----
const ok = await get('/api/mylaps/laps/1', { Origin: SITE });
check('allowed website gets its origin echoed', ok.headers.get('Access-Control-Allow-Origin') === SITE);
check('local file pages (Origin: null) are allowed', (await get('/api/mylaps/laps/1', { Origin: 'null' })).status === 200);
const blocked = await get('/api/mylaps/laps/1', { Origin: 'https://evil.example' });
check('other websites are refused', blocked.status === 403 && blocked.headers.get('Access-Control-Allow-Origin') === null);
check('requests without Origin (images, curl) work', (await get('/api/mylaps/laps/1')).status === 200);
const preflight = await handleRequest(new Request('https://proxy.example/api/mylaps/laps/1', { method: 'OPTIONS', headers: { Origin: SITE } }), {});
check('preflight answers 204 with CORS headers', preflight.status === 204 && preflight.headers.get('Access-Control-Allow-Origin') === SITE);
const custom = await handleRequest(new Request('https://proxy.example/api/mylaps/laps/1', { headers: { Origin: 'https://mysite.example' } }), { ALLOWED_ORIGINS: 'https://mysite.example' });
check('ALLOWED_ORIGINS variable overrides the default list', custom.status === 200);

// ---- errors from MYLAPS ----
nextResponse = () => new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' });
const denied = await get('/api/mylaps/laps/1', { Origin: SITE });
const deniedBody = await denied.json();
check('MYLAPS error keeps its status and gives {error}', denied.status === 401 && deniedBody.error === 'MYLAPS API error: Unauthorized' && deniedBody.details === 'Unauthorized', JSON.stringify(deniedBody));
check('error answers are not cached by browsers', denied.headers.get('Cache-Control') === 'no-store');
check('error answers still carry CORS headers', denied.headers.get('Access-Control-Allow-Origin') === SITE);
nextResponse = () => new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
check('MYLAPS 500 is passed on as 500', await status('/api/mylaps/laps/1') === 500);
nextResponse = () => { throw new Error('connection reset'); };
const down = await get('/api/mylaps/laps/1');
check('network failure -> 502', down.status === 502 && (await down.json()).error === 'Could not reach MYLAPS.');

console.log(failures ? `\n${failures} FAILED` : '\nALL PASS');
process.exit(failures ? 1 : 0);
