/**
 * Writes mylaps-api-reference.txt: every operation of the two MYLAPS Speedhive APIs, from their live Swagger files
 * (https://practice-api.speedhive.com/swagger/ui/index and https://usersandproducts-api.speedhive.com/swagger/ui/index).
 * The text shows for each operation the method and address, what it does, its parameters, its answers, and whether
 * Icesights uses it, followed by the data models.
 *
 *   node tools/generate-api-reference.js
 */
const fs = require('node:fs');
const path = require('node:path');

const APIS = [
    { name: 'Practice API', host: 'practice-api.speedhive.com', note: 'Training activities, sessions and laps, locations (rinks, tracks) and the activities of a location.' },
    { name: 'Users and Products API', host: 'usersandproducts-api.speedhive.com', note: 'Accounts, profiles, transponders (chips), products, images, friends and organisations.' }
];

// What Icesights uses, by method and address with the parameter names left out. The Cloudflare Worker
// (cloudflare-worker/src/index.js) is the only thing that talks to MYLAPS; these are its endpoints.
const USED = {
    'GET /api/v2/products/chips/code/{}/account': 'proxy /userid/:transponder (which account a transponder belongs to)',
    'GET /api/v2/accounts/{}/profiles': 'proxy /account/:userId (name and nickname)',
    'GET /api/v2/image/id/{}': 'proxy /avatar/:imageId (profile picture)',
    'GET /api/v1/accounts/{}/training/activities': 'proxy /activities/:userId (the activity list, count=500)',
    'GET /api/v1/training/activities/{}/sessions': 'proxy /laps/:activityId (the laps of an activity)',
    'GET /api/v1/locations/{}/activities': 'proxy /locations/:locationId (everyone on the ice at a rink)',
    'GET /api/v1/chips/code/{}/training/activities': 'proxy /chips/:chipCode'
};

