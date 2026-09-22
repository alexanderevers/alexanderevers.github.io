/**
 * Browser test of the whole flow against the fake MYLAPS data (no internet or real API needed, except that
 * the main page loads Chart.js from a CDN):
 *
 *   main page -> laps, statistics, GPX download -> overlapping riders (sorted, "skated together") ->
 *   "Select all" -> "Open replay" -> replay page (start time, coloured and small dots, clicking a dot,
 *   show/hide all, lap graph with max-lap slider, seeking, playback, theme switch).
 *
 * Run:  npm run test:e2e        (needs Chrome, Chromium or Edge; set CHROME_PATH if it is not found)
 * Exit code 0 = everything passed.
 */
const assert = require('node:assert/strict');
const { buildFakeData, CAST } = require('../fixtures/fake-mylaps-data');
const { buildStubScript } = require('../fixtures/fake-api-stub');
const { startStaticServer, findBrowser, launchBrowser } = require('./browser');

const data = buildFakeData();
const REFERENCE = CAST[0];
const ALL_DAY_ID = 40;                         // window covers yours, laps far later: skated with nobody
const OVERLAPPING = CAST.filter(r => r.id !== REFERENCE.id && r.id !== 5);   // everyone whose activity window overlaps yours
const SKATED_WITH_YOU = OVERLAPPING.filter(r => r.id !== ALL_DAY_ID);
const referenceLaps = data.lapsById[REFERENCE.id].sessions[0].laps;
// Your own activities: today's session and the older ones, and how many of them there are per year.
const MY_ACTIVITIES = Object.values(data.activities).filter(a => a.chipCode === REFERENCE.chip);
const PER_YEAR = {};
MY_ACTIVITIES.forEach(a => { const year = new Date(a.startTime).getFullYear(); PER_YEAR[year] = (PER_YEAR[year] || 0) + 1; });

let failures = 0;
let skipped = 0;
async function step(name, run) {
    try {
        await run();
        console.log(`PASS  ${name}`);
    } catch (error) {
        failures++;
        console.log(`FAIL  ${name}\n      ${String(error.message).split('\n').join('\n      ')}`);
    }
}
function skip(name, reason) {
    skipped++;
    console.log(`SKIP  ${name}  (${reason})`);
}

