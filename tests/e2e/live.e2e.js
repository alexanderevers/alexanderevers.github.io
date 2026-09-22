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
    const listTitle = () => page.evaluate('[...document.querySelectorAll(".live-group th")].map(t => t.textContent).find(t => t.startsWith("Lap")) || ""');
    const namesIn = () => page.waitFor('window.__live.namesPending() === 0', 'the names of the riders');
    const window_rows = json => JSON.parse(json).map(r => r.label);
    const rowNames = selector => page.evaluate(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(selector)})].map(r => r.cells[0].textContent.trim()))`).then(JSON.parse);
    // The names of one "live-group" section by its title (e.g. "On the ice", not "Selected"): a selected rider keeps his live status class
    // (.skating, ...) even while shown under "Selected", so a plain class selector like .live-row.skating also matches him there.
    const groupRowNames = title => page.evaluate(`(() => {
        const start = [...document.querySelectorAll('.live-group')].find(h => h.textContent.trim().startsWith(${JSON.stringify(title)}));
        const names = [];
        for (let el = start && start.nextElementSibling; el && !el.classList.contains('live-group'); el = el.nextElementSibling) names.push(el.cells[0].textContent.trim());
        return JSON.stringify(names);
    })()`).then(JSON.parse);

    try {
        await page.navigate(`${base}/live.html?rink=2497&poll=2`);
        await page.waitFor('window.__live && window.__live.states().length >= 5 && window.__live.states().filter(s => s.status === "skating").length >= 2', 'the riders of the fake rink');
        await namesIn();

        await step('live: the page is called Live, shows the rink and how many are on the ice, and reports itself in the title', async () => {
            assert.match(await page.evaluate('document.title'), /^\(\d+\) Live · Thialf \(Heerenveen\) · Icesights$/);
            assert.match(await text('#liveStatus'), /^Thialf \(Heerenveen\) · \d+ on the ice.* · updated \d+ s ago$/);
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
            assert.match(await text('.live-row.private'), /Private Pete.*results are private/);
            assert.equal(await count('.live-row.private'), 1, 'a private rider must be listed once, in his own group');
            const onIce = await page.evaluate('document.querySelector(".live-group th").textContent.trim()');
            assert.match(onIce, /^On the ice \((\d+)\)$/);
            assert.equal(Number(/\((\d+)\)/.exec(onIce)[1]), await count('.live-row.skating, .live-row.waiting'), 'the number in the group title is not the number of rows');
        });

        await step('live: each rider on the ice has laps, last lap, best lap and the time since the last crossing', async () => {
            const cells = await page.evaluate('JSON.stringify([...[...document.querySelectorAll(".live-row.skating")].find(r => r.cells[0].textContent.includes("Fast Fanny")).cells].map(c => c.textContent.trim()))').then(JSON.parse);
            assert.equal(cells[0], 'Fast Fanny');
            assert.match(cells[1], /^[0-9]{2}:[0-9]{2}$/);                    // started
            assert.match(cells[2], /^[0-9]+ min$|^[0-9]+ h [0-9]{2} min$/);      // duration
            assert.ok(Number(cells[3]) >= 8, `laps: ${cells[3]}`);          // 60 s at a lap every 6 s
            assert.equal(cells[4], '6.000');
            assert.equal(cells[5], '6.000');
            assert.match(cells[6], /^\d+ s$/);
            assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".live-row.skating td.laps")).fontWeight'), '700');
        });

        await step('live: new laps arrive by themselves, and the page only asks for live data (live=1)', async () => {
            const before = (await states()).find(s => s.id === 9001).lapCount;
            await page.waitFor(`window.__live.states().find(s => s.id === 9001).lapCount > ${before}`, 'a new lap of the fast rider', 15000);
            const requests = JSON.parse(await page.evaluate('JSON.stringify(window.__liveRequests)'));
            assert.ok(requests.length > 4);
            const live = requests.filter(url => !/[/]account[/]/.test(url));       // (the names of the riders come from their accounts: not live data)
            assert.ok(live.every(url => /[?&]live=1(&|$)/.test(url)), 'a request without live=1: ' + live.find(url => !/live=1/.test(url)));
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

        await step('live: nobody has a colour until his name is pressed; up to ten colours, then the first pressed loses his', async () => {
            const slots = () => page.evaluate('JSON.stringify(window.__live.colours())').then(JSON.parse);
            assert.deepEqual(await slots(), {});                                    // all small blue dots at first
            assert.equal(await count('.live-row .live-dot'), 0);
            const press = name => page.evaluate('[...document.querySelectorAll(".live-row")].find(r => r.cells[0].textContent.includes(' + JSON.stringify(name) + ')).click()');
            await press('Fast Fanny');
            await page.waitFor('Object.keys(window.__live.colours()).length === 1 && document.querySelectorAll(".live-row .live-dot").length === 1', 'the first colour');
            assert.equal((await slots())[9001], 0);
            // the rider pressed last stays on top of the list, in a group of his own
            const firstRow = () => page.evaluate('document.querySelector(".live-row").cells[0].textContent.trim()');
            await page.waitFor('document.querySelector(".live-row").cells[0].textContent.trim() === "Fast Fanny"', 'the first row is Fast Fanny');
            assert.match(await text('.live-group th'), /^Selected/);
            await press('Sam Steady');                                              // (compared: also gets a colour, and is on top now)
            await page.waitFor('Object.keys(window.__live.colours()).length === 2', 'the second colour');
            assert.deepEqual(await slots(), { 9001: 0, 9002: 1 });
            await page.waitFor('document.querySelector(".live-row").cells[0].textContent.trim() === "Sam Steady"', 'the first row is Sam Steady');
            // both coloured riders show under "Selected" together (up to MAX_SELECTED_SHOWN, five)
            assert.match(await text('.live-group th'), /^Selected \(2\)/);
            assert.equal(await count('.live-row.skating, .live-row.waiting'), (await states()).filter(s => s.status === 'skating' || s.status === 'waiting').filter(s => !s.isPrivate).length);      // nobody twice
            // newer crossings and faster laps stay under him: sorting by the latest crossing does not move him
            await page.evaluate('(() => { const s = document.getElementById("sortSelect"); s.value = "best"; s.dispatchEvent(new Event("change")); })()');
            await page.sleep(500);
            await page.waitFor('document.querySelector(".live-row").cells[0].textContent.trim() === "Sam Steady"', 'the first row is Sam Steady');                            // (Fast Fanny has the fastest laps)
            // letting go of the selected rider takes his colour; Sam Steady (still coloured) keeps showing under "Selected". The DOM re-renders
            // on the next animation frame, a tick after the state itself changes: wait for both, or the group header below can still be stale.
            await press('Fast Fanny');
            await page.waitFor('!(9001 in window.__live.colours()) && /^Selected \\(1\\)/.test((document.querySelector(".live-group th") || {}).textContent || "")', 'let go');
            assert.deepEqual(await slots(), { 9002: 1 });
            assert.equal((await groupRowNames('On the ice'))[0], 'Fast Fanny');    // sorted by the fastest lap again
            // a compared rider who is pressed again becomes the selection and keeps his colour
            await press('Fast Fanny');                                              // selected (colour 1)
            await press('Sam Steady');                                              // compared
            await page.waitFor('window.__live.compared() === 9002', 'Sam is compared');
            await press('Sam Steady');                                              // ... and now the only selection
            await page.waitFor('window.__live.selected() === 9002 && window.__live.compared() === null', 'Sam is the selection');
            assert.deepEqual(await slots(), { 9001: 0, 9002: 1 });                   // (both keep their colour: no small blue dot)
            await page.waitFor('document.querySelectorAll(".live-row .live-dot").length === 2 && document.querySelector(".live-row").cells[0].textContent.includes("Sam Steady")', 'both coloured, the last pressed on top');
            await page.evaluate('window.__live.colourTest()');                     // presses eleven names: the first loses its colour
            const eleven = await slots();
            assert.equal(Object.keys(eleven).length, 10);
            assert.ok(!(1 in eleven), 'the first pressed still has a colour');
            assert.ok(10 in eleven && Object.values(eleven).length === new Set(Object.values(eleven)).size, 'colours are not distinct');
            assert.equal(Object.values(eleven).sort().join(','), '0,1,2,3,4,5,6,7,8,9');
            // reset for the next steps: pressing the coloured ones again takes their colours (and selections) away
            await page.navigate(base + '/live.html?rink=2497&poll=2');
            await page.waitFor('window.__live && window.__live.states().length >= 5 && window.__live.states().filter(s => s.status === "skating").length >= 2', 'the riders again');
            await namesIn();
        });

        await step('live: the track shows the riders as moving dots; clicking a row selects the rider', async () => {
            const canvasImage = () => page.evaluate('document.getElementById("liveTrack").toDataURL()');
            const first = await canvasImage();
            await page.sleep(1200);
            assert.notEqual(await canvasImage(), first, 'the dots did not move');
            const dots = await page.evaluate(`(() => { const c = document.getElementById("liveTrack"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255 && (Math.abs(d[i] - d[i + 1]) > 60 || Math.abs(d[i + 1] - d[i + 2]) > 60)) n++; return n; })()`);
            assert.ok(dots > 20, `only ${dots} coloured pixels on the track`);
            await page.evaluate('[...document.querySelectorAll(".live-row.skating")].find(r => r.cells[0].textContent.includes("Sam Steady")).click()');
            await page.sleep(400);
            assert.equal(await count('.live-row.selected'), 1);
            assert.match(await text('.live-row.selected'), /Sam Steady/);
            await page.evaluate('document.querySelector(".live-row.selected").click()');
            await page.sleep(400);
            assert.equal(await count('.live-row.selected'), 0);
        });

        await step('live: the main page has a Live button in the menu that opens this page', async () => {
            const html = await page.evaluate('fetch("index.html").then(r => r.text())');
            assert.match(html, /<a class="topbar-link" href="live[.]html"[^>]*>Live<[/]a>/);
            assert.equal(await page.evaluate('fetch("live.html").then(r => r.status)'), 200);
        });

        await step('live: the lap graph: a message first, then the lap times of the selected rider, with a slider for the maximum', async () => {
            assert.match(await text('#liveLapEmpty'), /Select a rider/);
            assert.ok(!/estimate/i.test(await text('body')), 'the estimate note is still there');
            const pick = name => page.evaluate('[...document.querySelectorAll(".live-row")].find(r => r.cells[0].textContent.includes(' + JSON.stringify(name) + ')).click()');
            await pick('Sam Steady');
            await page.waitFor('window.__live.lapGraph().drawn > 0', 'graph drawn');
            // TRANSPONDERNAME, name surname: the real name of the account is looked up when the rider is selected
            await page.waitFor('document.getElementById("liveLapTitle").textContent === "Lap times · Sam Steady, ST-10002"', 'the name and the transponder number in the title');
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
            // a second rider is compared: his laps appear (paler) in the same graph, the selection stays
            await pick('Fast Fanny');
            await page.waitFor('window.__live.compared() === 9001 && window.__live.lapGraph().auto === true && window.__live.lapGraph().inView >= 3', 'the compared rider');
            assert.equal(await page.evaluate('window.__live.selected()'), 9002);
            assert.equal(await text('#liveLapTitle'), 'Lap times · Sam Steady, ST-10002 and Fast Fanny');
            assert.equal(await count('.live-row.selected'), 1);
            assert.equal(await count('.live-row.compared'), 1);
            assert.match(await text('.live-row.compared'), /Fast Fanny/);
            assert.match(await text('#liveLapReadout'), /average 9$/);           // the numbers are those of the selected rider
            const both = await page.evaluate('window.__live.lapGraph().drawn');
            await page.evaluate('(() => { const c = document.getElementById("liveLapCanvas"); const r = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent("mousemove", { clientX: r.left + window.__live.lapGraph().newest.x, clientY: r.top + window.__live.lapGraph().newest.y, bubbles: true })); })()');
            assert.match(await text('#liveLapTooltip'), /Lap [0-9]+/);
            // clicking the compared rider again makes him the only selection
            await pick('Fast Fanny');
            await page.waitFor('window.__live.selected() === 9001 && window.__live.compared() === null && document.getElementById("liveLapTitle").textContent === "Lap times · Fast Fanny, FA-10001"', 'the only selection');
            assert.equal(await text('#liveLapTitle'), 'Lap times · Fast Fanny, FA-10001');
            assert.equal(await count('.live-row.compared'), 0);
            assert.ok(await page.evaluate('window.__live.lapGraph().drawn') < both, 'the paler laps should be gone');
            // clicking the selected rider lets go of the selection
            await pick('Fast Fanny');
            await page.waitFor('window.__live.selected() === null', 'no selection');
            // a private rider has no lap times
            await pick('Private Pete');
            await page.waitFor('/keeps the results private/.test(document.getElementById("liveLapEmpty").textContent)', 'private message');
            assert.match(await text('#liveLapEmpty'), /keeps the results private/);
            await pick('Private Pete');       // let go
            await page.waitFor('/Select a rider/.test(document.getElementById("liveLapEmpty").textContent)', 'placeholder');
        });

        await step('live: marathon mode: a list per lap with place, gap and distance to the first rider, from the real times; start and finish sliders; the number of laps caps the race', async () => {
            const set = (id, value, event) => page.evaluate('(() => { const e = document.getElementById(' + JSON.stringify(id) + '); ' + (typeof value === 'boolean' ? 'e.checked = ' + value : 'e.value = ' + JSON.stringify(value)) + '; e.dispatchEvent(new Event(' + JSON.stringify(event) + ')); })()');
            const hidden = id => page.evaluate('document.getElementById(' + JSON.stringify(id) + ').classList.contains("hidden")');
            await page.navigate(base + '/marathon.html?rink=2040&poll=1');
            await page.waitFor('window.__live && !!window.__live.marathon() && window.__live.marathon().rows.length >= 4', 'the marathon list', 30000);
            await namesIn();
            assert.equal(await hidden('marathonLapsLabel'), false);
            assert.equal(await hidden('marathonLapLabel'), false);
            assert.equal(await hidden('sortLabel'), true);
            assert.match(await listTitle(), /^Lap [0-9]+ · first rider: Ann/);
            // the newest lap: Ann first, then the others in the order of crossing, with the gap in seconds and the distance in metres
            const newest = JSON.parse(await page.evaluate('JSON.stringify(window.__live.marathon())'));
            assert.equal(newest.latest, true);
            const group = rows => rows.filter(r => r.label !== 'Fay');           // Fay (12 s laps) is a lapped rider who crosses somewhere in between
            assert.deepEqual(group(newest.rows).slice(0, 4).map(r => r.label), ['Ann', 'Bob Bouwer', 'Cas', 'Dirk']);
            assert.deepEqual(group(newest.rows).slice(0, 4).map(r => r.gapMs), [0, 300, 800, 1500]);
            const cells = JSON.parse(await page.evaluate('JSON.stringify([...document.querySelectorAll(".marathon-row")].filter(r => !r.cells[1].textContent.includes("Fay")).slice(0, 4).map(r => [...r.cells].map(c => c.textContent.trim())))'));
            assert.equal(cells[0][4], 'first');
            assert.equal(cells[3][4], '+1.50 s');
            assert.equal(cells[3][5], '60 m');                  // 1.5 s at 10 s per lap of 400 m
            assert.equal(cells[3][6], '10.000');
            assert.match(cells[0][7], /^[0-9]+:[0-9.]+$/);      // the time of the laps from the start
            assert.equal(Number(cells[0][2]), newest.lapNr);   // the number of laps
            // the sliders show real times, and the start and the finish are flags in the lap graph
            assert.match(await text('#marathonFinishValue'), /follows\) · [0-9]{2}:[0-9]{2}:[0-9]{2}$/);
            assert.match(await text('#marathonStartValue'), /^[0-9]{2}:[0-9]{2}:[0-9]{2} [(]auto[)]$/);         // the program chose the start time
            assert.match(await page.evaluate('document.getElementById("marathonStartTime").value'), /^[0-9]{2}:[0-9]{2}:[0-9]{2}$/);
            await page.evaluate('[...document.querySelectorAll(".marathon-row")].find(r => r.cells[1].textContent.includes("Bob")).click()');
            await page.waitFor('window.__live.selected() === 9102 && window.__live.lapGraph().marks === true', 'the flags in the lap graph');
            // the title of the lap times: TRANSPONDERNAME, name surname, position in the list
            await page.waitFor('/^Lap times · Bob Bouwer, MB-10102 · position [0-9]+$/.test(document.getElementById("liveLapTitle").textContent)', 'name and position in the title');
            // the place of the rider in the list of every lap is drawn in the graph (a second line, on an axis of its own)
            await page.waitFor('window.__live.lapGraph().places >= 3', 'the places in the graph');
            // the last lap is there too: Dirk crosses 1.5 s after the first rider, after the flag of the finish, and still has his place in the graph
            await page.evaluate('[...document.querySelectorAll(".marathon-row")].find(r => r.cells[1].textContent.includes("Dirk")).click()');
            await page.waitFor('window.__live.selected() === 9104 || window.__live.compared() === 9104', 'Dirk pressed');
            await page.evaluate('window.__live.selected() === 9104 || [...document.querySelectorAll(".marathon-row")].find(r => r.cells[1].textContent.includes("Dirk")).click()');
            await page.waitFor('window.__live.selected() === 9104', 'Dirk selected');
            await page.waitFor('window.__live.lapGraph().places >= 3', 'the places of Dirk');
            await page.waitFor("(() => { const p = window.__live.marathon().placesOf(9104); return p.length > 0 && window.__live.lapGraph().lastPlaceEndMs === p[p.length - 1].endMs; })()", 'the last lap of Dirk in the place graph');
            await page.evaluate('[...document.querySelectorAll(".marathon-row")].find(r => r.cells[1].textContent.includes("Bob")).click()');
            await page.evaluate('window.__live.selected() === 9102 || [...document.querySelectorAll(".marathon-row")].find(r => r.cells[1].textContent.includes("Bob")).click()');
            await page.waitFor('window.__live.selected() === 9102', 'Bob selected again');
            const bobPlaces = JSON.parse(await page.evaluate('JSON.stringify(window.__live.marathon().placesOf(9102))'));
            assert.ok(bobPlaces.length >= 3 && bobPlaces.every(p => p.place >= 1 && p.place <= p.riders), JSON.stringify(bobPlaces));
            assert.equal(bobPlaces[bobPlaces.length - 1].place, window_rows(await page.evaluate('JSON.stringify(window.__live.marathon().rows)')).indexOf('Bob Bouwer') + 1);      // (the newest lap: his place in the list)
            // the selected rider is on top of the list as well, with his place, and is still in the list below
            await page.waitFor('document.querySelectorAll(".live-row[data-id=\\"9102\\"]").length === 2', 'Bob twice');
            const pinned = JSON.parse(await page.evaluate('JSON.stringify([...document.querySelector(".live-row").cells].map(c => c.textContent.trim()))'));
            assert.equal(pinned[1], 'Bob Bouwer');
            assert.equal(await page.evaluate('document.querySelector(".live-row").classList.contains("pinned")'), true);
            const place = window_rows(await page.evaluate('JSON.stringify(window.__live.marathon().rows)')).indexOf('Bob Bouwer') + 1;
            assert.equal(Number(pinned[0]), place);                                   // his position in the list
            assert.match(await text('.live-group th'), /^Selected/);
            assert.equal(await count('.live-row.selected'), 1);                        // (the copy in the list is the selected row)
            // a start time (absolute): from 20 seconds before it all riders are selected, their first lap is lap 1, everything is measured from it
            const before0 = JSON.parse(await page.evaluate('JSON.stringify(window.__live.marathon())'));
            const chosen = Math.round((before0.firstMs + 45000) / 1000);          // 45 s after the first crossing: the fourth lap of the group starts near
            await set('marathonStart', String(chosen), 'input');
            await page.waitFor('window.__live.marathon().startMs === ' + chosen * 1000, 'the race starts at the chosen time');
            assert.ok(await page.evaluate('window.__live.marathon().leaderCount') <= before0.leaderCount - 2, 'the laps before the start time still count');
            assert.match(await text('#marathonStartValue'), /^[0-9]{2}:[0-9]{2}:[0-9]{2}$/);         // (no longer "auto")
            assert.equal(await page.evaluate('document.getElementById("marathonStartTime").value'), await text('#marathonStartValue'));
            // a lap of the race, counted from that start
            await set('marathonFinish', '3', 'input');
            await page.waitFor('window.__live.marathon().lapNr === 3', 'lap 3 of the race');
            const part = JSON.parse(await page.evaluate('JSON.stringify(window.__live.marathon())'));
            assert.equal(part.latest, false);
            assert.deepEqual(part.rows.filter(r => r.label !== 'Fay').slice(0, 4).map(r => r.label), ['Ann', 'Bob Bouwer', 'Cas', 'Dirk']);
            assert.ok(Math.abs(part.rows[0].segmentMs - (part.finishMs - chosen * 1000)) < 1);   // measured from the start time
            assert.ok(part.rows[0].segmentMs > 0 && part.rows[0].segmentMs < 60000, String(part.rows[0].segmentMs));
            assert.equal(part.finishMs - part.startMs, part.rows[0].segmentMs);              // the same real start for everybody
            assert.match(await listTitle(), /^Lap 3 · first rider: Ann/);
            // while the start slider is held the graph shows the whole activity (to see where the start line goes); when let go it zooms in
            assert.equal(await page.evaluate('window.__live.lapGraph().zoomed'), true);
            await page.evaluate('document.getElementById("marathonStart").dispatchEvent(new Event("pointerdown"))');
            await page.waitFor('window.__live.lapGraph().zoomed === false && window.__live.lapGraph().marks === true', 'the whole activity while sliding');
            await page.evaluate('document.getElementById("marathonStart").dispatchEvent(new Event("pointerup"))');
            await page.waitFor('window.__live.lapGraph().zoomed === true', 'zoomed in again');
            // on the last position the finish slider follows the race: the list moves on to every new lap
            await page.evaluate('(() => { const e = document.getElementById("marathonFinish"); e.value = e.max; e.dispatchEvent(new Event("input")); })()');
            await page.waitFor('window.__live.marathon().latest === true', 'the last position');
            const lapNow = await page.evaluate('window.__live.marathon().lapNr');
            await page.waitFor('window.__live.marathon().lapNr > ' + lapNow, 'the list moved on to a new lap', 25000);
            // the riders are dots on the track, moving as usual, in the colour of their row
            const dots = await page.evaluate('(() => { const c = document.getElementById("liveTrack"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255 && (Math.abs(d[i] - d[i + 1]) > 60 || Math.abs(d[i + 1] - d[i + 2]) > 60)) n++; return n; })()');
            assert.ok(dots > 100, 'only ' + dots + ' coloured pixels on the track');
            assert.ok(await count('.marathon-row .live-dot') >= 4, 'the rows have no coloured dots');    // Bob and Dirk, pressed earlier, each twice
            // the number of laps of the race: what comes after it does not count
            await set('marathonLaps', '6', 'change');
            await page.waitFor('window.__live.marathon().leaderCount === 6 && window.__live.marathon().finished === true', 'a race of 6 laps');
            assert.match(await listTitle(), /^Lap 6 of 6 · first rider: Ann.* · finished/);
            await set('marathonLaps', '', 'change');
        });

        await step('live: replay of a marathon by activity number: the rink as it was, with play, speed, and a slider for the time; no requests for live data', async () => {
            const set = (id, value, event) => page.evaluate('(() => { const e = document.getElementById(' + JSON.stringify(id) + '); e.value = ' + JSON.stringify(value) + '; e.dispatchEvent(new Event(' + JSON.stringify(event) + ')); })()');
            const hidden = id => page.evaluate('document.getElementById(' + JSON.stringify(id) + ').classList.contains("hidden")');
            await page.navigate(base + '/marathon.html?rink=2040&poll=1&activity=9101');
            await page.waitFor('window.__live && !!window.__live.replay() && window.__live.replay().loading === false && !!window.__live.marathon()', 'the replay', 30000);
            await namesIn();
            assert.equal(await hidden('replayBar'), false);
            assert.equal(await page.evaluate('[...document.querySelectorAll("#replaySpeed option")].map(o => o.value).join(",")'), '1,2,5,10,20,30');
            assert.equal(await hidden('replayLabel'), true);
            assert.match(await text('#liveStatus'), /^Replay · Fake rink|^Replay · /);
            assert.ok(window_rows(await page.evaluate('JSON.stringify(window.__live.marathon().rows)')).length >= 1);
            assert.equal(await page.evaluate('window.__live.replay().at === window.__live.replay().endMs'), true);          // it opens on the final result
            // no live requests while a marathon of the past is shown
            const before = await page.evaluate('window.__liveRequests.length');
            await page.sleep(2500);
            assert.equal(await page.evaluate('window.__liveRequests.length'), before, 'the page went on asking for live data');
            // a chosen start time: the replay starts at that time, not when the first rider started his activity
            const wholeFrom = await page.evaluate('window.__live.replay().fromMs');
            const chosenStart = Math.round((wholeFrom + 45000) / 1000);
            await set('marathonStart', String(chosenStart), 'input');
            await page.waitFor('window.__live.replay().at === window.__live.replay().fromMs && window.__live.replay().fromMs === ' + chosenStart * 1000, 'the clock went to the start time');
            assert.equal(await page.evaluate('document.getElementById("marathonStart").value'), String(chosenStart));           // not pulled back by the moment of the clock
            assert.equal(await page.evaluate('document.getElementById("replayTime").value'), '0');
            // the dots are shown from the first real crossing since the start (from 20 s before the start time): nothing before it is looked at
            await page.waitFor('window.__live.states().filter(s => s.status === "skating").length >= 3 && window.__live.states().filter(s => s.status === "skating").every(s => s.lapCount <= 3)', 'riders shown from their first crossing since the start');
            const atStart = JSON.parse(await page.evaluate('JSON.stringify({ from: window.__live.replay().fromMs, riders: window.__live.states().filter(s => s.status === "skating").map(s => [s.label, s.lapCount, s.lastLap.endMs]) })'));
            atStart.riders.forEach(([label, laps, lastEnd]) => {
                assert.ok(laps <= 3, label + ' has ' + laps + ' laps before the first crossings of the race');
                assert.ok(lastEnd >= atStart.from - 20000, label + ' is shown from a crossing before the start');
            });
            // the start time can also be typed as a time of day
            const typed = await page.evaluate('document.getElementById("marathonStartTime").value');
            assert.match(typed, /^[0-9]{2}:[0-9]{2}:[0-9]{2}$/);
            await set('marathonStartTime', typed, 'change');
            await page.waitFor('window.__live.replay().fromMs === ' + chosenStart * 1000, 'the typed time is the same start');
            assert.ok(await page.evaluate('window.__live.replay().fromMs - window.__live.replay().startMs >= 60000'));
            await page.waitFor('!!window.__live.marathon()', 'the list at the start');
            // moving the slider: the rink as it was, from the start
            await set('replayTime', '28', 'input');
            await page.waitFor('window.__live.replay().at === window.__live.replay().fromMs + 28000', 'the slider moved the clock');
            await page.waitFor('window.__live.marathon().rows.length >= 4', 'the riders of that moment');
            assert.deepEqual(window_rows(await page.evaluate('JSON.stringify(window.__live.marathon().rows)')).filter(name => name !== 'Fay').slice(0, 4), ['Ann', 'Bob Bouwer', 'Cas', 'Dirk']);
            assert.ok(await page.evaluate('window.__live.states().length >= 4'));
            // the whole activity is known in a replay: the place on the track comes from the real lap, not from a prediction
            await page.waitFor('window.__live.states().some(s => typeof s.exactFrac === "number")', 'riders placed from their real lap times');
            assert.ok(await page.evaluate('window.__live.states().filter(s => typeof s.exactFrac === "number").every(s => s.exactFrac >= 0 && s.exactFrac < 1)'));
            assert.ok(await page.evaluate('window.__live.states().filter(s => s.status === "skating").every(s => s.exactFrac === undefined || s.sinceMs !== null)'));
            // play from there: the clock runs (at speed 10)
            await set('replaySpeed', '30', 'change');
            await page.evaluate('document.getElementById("replayPlay").click()');
            const t1 = await page.evaluate('window.__live.replay().at');
            await page.waitFor('window.__live.replay().at > ' + (t1 + 5000), 'the clock of the replay runs', 15000);
            assert.match(await text('#replayPlay'), /Pause/);
            await page.evaluate('document.getElementById("replayPlay").click()');
            // at the end, Play starts again from the chosen start
            await page.evaluate('(() => { const e = document.getElementById("replayTime"); e.value = e.max; e.dispatchEvent(new Event("input")); })()');
            await page.evaluate('document.getElementById("replayPlay").click()');
            assert.ok(await page.evaluate('window.__live.replay().at - window.__live.replay().fromMs < 30000'), 'play did not start again from the chosen start');
            await page.evaluate('document.getElementById("replayPlay").click()');
        });

        await step('live: export the marathon replay as a video (canvas.captureStream + MediaRecorder), from the chosen start, with a manual or an automatic stop', async () => {
            const set = (id, value, event) => page.evaluate('(() => { const e = document.getElementById(' + JSON.stringify(id) + '); e.value = ' + JSON.stringify(value) + '; e.dispatchEvent(new Event(' + JSON.stringify(event) + ')); })()');
            assert.equal(await page.evaluate('typeof document.getElementById("liveTrack").captureStream === "function" && typeof MediaRecorder === "function"'), true);
            assert.equal(await page.evaluate('window.__live.recording()'), false);
            await page.evaluate('document.getElementById("replayExport").click()');
            await page.waitFor('window.__live.recording() === true', 'the recording to start');
            assert.match(await text('#replayExport'), /Recording/);
            assert.equal(await page.evaluate('window.__live.replay().playing'), true);            // exporting plays the replay
            assert.ok(await page.evaluate('window.__live.replay().at - window.__live.replay().fromMs < 2000'), 'the recording did not start from the chosen start');
            await page.sleep(1200);
            await page.evaluate('document.getElementById("replayExport").click()');                // stop early
            await page.waitFor('window.__live.recording() === false', 'the recording to stop');
            assert.match(await text('#replayExport'), /^Export video$/);
            assert.ok((await page.evaluate('window.__live.lastExportSize()')) > 0, 'no video was recorded');
            assert.equal(await page.evaluate('window.__live.lastExportType()'), 'video/webm');

            // it also stops on its own, with a video, once the replay reaches the end
            await set('replaySpeed', '30', 'change');
            await page.evaluate('document.getElementById("replayExport").click()');
            await page.waitFor('window.__live.recording() === true', 'recording again');
            await page.waitFor('window.__live.recording() === false', 'the recording to stop by itself once the replay ends', 20000);
            assert.equal(await page.evaluate('window.__live.replay().playing'), false);
            assert.equal(await page.evaluate('window.__live.replay().at === window.__live.replay().endMs'), true);
            assert.ok((await page.evaluate('window.__live.lastExportSize()')) > 0);
            assert.match(await text('#replayExport'), /^Export video$/);
        });

        await step('live: back to live after a replay', async () => {
            const hidden = id => page.evaluate('document.getElementById(' + JSON.stringify(id) + ').classList.contains("hidden")');
            // recording (and the rest of the replay) never asked for live data; going back to live does
            const before = await page.evaluate('window.__liveRequests.length');
            await page.evaluate('document.getElementById("replayLive").click()');
            await page.waitFor('window.__live.replay() === null && window.__live.states().length >= 4 && window.__liveRequests.length > ' + before, 'live again');
            assert.equal(await hidden('replayBar'), true);
            // the page for the next steps: the fake Thialf again
            await page.navigate(base + '/live.html?rink=2497&poll=2');
            await page.waitFor('window.__live && window.__live.states().length >= 5', 'the riders of Thialf');
            await namesIn();
        });

        await step('marathon.html: the same page in marathon mode: the marathon list at once, its own title, and live.html has no marathon controls at all', async () => {
            await page.navigate(base + '/marathon.html?rink=2040&poll=1');
            await page.waitFor('window.__live && !!window.__live.marathon() && window.__live.marathon().rows.length >= 4', 'the marathon list', 30000);
            await namesIn();
            assert.match(await page.evaluate("document.title"), /Marathon · Jaap Eden IJsbaan.* · Icesights$/);
            assert.equal(await text('.dash-head h2'), 'Marathon');
            assert.equal(await text('a.topbar-link[href="live.html"]'), 'Live');                              // the other page is in the menu
            assert.equal(await count('a.topbar-link[href="marathon.html"]'), 0);
            assert.equal(await page.evaluate('!!document.getElementById("marathonToggle")'), false);                 // (no switch: this is the marathon page)
            assert.equal(await page.evaluate('document.getElementById("marathonLapLabel").classList.contains("hidden")'), false);
            assert.equal(await page.evaluate('document.getElementById("replayLabel").classList.contains("hidden")'), false);
            assert.ok(await count('.marathon-row') >= 4);
            assert.equal(await page.evaluate('fetch("index.html").then(r => r.text()).then(t => /href="marathon[.]html"/.test(t))'), true);   // in the menu
            await page.navigate(base + '/live.html?rink=2497&poll=2');
            await page.waitFor('window.__live && window.__live.states().length >= 5', 'the riders of Thialf');
            await namesIn();
            assert.equal(await count('.marathon-row'), 0);
            assert.equal(await text('a.topbar-link[href="marathon.html"]'), 'Marathon');                       // the other page is in the menu
            assert.equal(await count('a.topbar-link[href="live.html"]'), 0);
            assert.equal(await page.evaluate('!!document.getElementById("marathonStart") || !!document.getElementById("replayBar") || !!document.getElementById("marathonLaps")'), false);      // no marathon controls on live.html
            assert.equal(await page.evaluate('document.getElementById("sortLabel").classList.contains("hidden")'), false);
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
            await namesIn();
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
