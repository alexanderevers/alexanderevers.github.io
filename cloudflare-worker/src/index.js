/**
 * MYLAPS proxy as a Cloudflare Worker.
 *
 * The MYLAPS Speedhive API does not allow requests straight from a browser (CORS) and expects an Origin
 * and Referer header that a browser cannot set. This Worker forwards the website's requests with those
 * headers and adds CORS headers to the answer. It exposes these paths:
 *
 *   /api/mylaps/userid/:transponder     /api/mylaps/laps/:activityId[?finished=1]
 *   /api/mylaps/activities/:userId      /api/mylaps/account/:userId
 *   /api/mylaps/avatar/:imageId         /api/mylaps/locations/:locationId?year&sport&count&offset
 *   /api/mylaps/chips/:chipCode         /api/mylaps/search?term&count&offset
 *
 * Caching: answers are cached on Cloudflare's network (fetch with cacheEverything), so a second request
 * for the same data does not reach MYLAPS at all. The browser is told to cache too (Cache-Control).
 */

const MYLAPS_HEADERS = {
    Accept: 'application/json',
    Origin: 'https://speedhive.mylaps.com',
    Referer: 'https://speedhive.mylaps.com/'
};

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

// Websites that may use this Worker from a browser. "null" is what a page opened from a local file sends.
// Override with the ALLOWED_ORIGINS variable (comma separated) in wrangler.toml.
const DEFAULT_ALLOWED_ORIGINS = [
    'https://alexanderevers.github.io',
    'http://localhost:8080', 'http://127.0.0.1:8080',
    'http://localhost:5500', 'http://127.0.0.1:5500',
    'null'
];

// Never keep an answer in the visitor's browser longer than this, however long Cloudflare keeps it.
const MAX_BROWSER_CACHE_SECONDS = DAY;

// The live page asks for ?live=1: a session may be running, so the answer is kept for one second only,
// which lets the page refresh every second.
const LIVE_SECONDS = 1;
const isLive = url => url.searchParams.get('live') === '1';

// Ids are letters, digits, dot, dash and underscore; nothing that could change the path we call.
const SAFE_ID = /^[A-Za-z0-9._-]{1,100}$/;

/** Query parameter validators: return the cleaned value, or null when it is not acceptable. */
const intBetween = (min, max) => value => (/^\d{1,9}$/.test(value) && +value >= min && +value <= max ? String(+value) : null);
const oneOf = allowed => value => (allowed.includes(value) ? value : null);
const letters = value => (/^[A-Za-z]{2,30}$/.test(value) ? value : null);
const text = value => (value.length >= 1 && value.length <= 100 ? value : null);

/**
 * How each endpoint is called and cached.
 *  - url:   the MYLAPS address for the id from the path
 *  - query: the query parameters we pass on: name -> { check, fallback? }; anything else is dropped
 *  - ttl:   how long Cloudflare keeps the answer, in seconds (may depend on the request)
 */
const ENDPOINTS = {
    userid: {
        url: id => `https://usersandproducts-api.speedhive.com/api/v2/products/chips/code/${id}/account`,
        ttl: () => DAY               // which account a transponder belongs to almost never changes
    },
    account: {
        url: id => `https://usersandproducts-api.speedhive.com/api/v2/accounts/${id}/profiles`,
        ttl: () => DAY
    },
    avatar: {
        url: id => `https://usersandproducts-api.speedhive.com/api/v2/image/id/${id}`,
        ttl: () => DAY,
        binary: true
    },
    activities: {
        url: id => `https://practice-api.speedhive.com/api/v1/accounts/${id}/training/activities`,
        query: { count: { check: intBetween(1, 500), fallback: '100' }, order: { check: oneOf(['asc', 'desc']) } },
        ttl: () => 2 * MINUTE        // new sessions show up here, so keep it fresh
    },
    laps: {
        url: id => `https://practice-api.speedhive.com/api/v1/training/activities/${id}/sessions`,
        // The website adds ?finished=1 for an activity that started on an earlier day and has ended. Its laps can no longer
        // change, so they are kept for a long time. Activities of today are only kept for a minute.
        // ?live=1 (the live page) keeps it one second.
        ttl: url => (isLive(url) ? LIVE_SECONDS : url.searchParams.get('finished') === '1' ? 30 * DAY : MINUTE)
    },
    locations: {
        url: id => `https://practice-api.speedhive.com/api/v1/locations/${id}/activities`,
        query: {
            year: { check: intBetween(2000, 2100) },
            sport: { check: letters },
            count: { check: intBetween(1, 1000) },
            offset: { check: intBetween(0, 1000000) }
        },
        ttl: url => (isLive(url) ? LIVE_SECONDS : 5 * MINUTE)   // ?live=1 (the live page): one second
    },
    chips: {
        url: id => `https://practice-api.speedhive.com/api/v1/chips/code/${id}/training/activities`,
        ttl: () => 2 * MINUTE
    },
    search: {
        noParam: true,
        url: () => 'https://search.speedhive.com/api/search',
        query: {
            term: { check: text, required: true },
            count: { check: intBetween(1, 100), fallback: '25' },
            offset: { check: intBetween(0, 100000), fallback: '0' }
        },
        fixedQuery: { category: 'Active', type: 'Profiles' },
        ttl: () => 10 * MINUTE
    }
};

