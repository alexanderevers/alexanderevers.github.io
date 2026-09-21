/**
 * Browser test of the live page (live.html) against a fake rink where laps come in while the test runs
 * (fixtures/fake-live-stub.js): who is on the ice, the list and its order, the track, laps arriving, a rider
 * with private results, a rider who has just started, another rink, a failing rink, and pausing when the tab is hidden.
 *
 * Run:  npm run test:e2e        (needs Chrome, Chromium or Edge; set CHROME_PATH if it is not found)
 * Exit code 0 = everything passed.
 */
const assert = require('node:assert/strict');
const { buildLiveStubScript } = require('../fixtures/fake-live-stub');
const { startStaticServer, findBrowser, launchBrowser } = require('./browser');

let failures = 0;
async function step(name, run) {
    try {
        await run();
        console.log(`PASS  ${name}`);
    } catch (error) {
        failures++;
        console.log(`FAIL  ${name}\n      ${String(error.message).split('\n').join('\n      ')}`);
    }
}

(async () => {
    const browserPath = findBrowser();
    if (!browserPath) {
        console.error('No Chrome, Chromium or Edge found. Install one, or set CHROME_PATH to its executable.');
        process.exit(2);
    }
    const { server, port } = await startStaticServer(buildLiveStubScript());
    const base = `http://127.0.0.1:${port}`;
    const page = await launchBrowser(browserPath);
    const text = async selector => page.evaluate(`(document.querySelector(${JSON.stringify(selector)}) || {}).textContent`);
    const count = async selector => page.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
    const states = async () => JSON.parse(await page.evaluate('JSON.stringify(window.__live.states())'));
    const rowNames = selector => page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(selector)})].map(r => r.cells[0].textContent.trim()))`).then(JSON.parse);

    try {
        await page.navigate(`${base}/live.html?rink=2497&poll=2`);
        await page.waitFor('window.__live && window.__live.states().length >= 5 && window.__live.states().filter(s => s.status === "skating").length >= 2', 'the riders of the fake rink');

        await step('live: the page is called Live, shows the rink and how many are on the ice, and reports itself in the title', async () => {
            assert.match(await page.evaluate('document.title'), /^\(\d+\) Live · Thialf \(Heerenveen\) · Icesights$/);
            assert.match(await text('#liveStatus'), /^Thialf \(Heerenveen\) · \d+ on the ice.* · updated \d+ s ago · about \d+ requests a minute$/);
            assert.equal(await page.evaluate('document.getElementById("rinkSelect").value'), '2497');
            assert.equal(await count('#rinkSelect option'), 19);
        });

        await step('live: who is looked at: the ones on the ice, the one who rests, the private one; the rider from 40 minutes ago is not', async () => {
            const all = await states();
            assert.deepEqual(all.map(s => s.id).sort(), [9001, 9002, 9003, 9004, 9006]);
            const status = id => all.find(s => s.id === id).status;
            assert.equal(status(9001), 'skating');
            assert.equal(status(9002), 'skating');
            assert.equal(status(9003), 'resting');
            assert.equal(all.find(s => s.id === 9004).isPrivate, true);
            assert.ok(['waiting', 'skating'].includes(status(9006)));
            const groups = JSON.parse(await page.evaluate('JSON.stringify([...document.querySelectorAll(".live-group th")].map(t => t.textContent.trim()))'));
            assert.ok(groups.some(g => g.startsWith('On the ice')), JSON.stringify(groups));
            assert.ok(groups.some(g => g.startsWith('Recently on the ice')), JSON.stringify(groups));
            assert.ok(groups.some(g => g.startsWith('Results are private')), JSON.stringify(groups));
            assert.deepEqual(await rowNames('.live-row.resting'), ['RE-10003']);                 // no label: the transponder code
            assert.match(await text('.live-row.private'), /Private Pete\s*results are private/);
            assert.equal(await count('.live-row.private'), 1, 'a private rider must be listed once, in his own group');
            const onIce = await page.evaluate('document.querySelector(".live-group th").textContent.trim()');
            assert.match(onIce, /^On the ice \((\d+)\)$/);
            assert.equal(Number(/\((\d+)\)/.exec(onIce)[1]), await count('.live-row.skating, .live-row.waiting'), 'the number in the group title is not the number of rows');
        });

        await step('live: each rider on the ice has laps, last lap, best lap and the time since the last crossing', async () => {
            const cells = await page.evaluate('JSON.stringify([...[...document.querySelectorAll(".live-row.skating")].find(r => r.cells[0].textContent.includes("Fast Fanny")).cells].map(c => c.textContent.trim()))').then(JSON.parse);
            assert.equal(cells[0], 'Fast Fanny');
            assert.ok(Number(cells[1]) >= 8, `laps: ${cells[1]}`);          // 60 s at a lap every 6 s
            assert.equal(cells[2], '6.000');
            assert.equal(cells[3], '6.000');
            assert.match(cells[4], /^\d+ s$/);
            assert.match(cells[5], /^[0-9]{2}:[0-9]{2}$/);                    // started
            assert.match(cells[6], /^[0-9]+ min$|^[0-9]+ h [0-9]{2} min$/);      // duration
        });

        await step('live: new laps arrive by themselves, and the page only asks for live data (live=1)', async () => {
            const before = (await states()).find(s => s.id === 9001).lapCount;
            await page.waitFor(`window.__live.states().find(s => s.id === 9001).lapCount > ${before}`, 'a new lap of the fast rider', 15000);
            const requests = JSON.parse(await page.evaluate('JSON.stringify(window.__liveRequests)'));
            assert.ok(requests.length > 4);
            assert.ok(requests.every(url => /[?&]live=1(&|$)/.test(url)), 'a request without live=1: ' + requests.find(url => !/live=1/.test(url)));
            assert.ok(requests.some(url => /\/locations\/2497\?/.test(url) && /sport=IceSkating/.test(url) && /count=100/.test(url)));
        });

        await step('live: the rider who has just started shows as waiting, and then gets a first lap', async () => {
            await page.waitFor('window.__live.states().find(s => s.id === 9006).lapCount >= 1', 'the first lap of the rider who just started', 30000);
            const rider = (await states()).find(s => s.id === 9006);
            assert.equal(rider.status, 'skating');
            assert.equal(rider.lastMs, 12000);
        });

        await step('live: sorting by the fastest lap puts the fastest rider first; sorting by latest crossing follows the clock', async () => {
            await page.evaluate('(() => { const s = document.getElementById("sortSelect"); s.value = "best"; s.dispatchEvent(new Event("change")); })()');
            await page.sleep(400);
            const bestFirst = await rowNames('.live-row.skating');
            assert.equal(bestFirst[0], 'Fast Fanny');                                           // 6 s against 9 s and 12 s
            await page.evaluate('(() => { const s = document.getElementById("sortSelect"); s.value = "recent"; s.dispatchEvent(new Event("change")); })()');
            await page.sleep(400);
            const recent = await rowNames('.live-row.skating');
            const bySince = (await states()).filter(s => s.status === 'skating').sort((a, b) => a.sinceMs - b.sinceMs).map(s => s.label);
            assert.equal(recent.length, bySince.length);
            assert.ok(recent[0] === bySince[0] || Math.abs((await states()).find(s => s.label === recent[0]).sinceMs - (await states()).find(s => s.label === bySince[0]).sinceMs) < 2500, `${recent} against ${bySince}`);
            assert.equal(await page.evaluate('localStorage.getItem("mylaps.liveSort")'), '"recent"');
        });

        await step('live: the track shows the riders as moving dots; clicking a row selects the rider', async () => {
            const canvasImage = () => page.evaluate('document.getElementById("liveTrack").toDataURL()');
            const first = await canvasImage();
            await page.sleep(1200);
            assert.notEqual(await canvasImage(), first, 'the dots did not move');
            const dots = await page.evaluate(`(() => { const c = document.getElementById("liveTrack"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255 && (Math.abs(d[i] - d[i + 1]) > 60 || Math.abs(d[i + 1] - d[i + 2]) > 60)) n++; return n; })()`);
            assert.ok(dots > 100, `only ${dots} coloured pixels on the track`);
            await page.evaluate('[...document.querySelectorAll(".live-row.skating")].find(r => r.cells[0].textContent.includes("Steady Sam")).click()');
            await page.sleep(400);
            assert.equal(await count('.live-row.selected'), 1);
            assert.match(await text('.live-row.selected'), /Steady Sam/);
            await page.evaluate('document.querySelector(".live-row.selected").click()');
            await page.sleep(400);
            assert.equal(await count('.live-row.selected'), 0);
        });

        await step('live: the lap graph: a message first, then the lap times of the selected rider, with a slider for the maximum', async () => {
            assert.match(await text('#liveLapEmpty'), /Select a rider/);
            assert.ok(!/estimate/i.test(await text('body')), 'the estimate note is still there');
            const pick = name => page.evaluate('[...document.querySelectorAll(".live-row")].find(r => r.cells[0].textContent.includes(' + JSON.stringify(name) + ')).click()');
            await pick('Steady Sam');
            await page.waitFor('window.__live.lapGraph().drawn > 0', 'graph drawn');
            assert.equal(await text('#liveLapTitle'), 'Lap times · Steady Sam');
            assert.match(await text('#liveLapReadout'), /^[0-9]+ laps · last 9 · best 9 · average 9$/);
            let info = await page.evaluate('JSON.stringify(window.__live.lapGraph())').then(JSON.parse);
            assert.equal(info.greyed, 0);
            assert.ok(info.inView >= 3, 'laps in view: ' + info.inView);
            assert.ok(info.newest, 'no newest lap');
            // the tooltip on the newest lap
            await page.evaluate('(() => { const c = document.getElementById("liveLapCanvas"); const r = c.getBoundingClientRect(); const n = window.__live.lapGraph().newest; c.dispatchEvent(new MouseEvent("mousemove", { clientX: r.left + n.x, clientY: r.top + n.y, bubbles: true })); })()');
            assert.match(await text('#liveLapTooltip'), /^Lap [0-9]+/);
            // the slider: everything slower than 5 s is greyed out, no lap is lost
            await page.evaluate('(() => { const s = document.getElementById("liveLapMax"); s.value = "5"; s.dispatchEvent(new Event("input")); })()');
            await page.waitFor('window.__live.lapGraph().inView === 0 && window.__live.lapGraph().greyed >= 3', 'laps greyed out');
            // another rider: the maximum is automatic again
            await pick('Fast Fanny');
            await page.waitFor('window.__live.lapGraph().auto === true && window.__live.lapGraph().inView >= 3', 'automatic maximum');
            assert.equal(await text('#liveLapTitle'), 'Lap times · Fast Fanny');
            // a private rider has no lap times
            await pick('Private Pete');
            await page.waitFor('!document.getElementById("liveLapEmpty").classList.contains("hidden")', 'private message');
            assert.match(await text('#liveLapEmpty'), /keeps the results private/);
            await pick('Private Pete');       // let go
            await page.waitFor('/Select a rider/.test(document.getElementById("liveLapEmpty").textContent)', 'placeholder');
        });

        await step('live: another rink is loaded, shows a clear message when nobody is on the ice, and is remembered', async () => {
            await page.evaluate('(() => { const s = document.getElementById("rinkSelect"); s.value = "3930"; s.dispatchEvent(new Event("change")); })()');
            await page.waitFor('window.__live.rink().id === 3930 && !!document.querySelector(".live-empty")', 'the empty rink');
            assert.match(await text('.live-empty'), /Nobody has crossed the finish line/);
            assert.match(await text('#liveStatus'), /^Leiden IJshal de Vliet · 0 on the ice/);
            assert.equal(await page.evaluate('localStorage.getItem("mylaps.liveRink")'), '3930');
            assert.ok(JSON.parse(await page.evaluate('JSON.stringify(window.__liveRequests)')).some(url => /\/locations\/3930\?/.test(url)));
            await page.evaluate('(() => { const s = document.getElementById("rinkSelect"); s.value = "2497"; s.dispatchEvent(new Event("change")); })()');
            await page.waitFor('window.__live.rink().id === 2497 && window.__live.states().length >= 5', 'Thialf again');
        });

        await step('live: a rink that cannot be loaded shows a message and the page keeps trying', async () => {
            await page.evaluate('window.__liveFail = true');
            await page.waitFor('!document.getElementById("liveError").classList.contains("hidden")', 'the error message', 15000);
            assert.match(await text('#liveError'), /Internal Server Error\. Trying again in 2 s\./);
            await page.evaluate('window.__liveFail = false');
            await page.waitFor('document.getElementById("liveError").classList.contains("hidden")', 'the message to go away again', 15000);
        });

        await step('live: nothing is requested while the tab is hidden, and it catches up when the tab is shown again', async () => {
            const hide = value => page.evaluate(`(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => ${value} }); document.dispatchEvent(new Event("visibilitychange")); })()`);
            await hide(true);
            await page.sleep(2500);                                    // an ongoing poll may still finish
            const before = await page.evaluate('window.__liveRequests.length');
            await page.sleep(5500);                                    // more than two polls of 2 s
            assert.equal(await page.evaluate('window.__liveRequests.length'), before, 'requests were made while the tab was hidden');
            await hide(false);
            await page.waitFor(`window.__liveRequests.length > ${before}`, 'the page to ask again', 10000);
        });

        await step('live: refreshing every second is possible: the list has that choice and the page then asks once a second', async () => {
            assert.ok(await page.evaluate('[...document.getElementById("pollSelect").options].some(o => o.value === "1" && /every second/.test(o.textContent))'));
            await page.navigate(`${base}/live.html?rink=2497&poll=1`);
            await page.waitFor('window.__live && window.__live.states().length >= 5', 'the fake rink');
            const listRequests = () => page.evaluate('window.__liveRequests.filter(url => /\\/locations\\/2497\\?/.test(url)).length');
            const before = await listRequests();
            await page.sleep(4300);
            const made = (await listRequests()) - before;
            assert.ok(made >= 3 && made <= 6, `${made} list requests in 4.3 s, expected about 4`);
            assert.equal(await page.evaluate('document.getElementById("pollSelect").value'), '1');
        });

        await step('live: without a choice the page opens on IJsbaan Twente; the rink of the address wins over the one chosen last time', async () => {
            await page.evaluate('localStorage.clear()');
            await page.navigate(`${base}/live.html?poll=10`);
            await page.waitFor('!!window.__live', 'the page');
            assert.equal(await page.evaluate('window.__live.rink().id'), 456);
            assert.match(await text('#liveStatus') + await page.evaluate('document.title'), /Twente/);
            await page.evaluate('localStorage.setItem("mylaps.liveRink", "3930")');
            await page.navigate(`${base}/live.html?poll=10`);
            await page.waitFor('!!window.__live', 'the page');
            assert.equal(await page.evaluate('window.__live.rink().id'), 3930, 'the rink chosen last time is not remembered');
            await page.navigate(`${base}/live.html?rink=2497&poll=10`);
            await page.waitFor('!!window.__live', 'the page');
            assert.equal(await page.evaluate('window.__live.rink().id'), 2497, 'the rink in the address should win');
        });

        await step('live: the theme switch works on this page too', async () => {
            await page.evaluate('document.getElementById("themeToggle").click()');
            assert.equal(await page.evaluate('document.documentElement.dataset.theme'), 'dark');
            await page.evaluate('document.getElementById("themeToggle").click()');
            assert.equal(await page.evaluate('document.documentElement.dataset.theme'), 'light');
        });

        await step('live: no sideways scrolling on a phone, and no script errors or console errors', async () => {
            await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
            await page.sleep(500);
            assert.equal(await page.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth'), false);
            await page.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
            assert.deepEqual(page.problems, []);
        });
    } finally {
        await page.close();
        server.close();
    }

    console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
    process.exit(failures ? 1 : 0);
})().catch(error => {
    console.error('The browser test could not run:', error);
    process.exit(2);
});
