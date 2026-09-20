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

        if (!chartAvailable) {
            skip('main page: lap table, statistics and GPX download', 'Chart.js could not be loaded from the CDN (offline?)');
        } else {
            await click('#fetchLapsBtn');
            await page.waitFor('!document.getElementById("lapsData").classList.contains("hidden")', 'the laps section');

            await step('main page: session summary cards and the laps table', async () => {
                assert.equal(await count('#sessionSummary .stat-card'), 9);
                assert.equal(await count('#lapsTableContainer tbody tr'), referenceLaps.length);
                assert.equal(await count('#lapsTableContainer thead th'), 5);           // no voltage / temperature columns
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
            await step('main page: max fast lap slider changes the analysis', async () => {
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
        await step('overlapping riders: sorted by whole minutes skated together, most first; each card shows both values', async () => {
            const cards = JSON.parse(await page.evaluate(`JSON.stringify([...document.querySelectorAll("#overlappingSessionsTable .session-card")].map(card => ({
                id: Number(card.querySelector(".replay-select").dataset.activityId),
                together: card.querySelectorAll(".session-stat.together .value")[0].textContent,
                group: card.querySelectorAll(".session-stat.together .value")[1].textContent,
                dimmed: card.classList.contains("no-overlap")
            })))`));
            const minutes = value => (value === '0 min' ? 0 : value === '<1 min' ? 0.5 : Number(/(\d+) min/.exec(value)[1]) + (/(\d+) h/.test(value) ? 60 * Number(/(\d+) h/.exec(value)[1]) : 0));
            for (let i = 1; i < cards.length; i++) assert.ok(minutes(cards[i].together) <= minutes(cards[i - 1].together), `card ${i} is out of order`);
            assert.ok(cards.every(c => /^~/.test(c.group) || c.group === 'N/A'), 'the group value should be marked as an estimate (~)');
            const allDay = cards.find(c => c.id === ALL_DAY_ID);
            assert.equal(allDay.together, '0 min');
            assert.equal(allDay.dimmed, true);
            assert.equal(cards[cards.length - 1].id, ALL_DAY_ID, 'the rider who skated with nobody should be last');
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
        await step('open replay: address and stored data', async () => {
            await click('#openReplayBtn');
            assert.equal(await page.evaluate('window.__opened'), `replay.html?activity=${REFERENCE.id}`);
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
            assert.equal(states.length, OVERLAPPING.length + 1);
            assert.deepEqual(summary(states), { shown: SKATED_WITH_YOU.length + 1, label: 10, small: SKATED_WITH_YOU.length + 1 - 10 });
            assert.equal(states[0].kind, 'label', 'you are always coloured');
            assert.equal(await text('#riderCount'), `(${SKATED_WITH_YOU.length + 1} shown, first 10 labelled)`);
            const allDay = states.find(s => s.name.includes('Allday'));
            assert.equal(allDay.checked, false, 'the all-day rider must not be shown');
            assert.match(await page.evaluate('[...document.querySelectorAll(".rider-row")].find(r => r.textContent.includes("Allday")).querySelector("small").textContent'), /together 0 min/);
        });
        await step('replay: the clock starts when you entered the ice, although other riders loaded first', async () => {
            assert.equal((await text('#clockLabel')).trim(), new Date(data.T0).toLocaleTimeString('en-GB'));
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
            assert.equal(states.find(s => s.name.includes('Allday')).checked, false);
        });
        await step('replay: a rider can be added and removed with the checkbox', async () => {
            const index = (await rowStates()).find(s => s.name.includes('Allday')).i;
            await page.evaluate(`document.querySelectorAll(".rider-row")[${index}].querySelector("input").click()`);
            await page.waitFor(allLapsLoaded, 'the added rider to load');
            assert.equal(summary(await rowStates()).shown, SKATED_WITH_YOU.length + 2);
            await page.evaluate(`document.querySelectorAll(".rider-row")[${index}].querySelector("input").click()`);
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
        await step('main page: remembers the max fast lap time', async () => {
            const mainPage = `${base}/index.html?transponder=${data.referenceChip}`;
            await page.navigate(mainPage);
            await page.waitFor('document.getElementById("activitySelect").options.length > 1', 'the activity list to load');
            await setRange('#maxFastLapSlider', 45);
            await page.navigate(mainPage);
            await page.waitFor('document.getElementById("activitySelect").options.length > 1', 'the activity list to load again');
            assert.equal(Number(await page.evaluate('document.getElementById("maxFastLapSlider").value')), 45);
            assert.equal(await page.evaluate('document.getElementById("maxFastLapInput").value'), '45.000');
        });

        await step('replay without stored data explains how to open a replay', async () => {
            await page.evaluate('localStorage.removeItem("replayData")');
            await page.navigate(`${base}/replay.html?activity=${REFERENCE.id}`);
            assert.equal(await visible('#replayEmpty'), true);
            assert.equal(await visible('#replayApp'), false);
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