(async () => {
    const browserPath = findBrowser();
    if (!browserPath) {
        console.error('No Chrome, Chromium or Edge found. Install one, or set CHROME_PATH to its executable.');
        process.exit(2);
    }
    const { server, port } = await startStaticServer(buildStubScript(data));
    const base = `http://127.0.0.1:${port}`;
    const page = await launchBrowser(browserPath);
    const count = async selector => page.evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
    const text = async selector => page.evaluate(`(document.querySelector(${JSON.stringify(selector)}) || {}).textContent`);
    const visible = async selector => page.evaluate(`!document.querySelector(${JSON.stringify(selector)}).classList.contains("hidden")`);
    const click = async selector => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const setRange = async (selector, value) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); e.value = ${JSON.stringify(String(value))}; e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    const setText = async (selector, value) => setRange(selector, value);

    try {
        // ------------------------------------------------------------------ main page
        await page.navigate(`${base}/index.html?transponder=${data.referenceChip}`);
        await page.waitFor('document.getElementById("activitySelect").options.length > 1', 'the activity list to load');
        const chartAvailable = await page.evaluate('typeof Chart !== "undefined"');

        await step('main page: profile and activity list from the fake API', async () => {
            assert.equal((await text('#profile-name')).trim(), 'Alex Evers');
            assert.equal((await text('#profile-nickname')).trim(), 'Zoom');
            assert.equal(await count('#activitySelect option'), MY_ACTIVITIES.length + 1);   // placeholder + all your activities
        });

        await step('activity list: all your activities are requested and can be filtered by year', async () => {
            assert.ok(await page.evaluate('window.__proxyRequests.some(url => /\\/activities\\/[^?]+\\?count=500$/.test(url))'), 'the list was not requested with count=500');
            assert.equal(await visible('#yearFilterWrap'), true);
            const labels = JSON.parse(await page.evaluate('JSON.stringify([...document.querySelectorAll("#yearFilter option")].map(o => o.textContent))'));
            const years = Object.keys(PER_YEAR).map(Number).sort((a, b) => b - a);
            assert.deepEqual(labels, [`All years (${MY_ACTIVITIES.length})`, ...years.map(year => `${year} (${PER_YEAR[year]})`)]);

            const chooseYear = year => page.evaluate(`(() => { const f = document.getElementById("yearFilter"); f.value = "${year}"; f.dispatchEvent(new Event("change")); })()`);
            const options = () => count('#activitySelect option');
            await chooseYear('2025');
            assert.equal(await options(), PER_YEAR[2025] + 1);
            await chooseYear('2024');
            assert.equal(await options(), PER_YEAR[2024] + 1);
            await chooseYear('all');
            assert.equal(await options(), MY_ACTIVITIES.length + 1);

            // a selected activity stays selected when it is in the chosen year, and is cleared when it is not
            await page.evaluate(`(() => { const s = document.getElementById("activitySelect"); s.value = "${REFERENCE.id}"; s.dispatchEvent(new Event("change")); })()`);
            await chooseYear('2026');
            assert.equal(await page.evaluate('document.getElementById("activitySelect").value'), String(REFERENCE.id));
            await chooseYear('2025');
            assert.equal(await page.evaluate('document.getElementById("activitySelect").value'), '');
            assert.equal(await page.evaluate('document.getElementById("fetchLapsBtn").disabled'), true);
            await chooseYear('all');
        });

        await page.evaluate(`(() => { const s = document.getElementById("activitySelect"); s.value = "${REFERENCE.id}"; s.dispatchEvent(new Event("change")); })()`);

        await step('dashboards: before Fetch Laps only Start and Records are there, with two dots of navigation', async () => {
            assert.deepEqual(await page.evaluate('Dashboards.available()'), ['dashStart', 'dashRecords']);   // Records shows up once the transponder's activities are known
            assert.equal(await visible('#dashNav'), true);
            assert.equal(await page.evaluate('document.querySelectorAll("#dashNav .dash-dot").length'), 2);
            assert.equal(await page.evaluate('getComputedStyle(document.documentElement).scrollSnapType'), 'y mandatory');
        });

        await step('activities: the day of the week is in the name of the activity and in the Start Time box', async () => {
            const start = data.activities[REFERENCE.id].startTime;
            const day = await page.evaluate(`new Date(${JSON.stringify(start)}).toLocaleDateString("en-GB", { weekday: "short" })`);
            assert.match(day, /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
            const option = await page.evaluate(`document.querySelector('#activitySelect option[value="${REFERENCE.id}"]').textContent`);
            assert.match(option, new RegExp(`^${day} \\d\\d/\\d\\d/\\d{4} - \\d\\d:\\d\\d - `), option);
            const startBox = (await text('#activityInfoTable tr:nth-child(3) td:nth-child(2)')).trim();
            assert.match(startBox, new RegExp(`^${day} \\d\\d/\\d\\d/\\d{4} - \\d\\d:\\d\\d$`), startBox);
            assert.equal(option.startsWith(startBox), true, 'the name and the Start Time box should show the same date');
        });

        await step('transponder field: capitals and the dash are filled in while typing, a typed dash is not doubled, pasted text is cleaned up', async () => {
            const field = 'document.getElementById("transponderInput")';
            const value = () => page.evaluate(`${field}.value`);
            const clear = () => page.evaluate(`(() => { const f = ${field}; f.focus(); f.value = ""; })()`);
            const type = async text => { for (const character of text) await page.send('Input.insertText', { text: character }); };
            // an input event like the browser sends it after a paste or a delete
            const edit = (text, inputType) => page.evaluate(`(() => { const f = ${field}; f.value = ${JSON.stringify(text)}; f.dispatchEvent(new InputEvent("input", { inputType: ${JSON.stringify(inputType)}, bubbles: true })); })()`);
            const paste = text => page.evaluate(`(() => { const f = ${field}; f.focus(); const data = new DataTransfer(); data.setData("text", ${JSON.stringify(text)}); const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }); f.dispatchEvent(event); return event.defaultPrevented; })()`);
            try {
                await clear();
                await type('p');
                assert.equal(await value(), 'P');
                await type('z');
                assert.equal(await value(), 'PZ-', 'the dash is not added after the second letter');
                await type('-');
                assert.equal(await value(), 'PZ-', 'a typed dash was added twice');
                await type('28583');
                assert.equal(await value(), 'PZ-28583');
                await type('9');
                assert.equal(await value(), 'PZ-28583', 'a sixth digit was accepted');

                await clear();
                await type('ab-12345');                                   // somebody who types the dash themselves
                assert.equal(await value(), 'AB-12345');
                await clear();
                await type('12ab3x4');                                   // digits before the letters and letters after them are left out
                assert.equal(await value(), 'AB-34');

                await clear();
                assert.equal(await paste('transponder: pz - 28583'), true);
                assert.equal(await value(), 'PZ-28583');
                assert.equal(await paste('ab12345'), true);
                assert.equal(await value(), 'AB-12345');
                await edit('ab-12', 'insertFromPaste');                   // a partial number is cleaned up as it is pasted
                assert.equal(await value(), 'AB-12');

                await edit('AB-', 'deleteContentBackward');                // deleting: the dash and then the letters can be removed
                assert.equal(await value(), 'AB');
                await edit('A', 'deleteContentBackward');
                assert.equal(await value(), 'A');

                await clear();
                await type('QW12345');
                assert.match(await value(), /^[A-Z]{2}-\d{5}$/);
            } finally {
                await page.evaluate(`${field}.value = "${data.referenceChip}"`);   // the next steps use this number
            }
        });

        await step('dashboards: the Start dashboard fits a 1280 x 720 screen without its own vertical scrollbar', async () => {
            await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
            try {
                await page.sleep(300);
                await page.evaluate('document.getElementById("downloadGpxBtn").classList.remove("hidden")');   // the widest row of buttons
                const fit = JSON.parse(await page.evaluate('JSON.stringify((() => { const i = document.querySelector("#dashStart .dash-inner"); return { scroll: i.scrollHeight, client: i.clientHeight }; })())'));
                assert.ok(fit.scroll <= fit.client + 1, `the Start dashboard is taller than the screen: ${fit.scroll} > ${fit.client}`);
                assert.match(await text('#dashStart .lede'), /^Get insights in your ice-skating activities.$/);
                assert.match(await text('label[for="maxFastLapInput"]'), /^Lap time threshold$/);
            } finally {
                await page.evaluate('document.getElementById("downloadGpxBtn").classList.add("hidden")');
                await page.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
            }
        });

        if (!chartAvailable) {
            skip('main page: lap table, statistics and GPX download', 'Chart.js could not be loaded from the CDN (offline?)');
        } else {
            await click('#fetchLapsBtn');
            await page.waitFor('!document.getElementById("lapsData").classList.contains("hidden")', 'the laps section');

            await step('main page: session summary cards', async () => {
                assert.equal(await count('#sessionSummary .stat-card'), 9);
                assert.equal(await count('#lapsTableContainer'), 0, 'the lap table section should be gone');
                assert.match(await text('#sessionSummary'), /Avg Transponder/);
                const summary = await text('#sessionSummary');
                assert.match(summary, /Active Time/);
                assert.match(summary, /\d+% of total time/);
            });
            await step('main page: speed lap analysis (cards, blocks table with a total row, charts)', async () => {
                assert.equal(await count('#speedStats .stat-card'), 7);
                assert.ok(await count('#speedBlocks tbody tr') >= 1);
                assert.equal(await count('#speedBlocks tfoot tr'), 1);
                assert.equal(await count('#mainLapChart'), 1);
                assert.ok(await page.evaluate('Chart.getChart(document.getElementById("mainLapChart")) !== undefined'));
            });
            await step('main page: the lap time threshold slider changes the analysis', async () => {
                const before = await text('#speedStats');
                await setRange('#maxFastLapSlider', 38.5);
                assert.notEqual(await text('#speedStats'), before);
                assert.equal(await page.evaluate('document.getElementById("maxFastLapInput").value'), '38.500');
            });
            await step('main page: GPX download appears for this rink and holds a valid GPX', async () => {
                await page.waitFor('!document.getElementById("downloadGpxBtn").classList.contains("hidden")', 'the GPX button');
                const gpx = await page.evaluate('generatedGpxContent');
                assert.match(gpx, /^<\?xml/);
                assert.match(gpx, /<trk><name>Jaap Eden<\/name>/);
                assert.match(gpx, /<trkpt lat="52\.348051" lon="4\.945358">/);           // first point of the Amsterdam master track
            });
            const atTop = id => `Math.abs(document.getElementById("${id}").getBoundingClientRect().top) < 3`;
            await step('dashboards: Fetch Laps adds the session dashboards, lists them in the navigation and scrolls to Session', async () => {
                assert.deepEqual(await page.evaluate('Dashboards.available()'), ['dashStart', 'dashSession', 'speedAnalysis', 'dashRecords']);
                await page.waitFor(atTop('dashSession'), 'the page to scroll to the Session dashboard');
                await page.waitFor('document.querySelectorAll("#dashNav .dash-dot").length === 4', 'the navigation');
                const labels = JSON.parse(await page.evaluate('JSON.stringify([...document.querySelectorAll("#dashNav .dash-dot")].map(d => d.getAttribute("aria-label")))'));
                assert.deepEqual(labels, ['Start', 'Session', 'Speed laps', 'Records']);
                assert.equal(await page.evaluate('document.querySelector("#dashNav .dash-dot.active").dataset.target'), 'dashSession');
                // every dashboard fills exactly one screen
                assert.ok(await page.evaluate('[...document.querySelectorAll(".dash")].filter(d => d.getClientRects().length).every(d => Math.round(d.getBoundingClientRect().height) === innerHeight)'));
                // the hero figure is the best lap
                assert.ok(Number(await page.evaluate('parseFloat(getComputedStyle(document.querySelector("#sessionSummary .stat-card:nth-child(2) .value")).fontSize)')) >= 48, 'the best lap is not a hero figure (48 px or more)');
                assert.match(await text('#sessionSummary .stat-card:nth-child(2) .label'), /Best Lap/);
            });
            await step('records: the fetched session is remembered locally, and can be excluded (session or a single lap)', async () => {
                const recordsHidden = () => page.evaluate('document.getElementById("recordsBody").classList.contains("hidden")');
                const emptyHidden = () => page.evaluate('document.getElementById("recordsEmpty").classList.contains("hidden")');
                await page.waitFor('!document.getElementById("recordsBody").classList.contains("hidden")', 'the Records dashboard to show the fetched session');
                assert.equal(await emptyHidden(), true);
                assert.equal(await count('.records-session-row'), 1);

                // the stored sessions are hidden under a closed dropdown by default, with the count in its summary
                assert.equal(await page.evaluate('document.getElementById("recordsSessionsDetails").open'), false);
                assert.match(await text('#recordsSessionsCount'), /^\(1\)$/);
                await click('#recordsSessionsDetails summary');
                assert.equal(await page.evaluate('document.getElementById("recordsSessionsDetails").open'), true);

                // the personal best matches the "Best Lap" of the session that was just fetched
                const sessionBest = (await text('#sessionSummary .stat-card:nth-child(2) .value')).trim().split('\n')[0].trim();
                assert.equal((await text('#recordsSummary .stat-card:nth-child(1) .value')).trim(), sessionBest);
                assert.equal((await text('#recordsSummary .stat-card:nth-child(2) .value')).trim(), '1');   // one session remembered

                // "Delete" does not forget the session (its data is kept): it excludes it from the personal records,
                // greyed out, but still listed; pressing the same button again ("Restore") brings it back
                assert.equal((await text('.records-delete')).trim(), 'Delete');
                await click('.records-delete');
                await page.waitFor('document.querySelectorAll("#recordsSummary .stat-card")[1].querySelector(".value").textContent.trim() === "0"', 'the excluded session to drop out of the totals');
                assert.equal((await text('#recordsSummary .stat-card:nth-child(1) .value')).trim(), '–');
                assert.equal(await page.evaluate('document.querySelector(".records-session-row").classList.contains("excluded")'), true);
                assert.equal(await count('.records-session-row'), 1);           // still listed, just excluded and greyed out
                assert.equal((await text('.records-delete')).trim(), 'Restore');
                await click('.records-delete');
                await page.waitFor('document.querySelectorAll("#recordsSummary .stat-card")[1].querySelector(".value").textContent.trim() === "1"', 'back in the totals');
                assert.equal(await page.evaluate('document.querySelector(".records-session-row").classList.contains("excluded")'), false);
                assert.equal((await text('.records-delete')).trim(), 'Delete');

                // excluding one lap lowers the count of skating laps by one, without removing the session
                await click('.records-edit-laps');
                await page.waitFor('!!document.querySelector(".records-lap")', 'the lap grid');
                const skatingCount = text => Number(text.split('/')[0].trim());
                const before = skatingCount(await text('.records-session-row td:nth-child(4)'));
                await click('.records-lap');
                await page.waitFor('document.querySelector(".records-lap").classList.contains("excluded")', 'the lap marked excluded');
                assert.equal(skatingCount(await text('.records-session-row td:nth-child(4)')), before - 1);
                await click('.records-lap');                                     // bring it back
                await page.waitFor('!document.querySelector(".records-lap").classList.contains("excluded")', 'the lap brought back');

                // history survives a full reload of the page (it lives in localStorage, not just in memory)
                await page.navigate(`${base}/index.html?transponder=${data.referenceChip}`);
                await page.waitFor('document.getElementById("activitySelect").options.length > 1', 'the page to reload');
                await page.waitFor('!document.getElementById("recordsBody").classList.contains("hidden")', 'history to survive a page reload (localStorage)');
                assert.equal(await count('.records-session-row'), 1);

                // fetch a second, older session (one of the history activities, id 101), so there is something to click on
                await page.evaluate('(() => { const f = document.getElementById("yearFilter"); f.value = "all"; f.dispatchEvent(new Event("change")); })()');
                await page.evaluate('(() => { const s = document.getElementById("activitySelect"); s.value = "101"; s.dispatchEvent(new Event("change")); })()');
                await click('#fetchLapsBtn');
                await page.waitFor('document.querySelectorAll(".records-session-row").length === 2', 'the older session remembered too');

                // clicking a row of "Best lap per season" opens the stored sessions (even when closed) and scrolls to, and briefly
                // highlights, that session
                await page.evaluate('document.getElementById("recordsSessionsDetails").open = false');
                await click('[id="recordsPerSeason"] .records-goto[data-session="101"]');
                await page.waitFor('document.getElementById("recordsSessionsDetails").open', 'the stored sessions to open');
                await page.waitFor('document.querySelector(\'.records-session-row[data-session="101"]\').classList.contains("flash")', 'the session briefly highlighted');

                // clicking a dot of "Best lap over time" does the same
                await page.evaluate('document.getElementById("recordsSessionsDetails").open = false');
                await page.evaluate('document.getElementById("recordsChart").scrollIntoView({ block: "center" })');
                await page.sleep(500);   // let the smooth scroll (and the chart's own resize/redraw) fully settle first
                const dot = await page.evaluate(`(() => {
                    const c = document.getElementById('recordsChart');
                    const points = Chart.getChart(c).getDatasetMeta(0).data;
                    const el = points[points.length - 1];
                    const rect = c.getBoundingClientRect();
                    return JSON.stringify({ x: rect.left + el.x, y: rect.top + el.y });
                })()`).then(JSON.parse);
                await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dot.x, y: dot.y });
                await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dot.x, y: dot.y, button: 'left', clickCount: 1 });
                await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dot.x, y: dot.y, button: 'left', clickCount: 1 });
                await page.waitFor('document.getElementById("recordsSessionsDetails").open', 'clicking the chart dot to open the stored sessions too');

                // "Fetch laps" on a stored session opens it on the Session dashboard, even when a different one is currently selected
                await page.evaluate('(() => { const s = document.getElementById("activitySelect"); s.value = "1"; s.dispatchEvent(new Event("change")); })()');
                await click('.records-open[data-session="101"]');
                await page.waitFor('document.getElementById("activitySelect").value === "101"', 'the older session selected');
                await page.waitFor(atTop('dashSession'), 'and opened on the Session dashboard');

                // this device remembers one transponder's history at a time: looking up a different one does not show
                // or touch it, and offers "Change my transponder" instead
                const other = OVERLAPPING[0];
                await page.evaluate(`(() => { document.getElementById("transponderInput").value = "${other.chip}"; })()`);
                await click('#fetchActivitiesBtn');
                await page.waitFor('document.getElementById("activitySelect").options.length > 1', 'the other transponder to load');
                await page.waitFor('!document.getElementById("recordsMismatch").classList.contains("hidden")', 'the mismatch message');
                assert.equal(await page.evaluate('document.getElementById("recordsBody").classList.contains("hidden")'), true);
                assert.equal(await page.evaluate('document.getElementById("recordsEmpty").classList.contains("hidden")'), true);
                assert.equal(await page.evaluate('document.querySelector(".records-toolbar").classList.contains("hidden")'), true);
                assert.equal((await text('#recordsMismatchChip')).trim(), data.referenceChip);

                // changing to it forgets the other transponder's history, after a warning
                await page.evaluate('window.confirm = () => true');
                await click('#recordsChangeOwnerBtn');
                await page.waitFor('document.getElementById("recordsMismatch").classList.contains("hidden")', 'the mismatch to clear');
                await page.waitFor('!document.getElementById("recordsEmpty").classList.contains("hidden")', 'nothing remembered yet for the new transponder');

                // back to the reference transponder, and back where the rest of the flow left off
                await page.evaluate(`(() => { document.getElementById("transponderInput").value = "${data.referenceChip}"; })()`);
                await click('#fetchActivitiesBtn');
                await page.waitFor('document.getElementById("activitySelect").options.length > 1', 'the reference transponder to load');
                await page.evaluate(`(() => { const s = document.getElementById("activitySelect"); s.value = "${REFERENCE.id}"; s.dispatchEvent(new Event("change")); })()`);
                await click('#fetchLapsBtn');
                await page.waitFor('!document.getElementById("lapsData").classList.contains("hidden")', 'the laps section, back after switching transponders');
                await page.waitFor(atTop('dashSession'), 'back on the Session dashboard');
            });

            await step('dashboards: the navigation goes to the dashboard you click', async () => {
                await page.evaluate('document.querySelector("#dashNav .dash-dot[data-target=speedAnalysis]").click()');
                await page.waitFor(atTop('speedAnalysis'), 'the page to scroll to Speed laps');
                await page.waitFor('document.querySelector("#dashNav .dash-dot.active").dataset.target === "speedAnalysis"', 'the navigation to follow');
            });
            await step('main page: hovering a lap in the session chart shows that lap once, not the bar and the line separately', async () => {
                await page.evaluate('document.querySelector("#dashNav .dash-dot[data-target=dashSession]").click()');
                await page.waitFor(atTop('dashSession'), 'the page to scroll back to Session');
                const chartOf = 'Chart.getChart(document.getElementById("mainLapChart"))';
                // lap 10: a speed lap, so both its bar and the point of the line are drawn there
                const point = JSON.parse(await page.evaluate(`JSON.stringify((() => { const chart = ${chartOf}; const p = chart.getDatasetMeta(0).data[9].getCenterPoint(); const r = chart.canvas.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + r.height / 2 }; })())`));   // (bars grow from 0, below the axis: use the middle of the chart for y)
                await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x - 20, y: point.y });
                await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
                await page.waitFor(`${chartOf}.tooltip.opacity > 0`, 'the tooltip');
                const tip = JSON.parse(await page.evaluate(`JSON.stringify((() => { const t = ${chartOf}.tooltip; return { points: t.dataPoints.length, body: t.body.length, lines: t.body.flatMap(b => b.lines) }; })())`));
                assert.equal(tip.points, 1, 'the tooltip lists more than one item for one lap');
                assert.equal(tip.body, 1);
                assert.equal(tip.lines.filter(line => /^Lap \d+:/.test(line)).length, 1, JSON.stringify(tip.lines));
                assert.equal(tip.lines.filter(line => /^Speed:/.test(line)).length, 1, JSON.stringify(tip.lines));
                assert.match(tip.lines[0], /^Lap 10:/);
            });
        }

        // ------------------------------------------------------------------ overlapping riders
        await click('#fetchOverlappingBtn');
        await page.waitFor('!document.getElementById("replayToolbar").classList.contains("hidden")', 'the overlapping riders');

        await step(`overlapping riders: ${OVERLAPPING.length} cards; riders who do not overlap are not listed`, async () => {
            assert.equal(await count('.replay-select'), OVERLAPPING.length);
            const ids = JSON.parse(await page.evaluate('JSON.stringify([...document.querySelectorAll(".replay-select")].map(b => Number(b.dataset.activityId)))'));
            assert.ok(!ids.includes(5), 'the rider from 5 hours later is listed');
            assert.ok(!ids.includes(9), 'the old session is listed');
            assert.ok(!ids.includes(REFERENCE.id), 'you are listed as your own overlapping rider');
        });
        await step('overlapping riders: a card shows name surname, under it the transponder name and number (not twice), under that the date', async () => {
            const card = JSON.parse(await page.evaluate('JSON.stringify((() => { const c = [...document.querySelectorAll("#overlappingSessionsTable .session-card")].find(x => x.querySelector(".session-card-name").textContent.includes("Bram")); return { name: c.querySelector(".session-card-name").textContent.trim(), sub: c.querySelector(".session-card-tname").textContent.trim(), order: [...c.querySelector(".session-card-header").children].map(e => e.className || e.tagName), weight: getComputedStyle(c.querySelector(".session-card-tname")).fontWeight }; })())'));
            assert.equal(card.name, 'Bram Bakker');                                  // no more " - nickname"
            assert.match(card.sub, /^([A-Za-z]+, )?CD-11111$/);                       // (the transponder name, when there is one, and the number: once)
            assert.ok(!/CD-11111.*CD-11111/.test(card.sub), card.sub);
            assert.equal(card.order[0], 'session-card-name');
            assert.equal(card.order[1], 'session-card-tname');
            assert.equal(card.order[2], 'SMALL');
            assert.equal(card.weight, '400');                                        // small, not bold
            // a session of a few riders is not a marathon: no marathon analysis button
            assert.equal(await page.evaluate('document.getElementById("marathonBtn").classList.contains("hidden")'), true);
        });
        await step('overlapping riders: sorted by time in your group, then by time skated together; each card shows both values', async () => {
            const cards = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll("#overlappingSessionsTable .session-card")].map(card => ({
                id: Number(card.querySelector(".replay-select").dataset.activityId),
                together: card.querySelectorAll(".session-stat.together .value")[0].textContent,
                group: card.querySelectorAll(".session-stat.together .value")[1].textContent,
                dimmed: card.classList.contains("no-overlap")
            })))`));
            const minutes = value => (value === '0 min' ? 0 : value === '<1 min' ? 0.5 : Number(/(\d+) min/.exec(value)[1]) + (/(\d+) h/.test(value) ? 60 * Number(/(\d+) h/.exec(value)[1]) : 0));
            const groupMinutes = card => minutes(card.group.replace('~', ''));
            for (let i = 1; i < cards.length; i++) {
                const [before, after] = [cards[i - 1], cards[i]];
                assert.ok(groupMinutes(after) <= groupMinutes(before), `card ${i}: in your group is out of order`);
                if (groupMinutes(after) === groupMinutes(before)) assert.ok(minutes(after.together) <= minutes(before.together), `card ${i}: skated together is out of order`);
            }
            assert.ok(cards.some((c, i) => i > 0 && groupMinutes(c) === groupMinutes(cards[i - 1]) && minutes(c.together) < minutes(cards[i - 1].together)), 'the fake data has no riders with the same group minutes and different time together; the tie-break is not tested');
            assert.ok(cards.every(c => /^~/.test(c.group) || c.group === 'N/A'), 'the group value should be marked as an estimate (~)');
            const allDay = cards.find(c => c.id === ALL_DAY_ID);
            assert.equal(allDay.together, '0 min');
            assert.equal(allDay.dimmed, true);
            assert.equal(cards[cards.length - 1].id, ALL_DAY_ID, 'the rider who skated with nobody should be last');
        });
        await step('dashboards: the overlap search opens the Together dashboard, drawn as a timing tower with a position and bars per rider', async () => {
            await page.waitFor('Math.abs(document.getElementById("overlappingSessions").getBoundingClientRect().top) < 3', 'the page to scroll to Together');
            const rows = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll("#overlappingSessionsTable .session-card")].map(card => ({
                rank: card.querySelector(".session-rank").textContent,
                bars: [...card.querySelectorAll(".session-stat.together .meter > span")].map(s => parseFloat(s.style.width))
            })))`));
            assert.equal(rows.length, OVERLAPPING.length);
            assert.deepEqual(rows.map(r => r.rank), rows.map((_, i) => String(i + 1)));
            assert.ok(rows.every(r => r.bars.length === 2 && r.bars.every(w => w >= 0 && w <= 100)), 'each rider needs a bar for together and for group');
            assert.ok(rows[0].bars[0] > 90, 'skating the whole session together should fill the bar');
            assert.ok(rows[0].bars[1] < rows[0].bars[0], 'the group bar is a part of the together bar');
            assert.equal(await page.evaluate('document.querySelector("#dashNav .dash-dot.active").dataset.target'), 'overlappingSessions');
        });
        await step('overlapping riders: "Select all" picks only riders who skated with you, and toggles back', async () => {
            assert.match(await text('#replaySelectAllBtn'), new RegExp(`Select all skated together \\(${SKATED_WITH_YOU.length}\\)`));
            await click('#replaySelectAllBtn');
            assert.equal(await count('.replay-select:checked'), SKATED_WITH_YOU.length);
            assert.equal(await page.evaluate(`document.querySelector('.replay-select[data-activity-id="${ALL_DAY_ID}"]').checked`), false);
            assert.equal(await text('#replaySelectedCount'), `${SKATED_WITH_YOU.length} of ${OVERLAPPING.length} selected`);
            assert.equal((await text('#replaySelectAllBtn')).trim(), 'Select none');
            await click('#replaySelectAllBtn');
            assert.equal(await count('.replay-select:checked'), 0);
            await click('#replaySelectAllBtn');                                             // leave them selected for the replay
            assert.equal(await count('.replay-select:checked'), SKATED_WITH_YOU.length);
        });
        let replayLink = null;
        await step('open replay: the address holds the transponder, the activity and the riders; the data is stored too', async () => {
            await click('#openReplayBtn');
            replayLink = await page.evaluate('window.__opened');
            const link = new URL(replayLink, 'http://x/');
            assert.equal(link.searchParams.get('transponder'), data.referenceChip);
            assert.equal(link.searchParams.get('activity'), String(REFERENCE.id));
            const linkRiders = link.searchParams.get('riders').split(',').map(Number).sort((a, b) => a - b);
            assert.deepEqual(linkRiders, SKATED_WITH_YOU.map(r => r.id).sort((a, b) => a - b));
            const payload = JSON.parse(await page.evaluate('localStorage.getItem("replayData")'));
            assert.equal(payload.reference.id, REFERENCE.id);
            assert.equal(payload.trackLengthM, 400);
            assert.equal(payload.riders.length, OVERLAPPING.length + 1);
            assert.equal(payload.riders[0].isReference, true);
            assert.equal(payload.selected.length, SKATED_WITH_YOU.length);
            assert.ok(payload.riders.slice(1).every(r => 'togetherMs' in r && 'groupMs' in r));
        });

        // ------------------------------------------------------------------ replay page
        await page.navigate(`${base}/replay.html?activity=${REFERENCE.id}`);
        await page.waitFor('!document.getElementById("replayApp").classList.contains("hidden")', 'the replay page');
        const allLapsLoaded = '![...document.querySelectorAll(".rider-live")].some(x => x.textContent === "loading…") && document.getElementById("replayStatus").textContent === "" && !document.getElementById("playBtn").disabled';
        await page.waitFor(allLapsLoaded, 'all laps to load');

        const rowStates = async () => JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll(".rider-row")].map((row, i) => {
            const dot = row.querySelector(".rider-swatch");
            const selected = row.classList.contains("selected");
            return { i, name: row.querySelector(".rider-name").textContent.trim(), checked: row.querySelector("input").checked,
                     kind: !selected ? "none" : dot.classList.contains("small") ? "small" : "label" };
        }))`));
        const summary = states => ({ shown: states.filter(s => s.checked).length, label: states.filter(s => s.kind === 'label').length, small: states.filter(s => s.kind === 'small').length });
        const clickDot = index => page.evaluate(`document.querySelectorAll(".rider-row")[${index}].querySelector(".rider-swatch").click()`);

        await step('replay: you and the riders you selected are shown, 10 with a colour and the rest as small dots', async () => {
            const states = await rowStates();
            assert.equal(states.length, SKATED_WITH_YOU.length + 1);   // the all-day rider (0 min together) is not listed at all
            assert.deepEqual(summary(states), { shown: SKATED_WITH_YOU.length + 1, label: 10, small: SKATED_WITH_YOU.length + 1 - 10 });
            assert.equal(states[0].kind, 'label', 'you are always coloured');
            assert.equal(await text('#riderCount'), `(${SKATED_WITH_YOU.length + 1} shown, first 10 labelled)`);
        });
        await step('replay: riders with 0 min together are not in the list at all', async () => {
            const names = (await rowStates()).map(s => s.name);
            assert.equal(names.some(name => name.includes('Allday')), false, 'the all-day rider is listed');
            const details = JSON.parse(await page.evaluate('JSON.stringify([...document.querySelectorAll(".rider-row:not(:first-child) small")].map(s => s.textContent))'));
            assert.ok(details.length > 0 && details.every(text => !/together 0 min/.test(text)), 'a rider with 0 min together is listed');
            assert.match(await text('#riderCount'), new RegExp(`^\\(${SKATED_WITH_YOU.length + 1} shown`));
        });
        await step('dashboards (replay): Replay and Riders, and the track fits inside its dashboard in its own proportions', async () => {
            assert.deepEqual(await page.evaluate('Dashboards.available()'), ['dashReplay', 'dashRiders']);
            const fit = JSON.parse(await page.evaluate('JSON.stringify((() => { const c = document.getElementById("trackCanvas").getBoundingClientRect(); const w = document.getElementById("trackWrap").getBoundingClientRect(); const d = document.getElementById("dashReplay").getBoundingClientRect(); return { inside: c.left >= w.left - 1 && c.right <= w.right + 1 && c.top >= w.top - 1 && c.bottom <= w.bottom + 1, aspect: c.width / c.height, dashHeight: d.height, innerH: innerHeight, graphBottom: document.getElementById("lapCanvas").getBoundingClientRect().bottom }; })())'));
            assert.equal(fit.inside, true, 'the track spills out of its space');
            assert.ok(Math.abs(fit.aspect - 1.96) < 0.08, `the track lost its proportions: ${fit.aspect}`);
            assert.ok(fit.graphBottom <= fit.innerH, 'the lap graph is cut off below the screen');
        });
        await step('replay: the clock starts when you entered the ice, although other riders loaded first', async () => {
            assert.equal((await text('#clockLabel')).trim(), new Date(data.T0).toLocaleTimeString('en-GB'));
        });
        await step('replay: play and speed sit under the ice track, the lap graph under them, and there is no separate time slider', async () => {
            assert.equal(await count('#timeSlider'), 0);
            const order = JSON.parse(await page.evaluate('JSON.stringify([...document.querySelectorAll("#dashReplay .dash-inner > *")].map(e => e.id || e.className))'));
            const track = order.indexOf('trackWrap');
            assert.equal(order[track + 1], 'replay-controls');
            assert.equal(order[track + 2], 'lap-chart-head');
            assert.equal(order[track + 4], 'lapCanvas');
        });
        await step('replay: the lap graph follows you and the readout shows your current lap', async () => {
            assert.match(await page.evaluate('document.getElementById("followSelect").selectedOptions[0].textContent'), /\(you\)/);
            assert.match(await text('#lapReadout'), /^Lap 1 · \d+\.\ds · \d+\.\d km\/h$/);
        });
        await step('replay: each rider row shows lap, time, speed and the gap to you', async () => {
            const lives = JSON.parse(await page.evaluate('JSON.stringify([...document.querySelectorAll(".rider-row.selected .rider-live")].map(x => x.textContent))'));
            assert.ok(lives.every(l => l === 'off the ice' || /^Lap \d+ · \d+\.\ds · \d+\.\d km\/h( · [+−]\d+ m)?$/.test(l)), JSON.stringify(lives));
            assert.ok(lives.some(l => /[+−]\d+ m$/.test(l)), 'no rider shows a gap to you');
        });

        await step('replay: the back link returns to the same activity', async () => {
            const href = await page.evaluate('document.getElementById("backLink").getAttribute("href")');
            assert.equal(href, `index.html?transponder=${data.referenceChip}&activity=${REFERENCE.id}`);
        });
        await step('replay: clicking a small dot gives that rider a colour; you and the checkbox are untouched', async () => {
            const before = await rowStates();
            const lastSmall = before.filter(s => s.kind === 'small').pop();
            await clickDot(lastSmall.i);
            const after = await rowStates();
            assert.equal(after[lastSmall.i].kind, 'label');
            assert.equal(after[lastSmall.i].checked, true);
            assert.deepEqual(summary(after), summary(before), 'there are still 10 coloured riders');
            assert.equal(after[0].kind, 'label');
        });
        await step('replay: clicking a coloured dot turns the rider into a small dot, still shown', async () => {
            const before = await rowStates();
            const coloured = before.find(s => s.kind === 'label' && s.i !== 0);
            await clickDot(coloured.i);
            const after = await rowStates();
            assert.equal(after[coloured.i].kind, 'small');
            assert.equal(after[coloured.i].checked, true);
            assert.equal(summary(after).label, 10, 'the next rider takes the free colour');
        });
        await step('replay: clicking your own dot does nothing', async () => {
            const before = await rowStates();
            await clickDot(0);
            assert.deepEqual(await rowStates(), before);
        });
        await step('replay: Hide all keeps only you; Show all skated together brings back the same riders, not the all-day rider', async () => {
            await click('#hideAllBtn');
            assert.deepEqual(summary(await rowStates()), { shown: 1, label: 1, small: 0 });
            await click('#showAllBtn');
            await page.waitFor(allLapsLoaded, 'all laps to load again');
            const states = await rowStates();
            assert.equal(summary(states).shown, SKATED_WITH_YOU.length + 1);
            assert.equal(states.some(s => s.name.includes('Allday')), false);
        });
        await step('replay: a rider can be removed and added again with the checkbox', async () => {
            const index = (await rowStates()).find(s => s.name.includes('Eva')).i;
            await page.evaluate(`document.querySelectorAll(".rider-row")[${index}].querySelector("input").click()`);
            assert.equal(summary(await rowStates()).shown, SKATED_WITH_YOU.length);
            await page.evaluate(`document.querySelectorAll(".rider-row")[${index}].querySelector("input").click()`);
            await page.waitFor(allLapsLoaded, 'the rider to be shown again');
            assert.equal(summary(await rowStates()).shown, SKATED_WITH_YOU.length + 1);
        });

        await step('lap graph: starts with every lap in view; the slider zooms in; bad input is refused', async () => {
            const seconds = referenceLaps.map(l => Number(l.duration));
            assert.equal(Number(await page.evaluate('document.getElementById("lapMaxSlider").value')), Math.ceil(Math.max(...seconds)) + 1);
            await setRange('#lapMaxSlider', 40);
            assert.equal(await page.evaluate('document.getElementById("lapMaxInput").value'), '40.000');
            await setText('#lapMaxInput', 'banana');
            assert.equal(await visible('#lapMaxError'), true);
            assert.equal(await page.evaluate('document.getElementById("lapMaxSlider").value'), '40', 'the slider must keep its value');
            await setText('#lapMaxInput', '1:30.5');
            assert.equal(await visible('#lapMaxError'), false);
            assert.equal(Number(await page.evaluate('document.getElementById("lapMaxSlider").value')), 90.5);
        });
        await step('lap graph: clicking it moves the replay to that moment', async () => {
            const before = await text('#clockLabel');
            await page.evaluate('document.getElementById("lapCanvas").scrollIntoView({ block: "center" })');
            const rect = JSON.parse(await page.evaluate('JSON.stringify((() => { const r = document.getElementById("lapCanvas").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })())'));
            for (const type of ['mousePressed', 'mouseReleased']) {
                await page.send('Input.dispatchMouseEvent', { type, x: rect.x + rect.w * 0.8, y: rect.y + rect.h / 2, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
            }
            await page.sleep(300);
            const after = await text('#clockLabel');
            assert.notEqual(after, before);
            assert.match(await text('#lapReadout'), /^Lap \d+ ·/);
        });
        await step('replay: Compare draws another rider in the lap graph (paler, other colour, one at a time) and can be turned off', async () => {
            const graph = () => page.evaluate('document.getElementById("lapCanvas").toDataURL()');
            const row = name => `[...document.querySelectorAll(".rider-row")].find(r => r.querySelector(".rider-name").textContent.includes(${JSON.stringify(name)}))`;
            const clickCompare = name => page.evaluate(`${row(name)}.querySelector(".rider-compare").click()`);
            // orange pixels of the canvas (the other colour): half transparent (pale) or fully opaque
            const orangePixels = () => page.evaluate(`(() => {
                const c = document.getElementById("lapCanvas"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
                let pale = 0, pure = 0;
                for (let i = 0; i < d.length; i += 4) {
                    const [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
                    if (r > 200 && g < 140 && b < 100) { if (a >= 250) pure++; else if (a >= 110 && a <= 170) pale++; }
                }
                return { pale, pure };
            })()`);

            assert.equal(await page.evaluate('document.querySelector(".rider-row .rider-compare").classList.contains("hidden")'), true, 'you can compare with yourself');
            const before = await graph();
            assert.deepEqual(await orangePixels(), { pale: 0, pure: 0 });

            await clickCompare('Extra Rider10');
            await page.sleep(300);
            assert.notEqual(await graph(), before, 'the graph did not change');
            assert.match(await text('#compareReadout'), /^Extra Rider10: Lap \d+ · \d+\.\d\ds \([+−]\d+\.\d\ds\)$/);
            assert.equal(await page.evaluate(`${row('Extra Rider10')}.querySelector(".rider-compare").textContent`), 'Stop comparing');
            const pixels = await orangePixels();
            assert.ok(pixels.pale > 50, `no pale compare line found: ${JSON.stringify(pixels)}`);
            assert.equal(pixels.pure, 0, 'the compare line is not paler than the full colour');

            await clickCompare('Extra Rider4');                                     // another rider replaces the first
            await page.sleep(200);
            assert.match(await text('#compareReadout'), /^Extra Rider4:/);
            assert.equal(await count('.rider-compare.active'), 1);

            await page.evaluate(`${row('Extra Rider4')}.querySelector("input").click()`);   // hiding him stops the comparison
            await page.sleep(200);
            assert.equal((await text('#compareReadout')).trim(), '');
            assert.equal(await count('.rider-compare.active'), 0);
            await page.evaluate(`${row('Extra Rider4')}.querySelector("input").click()`);   // show him again
            await page.waitFor(allLapsLoaded, 'the rider to load again');

            await clickCompare('Extra Rider10');
            await clickCompare('Extra Rider10');                                    // turned off again
            await page.sleep(300);
            assert.equal((await text('#compareReadout')).trim(), '');
            assert.equal(await graph(), before, 'the graph did not return to how it was');
        });
        await step('replay: the play button advances the clock at the chosen speed', async () => {
            const seconds = label => { const [h, m, s] = label.trim().split(':').map(Number); return h * 3600 + m * 60 + s; };
            const before = seconds(await text('#clockLabel'));
            await click('#playBtn');
            assert.equal((await text('#playBtn')).trim(), 'Pause');
            await page.sleep(1500);
            const after = seconds(await text('#clockLabel'));
            await click('#playBtn');
            assert.ok(after - before >= 4, `the clock only advanced ${after - before} s in 1.5 s at 5x`);
            assert.equal((await text('#playBtn')).trim(), 'Play');
        });

        await step('replay: remembers the speed and the rider you followed last time', async () => {
            await page.evaluate(`(() => {
                const speed = document.getElementById("speedSelect"); speed.value = "30"; speed.dispatchEvent(new Event("change"));
                const follow = document.getElementById("followSelect");
                const bram = [...follow.options].find(o => o.textContent.includes("Bram"));
                follow.value = bram.value; follow.dispatchEvent(new Event("change"));
            })()`);
            await page.navigate(`${base}/replay.html?activity=${REFERENCE.id}`);
            await page.waitFor(allLapsLoaded, 'all laps to load after the reload');
            assert.equal(await page.evaluate('document.getElementById("speedSelect").value'), '30');
            assert.match(await page.evaluate('document.getElementById("followSelect").selectedOptions[0].textContent'), /Bram/);
        });

        await step('theme switch: dark mode is applied, remembered and can be switched back', async () => {
            await click('#themeToggle');
            assert.equal(await page.evaluate('document.documentElement.dataset.theme'), 'dark');
            assert.equal(await page.evaluate('localStorage.getItem("theme")'), 'dark');
            assert.notEqual(await page.evaluate('getComputedStyle(document.body).backgroundColor'), 'rgb(249, 249, 247)');
            await click('#themeToggle');
            assert.equal(await page.evaluate('document.documentElement.dataset.theme'), 'light');
        });
        await step('main page: remembers the lap time threshold', async () => {
            const mainPage = `${base}/index.html?transponder=${data.referenceChip}`;
            await page.navigate(mainPage);
            await page.waitFor('document.getElementById("activitySelect").options.length > 1', 'the activity list to load');
            await setRange('#maxFastLapSlider', 45);
            await page.navigate(mainPage);
            await page.waitFor('document.getElementById("activitySelect").options.length > 1', 'the activity list to load again');
            assert.equal(Number(await page.evaluate('document.getElementById("maxFastLapSlider").value')), 45);
            assert.equal(await page.evaluate('document.getElementById("maxFastLapInput").value'), '45.000');
        });

        if (!chartAvailable) {
            skip('deep links: a shared address opens the session', 'Chart.js could not be loaded from the CDN (offline?)');
        } else {
            await step('deep link: an address with transponder and activity opens that session', async () => {
                await page.navigate(`${base}/index.html?transponder=${data.referenceChip}&activity=${REFERENCE.id}`);
                await page.waitFor('!document.getElementById("lapsData").classList.contains("hidden")', 'the laps of the linked activity');
                assert.equal(await page.evaluate('document.getElementById("activitySelect").value'), String(REFERENCE.id));
                assert.equal(await count('#sessionSummary .stat-card'), 9);
                assert.equal(await page.evaluate('location.search'), `?transponder=${data.referenceChip}&activity=${REFERENCE.id}`);
            });
            await step('deep link: the address bar follows the chosen activity, so it can be shared', async () => {
                const other = MY_ACTIVITIES.find(a => a.id !== REFERENCE.id);
                await page.evaluate(`(() => { const s = document.getElementById("activitySelect"); s.value = "${other.id}"; s.dispatchEvent(new Event("change")); })()`);
                assert.equal(await page.evaluate('location.search'), `?transponder=${data.referenceChip}&activity=${other.id}`);
                await page.evaluate('(() => { const s = document.getElementById("activitySelect"); s.value = ""; s.dispatchEvent(new Event("change")); })()');
                assert.equal(await page.evaluate('location.search'), `?transponder=${data.referenceChip}`);
            });
            await step('deep link: an activity that is not in the list gives a clear message and is dropped from the address', async () => {
                await page.navigate(`${base}/index.html?transponder=${data.referenceChip}&activity=999999`);
                await page.waitFor('!document.getElementById("error").classList.contains("hidden")', 'the message');
                assert.match(await text('#error'), /Activity 999999 was not found/);
                assert.equal(await page.evaluate('location.search'), `?transponder=${data.referenceChip}`);
                assert.equal(await visible('#lapsData'), false);
            });
        }

        await step('phone layout: nothing makes the page scroll sideways on a 390 px wide screen, and rider details sit under the name', async () => {
            await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
            try {
                const sideways = () => page.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth');
                await page.navigate(`${base}/replay.html?activity=${REFERENCE.id}`);
                await page.waitFor(allLapsLoaded, 'all laps to load on the phone');
                assert.equal(await sideways(), false, 'replay page scrolls sideways');
                const layout = JSON.parse(await page.evaluate('JSON.stringify((() => { const row = document.querySelector(".rider-row.selected"); const name = row.querySelector(".rider-name").getBoundingClientRect(); const live = row.querySelector(".rider-live").getBoundingClientRect(); return { nameBottom: name.bottom, liveTop: live.top }; })())'));
                assert.ok(layout.liveTop >= layout.nameBottom, 'the live text is squeezed next to the name');
                await page.navigate(`${base}/index.html?transponder=${data.referenceChip}`);
                await page.waitFor('document.getElementById("activitySelect").options.length > 1', 'the activity list on the phone');
                assert.equal(await sideways(), false, 'main page scrolls sideways');
            } finally {
                await page.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
            }
        });

        // A link sent to someone else, or opened in a private window, has no stored replay data: it is rebuilt from the address.
        const shownRiders = () => page.evaluate('JSON.stringify([...document.querySelectorAll(".rider-row.selected .rider-name")].map(n => n.textContent.trim()))').then(JSON.parse);
        const addressRiders = () => page.evaluate('new URLSearchParams(location.search).get("riders")').then(value => value.split(',').map(Number).sort((x, y) => x - y));
        await step('replay link: opens the same replay without any stored data (other computer, private window)', async () => {
            await page.evaluate('localStorage.removeItem("replayData")');
            await page.navigate(`${base}/${replayLink}`);
            await page.waitFor('!document.getElementById("replayApp").classList.contains("hidden")', 'the replay to be rebuilt from the link');
            await page.waitFor(allLapsLoaded, 'all laps to load');
            assert.match(await text('#replaySubtitle'), /Jaap Eden/);
            const day = await page.evaluate(`new Date(${JSON.stringify(data.activities[REFERENCE.id].startTime)}).toLocaleDateString('en-GB', { weekday: 'short' })`);
            assert.match(await text('#replaySubtitle'), new RegExp(`· ${day} \\d\\d/\\d\\d/\\d{4} - \\d\\d:\\d\\d$`), 'the replay subtitle should start the date with the day of the week');
            const states = await rowStates();
            assert.equal(states.length, SKATED_WITH_YOU.length + 1);
            assert.equal(states.filter(s => s.checked).length, SKATED_WITH_YOU.length + 1);
            assert.equal(states.some(s => s.name.includes('Allday')), false);
            assert.match(await text('#riderList .rider-row small'), /AB-12345/);
            assert.equal(await page.evaluate('localStorage.getItem("replayData")'), null, 'the rebuilt replay should not depend on stored data');
            assert.equal((await text('#clockLabel')).trim(), new Date(data.T0).toLocaleTimeString('en-GB'));
        });
        await step('replay link: the riders in the link decide who is shown; the address follows the list', async () => {
            await page.navigate(`${base}/replay.html?transponder=${data.referenceChip}&activity=${REFERENCE.id}&riders=2,3`);
            await page.waitFor(allLapsLoaded, 'the laps of the linked riders');
            assert.deepEqual((await shownRiders()).sort(), ['Alex Evers (you)', 'Bram Bakker', 'Eva Visser']);
            assert.equal(await page.evaluate('new URLSearchParams(location.search).get("transponder")'), data.referenceChip);
            assert.deepEqual(await addressRiders(), [2, 3]);
            assert.equal(await page.evaluate('new URLSearchParams(location.search).get("activity")'), String(REFERENCE.id));
            // showing another rider changes the address
            await page.evaluate('[...document.querySelectorAll(".rider-row")].find(r => r.textContent.includes("Gijs")).querySelector("input").click()');
            await page.waitFor(allLapsLoaded, 'the added rider to load');
            assert.deepEqual(await addressRiders(), [2, 3, 4]);
        });
        await step('replay: the share button in the top right corner copies the link to this replay', async () => {
            await page.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: base });
            const corner = JSON.parse(await page.evaluate('JSON.stringify((() => { const b = document.getElementById("shareBtn").getBoundingClientRect(); return { fromRight: window.innerWidth - b.right, fromTop: b.top, width: b.width }; })())'));
            assert.ok(corner.fromRight < 260 && corner.fromTop < 40 && corner.width < 50, `the button is not a small button in the top right corner: ${JSON.stringify(corner)}`);
            assert.equal(await count('#shareBtn svg'), 1, 'the share icon is missing');
            await click('#shareBtn');
            await page.waitFor('document.getElementById("shareNote").textContent === "Link copied"', 'the confirmation');
            const copied = await page.evaluate('navigator.clipboard.readText()');
            assert.equal(copied, await page.evaluate('location.href'));
            assert.match(copied, /replay\.html\?transponder=AB-12345&activity=1&riders=/);
        });
        await step('replay link: riders=none shows only you; a link to an unknown activity gives a clear message', async () => {
            await page.navigate(`${base}/replay.html?transponder=${data.referenceChip}&activity=${REFERENCE.id}&riders=none`);
            await page.waitFor(allLapsLoaded, 'your laps');
            assert.equal((await shownRiders()).length, 1);
            await page.navigate(`${base}/replay.html?transponder=${data.referenceChip}&activity=999999&riders=2`);
            await page.waitFor('!document.getElementById("replayError").classList.contains("hidden")', 'the message');
            assert.match(await text('#replayError'), /Activity 999999 was not found/);
            assert.equal(await visible('#replayApp'), false);
        });

        await step('replay without stored data explains how to open a replay', async () => {
            await page.evaluate('localStorage.removeItem("replayData")');
            await page.navigate(`${base}/replay.html?activity=${REFERENCE.id}`);
            assert.equal(await visible('#replayEmpty'), true);
            assert.equal(await visible('#replayApp'), false);
        });
        // ------------------------------------------------------------------ installable app (PWA)
        await step('app: every page is called Icesights, links the manifest, and the manifest and its icons are served', async () => {
            const pages = [['index.html', /^Icesights$/], ['replay.html', /Icesights$/], ['search_user.html', /Icesights$/]];
            for (const [file, title] of pages) {
                await page.navigate(`${base}/${file}`);
                assert.match(await page.evaluate('document.title'), title, file);
                const href = await page.evaluate('document.querySelector("link[rel=manifest]").href');
                const manifest = JSON.parse(await page.evaluate(`fetch(${JSON.stringify(href)}).then(r => r.text())`));
                assert.equal(manifest.short_name, 'Icesights');
                for (const icon of manifest.icons) {
                    const type = await page.evaluate(`fetch(new URL(${JSON.stringify(icon.src)}, ${JSON.stringify(href)})).then(r => r.ok ? r.headers.get("content-type") : "missing")`);
                    assert.equal(type, 'image/png', `${icon.src} was not served as an image`);
                }
            }
            await page.navigate(`${base}/index.html`);
            assert.match(await text('.topbar .brand'), /^\s*Icesights/);
            // the rider search is not in the menu; the page itself is still there for anybody who has its address
            assert.equal(await count('a[href="search_user.html"]'), 0, 'the main page still links to the rider search');
            assert.equal(await page.evaluate('fetch("search_user.html").then(r => r.status)'), 200);
        });

        await step('app: the service worker takes over, keeps the app shell, and the app opens without a connection', async () => {
            await page.navigate(`${base}/index.html`);
            await page.waitFor('navigator.serviceWorker.controller !== null', 'the service worker to take over');
            const cached = JSON.parse(await page.evaluate('caches.keys().then(async names => { const cache = await caches.open(names.find(n => n.startsWith("icesights-shell"))); return JSON.stringify({ names, count: (await cache.keys()).length }); })'));
            assert.ok(cached.names.some(name => /^icesights-shell-v\d+$/.test(name)), JSON.stringify(cached));
            assert.ok(cached.count >= 20, `only ${cached.count} files were kept`);
            await page.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
            try {
                await page.navigate(`${base}/index.html`);
                assert.equal(await page.evaluate('document.title'), 'Icesights');
                assert.equal(await count('#transponderInput'), 1, 'the app did not open offline');
                assert.equal(await page.evaluate('typeof formatTransponderInput'), 'function', 'the scripts were not available offline');
                await page.navigate(`${base}/replay.html?transponder=${data.referenceChip}&activity=${REFERENCE.id}&riders=none`);
                assert.match(await page.evaluate('document.title'), /Race replay/);
            } finally {
                await page.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
            }
        });

        await step('app: the Install button appears when the browser offers the install, and starts it when clicked', async () => {
            await page.navigate(`${base}/index.html`);
            // (a real Chrome may already have offered the install itself, as it finds the app installable; the test sends its own offer)
            const prevented = await page.evaluate(`(() => {
                const event = new Event("beforeinstallprompt", { cancelable: true });
                window.__installPrompted = 0;
                event.prompt = () => { window.__installPrompted++; return Promise.resolve(); };
                window.dispatchEvent(event);
                return event.defaultPrevented;
            })()`);
            assert.equal(prevented, true, 'the browser install banner should be replaced by the button');
            assert.equal(await visible('#installBtn'), true);
            await click('#installBtn');
            assert.equal(await page.evaluate('window.__installPrompted'), 1);
            assert.equal(await visible('#installBtn'), false, 'the button stays after the install was started');
            await page.evaluate('window.dispatchEvent(new Event("appinstalled"))');
            assert.equal(await visible('#installBtn'), false);
        });

        await step('app: a page with a transponder finishes loading, also when the avatar cannot be loaded (otherwise no service worker, no install)', async () => {
            await page.navigate(`${base}/index.html?transponder=${data.referenceChip}`);
            await page.waitFor('document.readyState === "complete"', 'the page to finish loading', 10000);
            assert.equal(await page.evaluate('document.getElementById("profile-avatar").hasAttribute("src")'), false, 'the avatar that failed to load should be removed');
        });

        await step('app: every transponder gets its own app (own id, starts on that transponder), and Chrome accepts and offers it', async () => {
            const appManifest = async () => {
                const result = await page.send('Page.getAppManifest');
                return { url: result.url || '', errors: (result.errors || []).map(e => e.message), data: result.data ? JSON.parse(result.data) : {} };
            };
            const installErrors = async () => ((await page.send('Page.getInstallabilityErrors')).installabilityErrors || []).map(e => e.errorId);

            await page.navigate(`${base}/index.html?transponder=${data.referenceChip}`);
            await page.waitFor(`Pwa.currentTransponder() === "${data.referenceChip}"`, 'the manifest of the transponder');
            let manifest = await appManifest();
            assert.deepEqual(manifest.errors, []);
            assert.match(manifest.url, /^blob:/);
            assert.equal(manifest.data.start_url, `${base}/index.html?transponder=${data.referenceChip}`);
            assert.equal(manifest.data.id, `${base}/?transponder=${data.referenceChip}`);
            assert.equal(manifest.data.name, `Icesights ${data.referenceChip}`);
            assert.equal(manifest.data.short_name, data.referenceChip);
            assert.deepEqual(await installErrors(), [], 'Chrome sees problems with the manifest of the transponder app');
            assert.equal((await text('#installBtn')).trim(), `Install ${data.referenceChip}`);
            await page.waitFor('!document.getElementById("installBtn").classList.contains("hidden")', 'Chrome to offer the install of the transponder app', 15000);

            // another transponder, typed in on the page: the manifest follows
            await page.evaluate('Pwa.useTransponder("cd-11111")');
            await page.waitFor('Pwa.currentTransponder() === "CD-11111"', 'the other transponder');
            for (let attempt = 0; attempt < 40 && !(await appManifest()).data.id?.endsWith('CD-11111'); attempt++) await page.sleep(150);
            manifest = await appManifest();
            assert.equal(manifest.data.id, `${base}/?transponder=CD-11111`);
            assert.equal(manifest.data.start_url, `${base}/index.html?transponder=CD-11111`);
            assert.equal((await text('#installBtn')).trim(), 'Install CD-11111');

            // something that is not a transponder: the general app again
            await page.evaluate('Pwa.useTransponder("nonsense")');
            await page.waitFor('Pwa.currentTransponder() === null', 'the general app');
            for (let attempt = 0; attempt < 40 && !(await appManifest()).url.endsWith('manifest.webmanifest'); attempt++) await page.sleep(150);
            manifest = await appManifest();
            assert.match(manifest.url, /manifest\.webmanifest$/);
            assert.equal(manifest.data.name, 'Icesights');
            assert.equal((await text('#installBtn')).trim(), 'Install app');
        });

        await step('app: loading a transponder on the main page makes "Install" the app of that transponder', async () => {
            await page.navigate(`${base}/index.html`);
            assert.equal(await page.evaluate('Pwa.currentTransponder()'), null);
            await page.evaluate(`(() => { const field = document.getElementById("transponderInput"); field.value = "${data.referenceChip}"; document.getElementById("fetchActivitiesBtn").click(); })()`);
            await page.waitFor(`Pwa.currentTransponder() === "${data.referenceChip}"`, 'the app of the loaded transponder', 15000);
            assert.equal((await text('#installBtn')).trim(), `Install ${data.referenceChip}`);
        });

        await step('no script errors or console errors on any page', async () => {
            assert.deepEqual(page.problems, []);
        });
    } finally {
        await page.close();
        server.close();
    }

    console.log(failures ? `\n${failures} FAILED` : `\nALL PASSED${skipped ? ` (${skipped} skipped)` : ''}`);
    process.exit(failures ? 1 : 0);
})().catch(error => {
    console.error('The browser test could not run:', error);
    process.exit(2);
});
