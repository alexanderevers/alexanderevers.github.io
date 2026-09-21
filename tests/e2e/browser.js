/**
 * Helpers for the browser test: a static server for the project (with the fake API injected into the
 * HTML pages) and a headless Chrome/Edge that is driven through the DevTools protocol. No extra packages.
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { PROJECT_ROOT } = require('../helpers/browser-scripts');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.gpx': 'application/gpx+xml', '.txt': 'text/plain',
    '.webmanifest': 'application/manifest+json', '.png': 'image/png'
};

/** Serves the project folder. HTML pages get `injectIntoHead` (the fake API script) right after <head>. */
function startStaticServer(injectIntoHead, listenPort = 0) {
    const server = http.createServer((request, response) => {
        const relative = decodeURIComponent(request.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
        const file = path.resolve(PROJECT_ROOT, relative);
        if (!file.startsWith(PROJECT_ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            response.writeHead(404);
            response.end('not found');
            return;
        }
        let body = fs.readFileSync(file);
        const type = MIME[path.extname(file)] || 'application/octet-stream';
        if (type === 'text/html') body = Buffer.from(body.toString('utf8').replace('<head>', `<head>${injectIntoHead}`));
        response.writeHead(200, { 'Content-Type': type });
        response.end(body);
    });
    return new Promise(resolve => server.listen(listenPort, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

/** The first Chrome, Chromium or Edge found (or the one in CHROME_PATH). */
function findBrowser() {
    const candidates = [
        process.env.CHROME_PATH,
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'
    ].filter(Boolean);
    return candidates.find(candidate => fs.existsSync(candidate));
}

/**
 * Stops the browser AND every helper process it started (renderer, GPU, network).
 *  1. the process we started, with its children, when it is still running;
 *  2. every process whose command line contains this run's unique profile folder name. This second step is
 *     needed because Edge/Chrome sometimes hand over to a separate browser process and the process we
 *     started exits at once; killing "our" process would then stop nothing. Killing only the main process
 *     is never enough on Windows: the helpers keep running and keep the profile folder locked.
 */
function stopBrowser(child, profile) {
    if (child.exitCode === null && child.pid) {
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        } else {
            try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }   // it leads its own process group
        }
    }
    const marker = path.basename(profile);   // "mylaps-e2e-XXXXXX": unique to this run
    if (process.platform === 'win32') {
        const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${marker}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
        spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' });
    } else {
        spawnSync('pkill', ['-9', '-f', marker], { stdio: 'ignore' });
    }
}

function waitForExit(child, timeoutMs = 5000) {
    if (child.exitCode !== null) return Promise.resolve();
    return new Promise(resolve => { const timer = setTimeout(resolve, timeoutMs); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
}

async function launchBrowser(browserPath) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mylaps-e2e-'));
    const port = 9300 + Math.floor(Math.random() * 600);
    const process_ = spawn(browserPath, [
        '--headless', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
        `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, 'about:blank'
    ], { stdio: 'ignore', detached: process.platform !== 'win32' });

    let targets;
    for (let attempt = 0; attempt < 40 && !targets; attempt++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
            if (list.some(t => t.type === 'page')) targets = list;
        } catch { /* not up yet */ }
        if (!targets) await sleep(250);
    }
    if (!targets) {
        stopBrowser(process_, profile);
        await waitForExit(process_);
        try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* best effort */ }
        throw new Error('The browser did not start.');
    }

    const socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });

    let nextId = 0;
    const pending = new Map();
    const problems = [];    // exceptions and console.error output of the page
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) { pending.get(message.id)(message.result || message.error); pending.delete(message.id); }
        if (message.method === 'Runtime.exceptionThrown') {
            const details = message.params.exceptionDetails;
            problems.push('exception: ' + (details.exception?.description || details.text));
        }
        if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
            problems.push('console.error: ' + message.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
        }
    });
    const send = (method, params = {}) => new Promise(resolve => { const id = ++nextId; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    // Avatars are plain <img> tags that go to the real proxy address. A test must not depend on it (or hit it),
    // so those requests are blocked; the pages hide a failed avatar, which is the behaviour under test anyway.
    await send('Network.enable');
    await send('Network.setBlockedURLs', { urls: ['*://*.workers.dev/*'] });

    /** Runs JavaScript in the page and returns the (JSON-able) result. Throws when the script throws. */
    async function evaluate(expression) {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error('page script failed: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text));
        return result.result.value;
    }
    async function waitFor(expression, description, timeoutMs = 30000) {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            try { if (await evaluate(expression) === true) return; } catch { /* page still loading */ }
            await sleep(150);
        }
        throw new Error(`Timed out after ${timeoutMs / 1000} s waiting for: ${description}`);
    }
    async function navigate(url) {
        await send('Page.navigate', { url });
        // "interactive" = the page's scripts have run; "complete" would also wait for every image and the CDN.
        await waitFor(`location.href.startsWith(${JSON.stringify(url.split('?')[0])}) && document.readyState !== "loading"`, 'the page to load');
    }
    async function close() {
        try { socket.close(); } catch { /* already closed */ }
        stopBrowser(process_, profile);
        await waitForExit(process_);
        await sleep(500);   // let the operating system release the files
        // Best effort: a leftover temp folder must never turn a passing run into a failing one.
        try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* leave it to the OS temp cleanup */ }
    }
    return { evaluate, waitFor, navigate, send, sleep, problems, close };
}

module.exports = { startStaticServer, findBrowser, launchBrowser, sleep };