const HEADERS = { Origin: 'https://speedhive.mylaps.com', Referer: 'https://speedhive.mylaps.com/', Accept: 'application/json' };
const STATUS = { 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No content', 400: 'Bad request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not found', 409: 'Conflict', 500: 'Server error' };
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

const typeOf = schema => {
    if (!schema) return '';
    if (schema.$ref) return schema.$ref.replace('#/definitions/', '');
    if (schema.type === 'array') return `array of ${typeOf(schema.items) || 'items'}`;
    if (schema.type === 'object' && schema.additionalProperties) return `map of ${typeOf(schema.additionalProperties) || 'object'}`;
    let text = schema.type || 'object';
    if (schema.format) text += ` (${schema.format})`;
    if (schema.enum) text += ` - one of: ${schema.enum.join(', ')}`;
    return text;
};

const wrap = (text, indent, width = 118) => {
    const words = String(text).replace(/\s+/g, ' ').trim().split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
        if ((line + ' ' + word).length > width - indent.length && line) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
    return lines.map(l => indent + l).join('\n');
};

async function load(host) {
    const response = await fetch(`https://${host}/swagger/docs/v1`, { headers: HEADERS });
    if (!response.ok) throw new Error(`${host}: ${response.status}`);
    return response.json();
}

function describeOperation(method, address, operation, pathParameters) {
    const key = `${method.toUpperCase()} ${address.replace(/\{[^}]*\}/g, '{}')}`;
    const out = [];
    const flags = [];
    const parameters = [...(pathParameters || []), ...(operation.parameters || [])];
    const needsToken = parameters.some(p => p.in === 'header' && /^authorization$/i.test(p.name) && p.required) || /\(auth\)/i.test(operation.summary || '');
    if (needsToken) flags.push('needs a login (access token)');
    if (operation.deprecated) flags.push('deprecated');
    if (USED[key]) flags.push(`USED BY ICESIGHTS: ${USED[key]}`);
    out.push(`${method.toUpperCase().padEnd(6)} ${address}`);
    if (operation.summary && operation.summary.trim() && operation.summary.trim() !== '(Auth)') out.push(wrap(operation.summary.trim(), '       '));
    if (flags.length) out.push(wrap(`[${flags.join('; ')}]`, '       '));
    out.push(`       operationId: ${operation.operationId}`);
    if (parameters.length) {
        out.push('       Parameters:');
        parameters.forEach(p => {
            const type = p.schema ? typeOf(p.schema) : typeOf(p);
            const meta = `${p.required ? 'required' : 'optional'}`;
            out.push(`         ${p.in.padEnd(6)} ${p.name} : ${type}, ${meta}${p.description ? ` - ${p.description}` : ''}`);
        });
    } else {
        out.push('       Parameters: none');
    }
    const responses = Object.entries(operation.responses || {});
    if (responses.length) {
        out.push('       Answers:');
        responses.forEach(([status, response]) => {
            const error = Number(status) >= 400;
            const shown = response.schema && !(error && typeOf(response.schema) === 'map of object') ? ` -> ${typeOf(response.schema)}` : '';   // an error body is just details
            out.push(`         ${status} ${(response.description || '').trim() || STATUS[status] || ''}${shown}`.trimEnd());
        });
    }
    return out.join('\n');
}

(async () => {
    const lines = [];
    const specs = [];
    for (const api of APIS) specs.push({ api, spec: await load(api.host) });

    const total = specs.reduce((sum, { spec }) => sum + Object.values(spec.paths).reduce((n, item) => n + METHODS.filter(m => item[m]).length, 0), 0);
    lines.push('MYLAPS SPEEDHIVE API REFERENCE');
    lines.push('==============================');
    lines.push(`Generated on ${localDate()} from the live Swagger files of the two APIs (${total} operations):`);
    specs.forEach(({ api, spec }) => lines.push(`  - ${api.name} (${spec.info.title} ${spec.info.version}): https://${api.host}/swagger/ui/index`));
    lines.push('');
    lines.push('Regenerate with:  node tools/generate-api-reference.js');
    lines.push('');
    lines.push('HOW THESE APIS ARE CALLED');
    lines.push('-------------------------');
    lines.push(wrap('Both APIs are plain HTTPS GET/POST/... calls that answer JSON (or XML). A browser cannot call them directly (CORS), and they expect the headers "Origin: https://speedhive.mylaps.com" and "Referer: https://speedhive.mylaps.com/". Icesights therefore calls them through its Cloudflare Worker (cloudflare-worker/src/index.js), which adds those headers and only exposes the seven read operations marked USED BY ICESIGHTS below.', ''));
    lines.push(wrap('The Swagger files declare an "Apikey" header for the whole API, and operations marked "needs a login" also require an "Authorization" header with an access token of a MYLAPS account. The operations Icesights uses are public reads that work with only the two headers above (checked against the live API); for every other operation the list only shows what the Swagger file says, it has not been tried.', ''));
    lines.push(wrap('The name search that Icesights also uses (https://search.speedhive.com/api/search) belongs to a third service that has no Swagger file here, so it is not in this list.', ''));
    lines.push('');
    lines.push('Legend:  {name} in an address is a value you fill in.  path/query/header/body = where a parameter goes.');
    lines.push('');

    let chapter = 0;
    for (const { api, spec } of specs) {
        chapter++;
        const byTag = new Map();
        for (const [address, item] of Object.entries(spec.paths)) {
            for (const method of METHODS.filter(m => item[m])) {
                const operation = item[method];
                const tag = (operation.tags && operation.tags[0]) || 'Other';
                if (!byTag.has(tag)) byTag.set(tag, []);
                byTag.get(tag).push({ method, address, operation, pathParameters: item.parameters });
            }
        }
        const count = [...byTag.values()].reduce((n, list) => n + list.length, 0);
        lines.push('='.repeat(100));
        lines.push(`${chapter}. ${api.name.toUpperCase()}  -  https://${api.host}  -  ${count} operations`);
        lines.push('='.repeat(100));
        lines.push(api.note);
        lines.push('');
        lines.push('Groups: ' + [...byTag.entries()].map(([tag, list]) => `${tag} (${list.length})`).join(', '));
        lines.push('');
        for (const [tag, list] of byTag) {
            lines.push('-'.repeat(100));
            lines.push(`${tag}  (${list.length} operation${list.length === 1 ? '' : 's'})`);
            lines.push('-'.repeat(100));
            list.forEach(({ method, address, operation, pathParameters }) => {
                lines.push(describeOperation(method, address, operation, pathParameters));
                lines.push('');
            });
        }
        lines.push(`${chapter}b. DATA MODELS OF THE ${api.name.toUpperCase()}`);
        lines.push('-'.repeat(100));
        for (const [name, definition] of Object.entries(spec.definitions || {})) {
            const properties = Object.entries(definition.properties || {});
            lines.push(`${name}${definition.description ? ` - ${definition.description}` : ''}`);
            if (definition.enum) lines.push(`    one of: ${definition.enum.join(', ')}`);
            if (definition.type === 'array' && definition.items) lines.push(`    array of ${typeOf(definition.items)}`);
            properties.forEach(([field, schema]) => lines.push(`    ${field} : ${typeOf(schema)}${(definition.required || []).includes(field) ? ' (required)' : ''}`));
            lines.push('');
        }
    }

    const file = path.join(__dirname, '..', 'mylaps-api-reference.txt');
    fs.writeFileSync(file, lines.join('\n') + '\n');
    console.log(`wrote ${path.relative(process.cwd(), file)}: ${total} operations`);
})().catch(error => { console.error(error); process.exit(1); });