function allowedOrigins(env) {
    const configured = env && env.ALLOWED_ORIGINS;
    return configured ? configured.split(',').map(o => o.trim()).filter(Boolean) : DEFAULT_ALLOWED_ORIGINS;
}

function corsHeaders(origin) {
    return origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
}

function jsonError(status, message, extra = {}, origin = null) {
    return new Response(JSON.stringify({ error: message, ...extra }), {
        status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(origin) }
    });
}

/** Builds the MYLAPS query string from the request, or returns { error }. */
function buildQuery(endpoint, requestUrl) {
    const params = new URLSearchParams();
    for (const [name, rule] of Object.entries(endpoint.query || {})) {
        const raw = requestUrl.searchParams.get(name);
        if (raw === null || raw === '') {
            if (rule.required) return { error: `Query parameter "${name}" is required.` };
            if (rule.fallback !== undefined) params.set(name, rule.fallback);
            continue;
        }
        const clean = rule.check(raw);
        if (clean === null) return { error: `Query parameter "${name}" is not valid.` };
        params.set(name, clean);
    }
    for (const [name, value] of Object.entries(endpoint.fixedQuery || {})) params.set(name, value);
    return { params };
}

export async function handleRequest(request, env = {}) {
    const origin = request.headers.get('Origin');
    const allowed = allowedOrigins(env);
    const originAllowed = !origin || allowed.includes(origin);
    const corsOrigin = origin && originAllowed ? origin : null;

    // Only refuse browsers on other websites; plain image tags and tools like curl send no Origin.
    if (!originAllowed) return jsonError(403, 'This website is not allowed to use this proxy.');

    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                ...corsHeaders(corsOrigin),
                'Access-Control-Allow-Methods': 'GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': String(DAY)
            }
        });
    }
    if (request.method !== 'GET') return jsonError(405, 'Method Not Allowed', {}, corsOrigin);

    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '') {
        return new Response('MYLAPS proxy is running.', { headers: { 'Content-Type': 'text/plain', ...corsHeaders(corsOrigin) } });
    }

    // Expected path: /api/mylaps/{endpoint}/{id}
    const parts = url.pathname.split('/').filter(Boolean);
    const [api, product, endpointName, param] = parts;
    const endpoint = api === 'api' && product === 'mylaps' ? ENDPOINTS[endpointName] : undefined;
    if (!endpoint || parts.length > (endpoint.noParam ? 3 : 4)) {
        return jsonError(400, `Invalid MYLAPS API endpoint. Expected format: /api/mylaps/{${Object.keys(ENDPOINTS).join('|')}}/{id}`, {}, corsOrigin);
    }
    if (!endpoint.noParam && (!param || !SAFE_ID.test(param))) {
        return jsonError(400, 'Missing or invalid id in the path.', {}, corsOrigin);
    }

    const query = buildQuery(endpoint, url);
    if (query.error) return jsonError(400, query.error, {}, corsOrigin);

    const upstreamUrl = new URL(endpoint.url(param ? encodeURIComponent(param) : ''));
    upstreamUrl.search = query.params.toString();

    const ttl = endpoint.ttl(url);
    let upstream;
    try {
        upstream = await fetch(upstreamUrl.toString(), {
            headers: MYLAPS_HEADERS,
            cf: {
                cacheEverything: true,
                // Keep good answers for `ttl` seconds; never keep errors.
                cacheTtlByStatus: { '200-299': ttl, '300-599': -1 }
            }
        });
    } catch (error) {
        return jsonError(502, 'Could not reach MYLAPS.', { details: String(error && error.message || error) }, corsOrigin);
    }

    if (!upstream.ok) {
        const details = (await upstream.text().catch(() => '')).slice(0, 500);
        return jsonError(upstream.status, `MYLAPS API error: ${upstream.statusText || upstream.status}`, { details }, corsOrigin);
    }

    return new Response(upstream.body, {
        status: 200,
        headers: {
            'Content-Type': upstream.headers.get('Content-Type') || (endpoint.binary ? 'application/octet-stream' : 'application/json'),
            'Cache-Control': `public, max-age=${Math.min(ttl, MAX_BROWSER_CACHE_SECONDS)}`,
            // HIT / MISS as reported by Cloudflare's cache, handy to check that caching works.
            'X-Upstream-Cache': upstream.headers.get('cf-cache-status') || 'none',
            ...corsHeaders(corsOrigin),
            'Access-Control-Expose-Headers': 'X-Upstream-Cache'
        }
    });
}

export default {
    fetch: (request, env) => handleRequest(request, env)
};
