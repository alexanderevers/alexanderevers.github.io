# Tests: how to run them and how to verify the output

This document is written so that a person **or another AI** can run every automated check of the MYLAPS
Activity Viewer, understand what each one proves, and decide whether a result can be trusted. Nothing here
needs the real MYLAPS API, a Cloudflare account or a personal transponder.

- [1. Quick start](#1-quick-start) - three commands and what "green" looks like
- [2. Requirements](#2-requirements)
- [3. What is in the repository](#3-what-is-in-the-repository)
- [4. The three suites](#4-the-three-suites) - unit, Worker, browser (end-to-end)
- [5. How to verify the output](#5-how-to-verify-the-output) - exit codes, expected numbers, failure vs environment problem
- [6. The fake data](#6-the-fake-data) - the cast, and every number the tests derive from it
- [7. How the unit tests reach the browser scripts](#7-how-the-unit-tests-reach-the-browser-scripts)
- [8. Prove the tests can fail (mutation checks)](#8-prove-the-tests-can-fail-mutation-checks)
- [9. Optional: checks against the live proxy](#9-optional-checks-against-the-live-proxy)
- [10. Rules the tests protect (domain knowledge)](#10-rules-the-tests-protect-domain-knowledge)
- [11. Changing things: adding a rink, a test, a fixture](#11-changing-things)
- [12. Troubleshooting](#12-troubleshooting)
- [13. What is not covered](#13-what-is-not-covered)

---

## 1. Quick start

Run from the repository root (the folder that contains `package.json` and `index.html`):

```bash
npm test               # unit tests            -> expect 234 tests, 52 suites, 0 failures  (~1.5 s)
npm run test:worker    # Cloudflare Worker     -> expect the last line "ALL PASS"           (~2 s)
npm run test:e2e       # real browser          -> expect the last line "ALL PASSED"         (~11 s)
npm run test:all       # unit + worker (does not start a browser)
```

No `npm install` is needed for `npm test`, `npm run test:worker` or `npm run test:e2e`: they use only Node's
built-in modules. (`cloudflare-worker/` has its own `package.json` with the `wrangler` tool, which is only needed
to *deploy* or run the Worker locally, never for the tests.)

**What "green" looks like**

```
npm test
  ...
  # tests 157
  # suites 42
  # pass 157
  # fail 0

npm run test:worker
  PASS  route /api/mylaps/userid/PZ-28583
  ...
  ALL PASS

npm run test:e2e
  PASS  main page: profile and activity list from the fake API
  ...
  PASS  no script errors or console errors on any page
  ALL PASSED
```

## 2. Requirements

| Need | Why | Check |
|---|---|---|
| **Node.js 22 or newer** | uses the built-in test runner with glob patterns (`node --test "tests/unit/*.test.js"`), global `fetch` and global `WebSocket` | `node --version` |
| **Chrome, Chromium or Edge** (only for `test:e2e`) | the browser test drives a real headless browser through the DevTools protocol | found automatically in the usual install locations; otherwise set `CHROME_PATH` to the executable |
| **Internet access to `cdn.jsdelivr.net`** (only for the chart part of `test:e2e`) | `index.html` loads Chart.js from a CDN | if unreachable, one `SKIP` line replaces the four chart-dependent steps (see 5.3) |

Windows, macOS and Linux are all supported. The repository was developed on Windows 11 with Edge.

**Windows PowerShell:** if `npm` fails with "running scripts is disabled on this system", type `npm.cmd` instead of `npm`
(for example `npm.cmd test`), or use Command Prompt or Git Bash. See the Windows note in
[cloudflare-worker/README.md](../cloudflare-worker/README.md#run-it-on-your-own-computer) for a permanent fix.

```bash
# only if the browser is in an unusual place
CHROME_PATH="/path/to/chrome"  npm run test:e2e             # macOS / Linux / Git Bash
$env:CHROME_PATH = "C:\path\to\msedge.exe"; npm run test:e2e   # PowerShell
```

## 3. What is in the repository

```
index.html, script.js, api.js, ...   the website (plain browser scripts, no bundler, no framework)
replay.html, replay.js, ...          the race replay page
tracks/*.gpx                         one lap of each ice rink, used for the Strava GPX download
cloudflare-worker/                   the proxy server (Cloudflare Worker) + its own tests
DOCUMENTATION.md                     architecture and behaviour of the whole application
tests/                               everything in this document
  README.md                          this file
  helpers/browser-scripts.js         loads the site's browser scripts into a Node sandbox (unit tests)
  fixtures/fake-mylaps-data.js       the fake rink, riders and laps (shared by unit and browser tests)
  fixtures/fake-location-server.js   fake "list of activities of a rink" endpoint (200 per page, sorted by end time)
  fixtures/fake-api-stub.js          fake MYLAPS proxy injected into the pages in the browser test
  unit/*.test.js                     unit tests (node:test)
  e2e/browser.js                     static server + headless browser driver (no dependencies)
  e2e/replay-flow.e2e.js             the end-to-end scenario
  e2e/live.e2e.js                    the live page (`npm run test:e2e:live`): list, laps arriving, sorting, track, lap graph, other rink, hidden tab
  fixtures/fake-live-stub.js         fake live rink (fast, steady, resting, private, old and just-started riders; a marathon group at rink 2040)
cloudflare-worker/test/handler.test.mjs   Worker tests
```

Which source file is covered by which test:

| Source file | What it does | Tested by |
|---|---|---|
| `utils.js` | number/time formatting, parsing, HTML escaping, transponder format | `unit/utils.test.js` |
| `stats.js` | speed-lap statistics (averages, consistency, fade, blocks) | `unit/stats.test.js` |
| `replay-track.js` | geometry of the oblong ice track, distances along it | `unit/replay-track.test.js` |
| `replay-model.js` | laps to positions over time, "skated together", "in your group" | `unit/replay-model.test.js` |
| `api.js` | calls to the proxy, retries, paging through a rink's activities | `unit/api.test.js` |
| `fetch_overlapping_sessions.js` (sorting only) | the order of the overlapping riders | `unit/overlap-sort.test.js` |
| `gpx-generator.js` | GPX file for Strava, which rink gets which track file | `unit/gpx-generator.test.js` |
| `cloudflare-worker/src/index.js` | the proxy: routing, validation, CORS, caching rules | `cloudflare-worker/test/handler.test.mjs` |
| `script.js`, `fetch_overlapping_sessions.js`, `replay.js`, `chart-factory.js`, `theme.js`, `style.css`, the HTML pages | user interface | `e2e/replay-flow.e2e.js` |
| `live.html`, `marathon.html`, `live.js`, `live-graph.js` | live page and marathon page | `e2e/live.e2e.js` |
| `live-model.js` | 15 min / 2 min rules, start and duration, fetch timing, graph window | `unit/live-model.test.js` |
| `search_user.*`, `strava.js` | name search page, unfinished Strava upload | not covered (see 13) |

## 4. The three suites

### 4.1 Unit tests: `npm test`

Command behind it: `node --test "tests/unit/*.test.js"`. Useful variations:

```bash
node --test --test-reporter=spec "tests/unit/*.test.js"          # readable tree with a tick per test
node --test tests/unit/replay-model.test.js                       # one file
node --test --test-name-pattern="break lap" "tests/unit/*.test.js"  # tests whose name contains this text
```

| File | Tests | What it proves |
|---|---|---|
| `utils.test.js` | time parsing round-trips, `formatDurationShort` ("<1 min", "12 min", "1 h 05 min", "N/A"), `parseTrainingTimeToSeconds`, transponder format, HTML escaping, **activities per year** (counts, filter), **remembered settings** (load/save with fallback, damaged text, storage that is blocked or missing) | display, input handling and the year filter and settings helpers are consistent |
| `stats.test.js` | 8 tests on a fixed set of 10 laps, plus `activeTimeShare` | counts, average 41.129, median 41.0, best-5 average 40.88, consistency 0.459, fade 0.433, blocks laps 2-4 and 6-9, `null` when no lap is fast enough; **active time as a share of the total time** (82% for a real session, capped at 100%, `null` when a time is missing) |
| `replay-track.test.js` | geometry | the lap has length 1 and no jumps; the finish line is at the end of the bottom straight, before the right-hand corner; 100/200/300 m land on the corner/straight joins; heading matches the direction of travel; `trackDelta` is the signed shortest distance |
| `replay-model.test.js` | positions and the two ranking numbers | interpolation inside a lap, lap boundaries, small gaps, long pauses, **break laps** (< 8 km/h) are off the ice, overlap time is symmetric and ignores breaks, **group membership**: crossing within 1 s of you, chains of riders 1 s apart, the quarter-lap window, break laps, drifting riders |
| `pwa.test.js` | the installable app | the manifest (name Icesights, standalone, start page and scope, hex colours), real PNG icons of the right sizes (192, 512, maskable 512, iOS 180), every page links manifest/icons/theme colour and loads `pwa.js`, the service worker lists only existing files and **every script, stylesheet and icon the pages load**, versioned cache names, and it never touches the proxy; **the manifest made for one transponder** (own id and name, starts on `index.html?transponder=...`, inside the site, same icons with full addresses) |
| `chart-factory.test.js` | the session chart's tooltip | one item per lap (bar kept, line dropped), the average line never listed, slower laps and different laps kept, and the chart really uses the filter and describes the hovered lap |
| `api.test.js` | retries, paging and the activity list | retries only on 5xx/network errors (max 3 tries), readable error messages for non-JSON error bodies, `?finished=1` only for activities that started on an earlier day and have ended (not for today's), **paging through a rink advances by what was received (page cap 200) and stops based on END time** | **`fetchActivities` asks for `count=500`** (the whole list, not only the newest 100), still works without a profile, readable errors for an unknown transponder |
| `overlap-sort.test.js` | order of the overlapping riders | longest time in your group first, ties (in particular 0 min) by time skated together, whole minutes before exact times, unmeasured riders last |
| `gpx-generator.test.js` | rinks and files | id and name matching to a track file, unknown rinks get none, **every `.gpx` in `/tracks` is registered and is a closed ~400 m lap with increasing timestamps**, GPX output has strictly increasing times and no duplicate finish-line point |

### 4.2 Worker tests: `npm run test:worker`

File: `cloudflare-worker/test/handler.test.mjs` (plain ES module, no dependencies). It calls the Worker's
`handleRequest()` directly with a fake `fetch` standing in for MYLAPS, and prints one `PASS`/`FAIL` line per
check, then `ALL PASS` or `<n> FAILED`. It proves:

- every endpoint (`userid`, `account`, `avatar`, `activities`, `laps`, `locations`, `chips`, `search`) calls the right MYLAPS address with the right query string, and MYLAPS receives the `Origin`, `Referer` and `Accept` headers it expects;
- **caching rules** are passed to Cloudflare (30 days for laps of a finished activity, 1 minute otherwise, 1 day for account lookups and avatars, 2-10 minutes for lists, errors never cached) and browsers get a matching `Cache-Control` (at most one day);
- ids and query parameters are validated (path tricks, bad counts, unknown parameters dropped) and the proper HTTP status comes back (400, 403, 405, 502, MYLAPS's own error status);
- CORS: the GitHub Pages site, local test servers and `Origin: null` (local files) are allowed, other websites get 403, requests without `Origin` (images, curl) work.

### 4.3 Browser test: `npm run test:e2e`

File: `tests/e2e/replay-flow.e2e.js` (helpers in `tests/e2e/browser.js`). What happens:

1. A tiny web server serves the repository folder on a random port and injects the **fake API** (`fixtures/fake-api-stub.js`) into every HTML page. The pages therefore never talk to the real proxy.
2. A headless Chrome/Edge is started in a temporary profile and controlled through the DevTools protocol. Requests to `*.workers.dev` (the avatar images) are blocked, so the test does not depend on the real proxy at all.
3. The scenario runs as 54 named steps; each prints `PASS` or `FAIL` (with the reason). When Chart.js cannot be downloaded, a `SKIP` line replaces the four chart-dependent steps (3 to 6 below), and another one the three deep link steps.

The steps, in order:

| # | Area | Asserted |
|---|---|---|
| 1 | main page | profile name/nickname and the activity list come from the fake API (all 25 of your activities are listed) |
| 2 | activity list | the list is requested with `count=500`; the **year filter** shows "All years (25)" and the years with their counts; choosing a year narrows the list; a selected activity stays selected when it is in the chosen year and is cleared (laps hidden, button disabled) when it is not |
| 3 | dashboards | before any results only the **Start** dashboard exists, there is no navigation, and the page is a vertical scroll-snap container (`y mandatory`) |
| 4 | activities | the name of an activity in the list and the Start Time box next to it both start with the day of the week (Mon-Sun, in the browser's time zone) followed by the same date and time |
| 5 | transponder field | typing `p`, `z` gives `PZ-` (the dash by itself), a typed dash is not doubled, five digits at most, digits before the letters and letters after them are dropped, pasting "transponder: pz - 28583" gives `PZ-28583`, a partial paste is cleaned up, and deleting removes the dash and then the letters (real key input through the browser) |
| 6 | dashboards | the Start dashboard (activities loaded, all three buttons shown) fits a 1280 x 720 screen without its own vertical scrollbar; the tagline reads "Get insights in your ice-skating activities." and the slider label "Lap time threshold" |
| 7-10 | main page (needs Chart.js) | 9 summary cards including **Active Time** with "% of total time" (and no lap table section any more), 7 speed-lap cards, blocks table with a total row, the max-fast-lap slider changes the analysis, **GPX download appears** and contains a valid GPX starting at the Amsterdam master track's first point |
| 11 | dashboards (needs Chart.js) | **Fetch Laps** adds the dashboards Session and Speed laps, the numbered navigation lists them (Start, Session, Speed laps), the page scrolls to Session by itself, every dashboard is exactly one screen tall, and the best lap is the **hero figure** (48 px or more) |
| 12 | dashboards (needs Chart.js) | clicking a navigation mark scrolls to that dashboard and marks it active |
| 13 | main page (needs Chart.js) | **hovering a lap in the session chart lists that lap once**: one tooltip item and one "Lap 10:" / "Speed:" block, not the bar, the line and the average line separately (real mouse move on the chart) |
| 14 | overlapping riders | exactly 17 cards; the rider from 5 hours later and the old session are not listed; you are not listed |
| 15 | overlapping riders | sorted by "In your group" (longest first) and, at equal group minutes, by "Skated together"; several riders share the same group minutes but not the same time together, so the tie-break is really tested; every card also shows an "In your group" estimate (`~`); the all-day rider shows `0 min`, is dimmed and is last |
| 16 | dashboards | the overlap search opens **Together** by itself; the list is a timing tower: position numbers 1, 2, 3..., two bars per rider (skated together, in your group) within 0-100%, a full bar for the whole session, the group bar shorter |
| 17 | overlapping riders | "Select all skated together" picks exactly the 16 riders with more than 0 min, not the all-day rider; toggles to "Select none" and back |
| 18 | open replay | address `replay.html?transponder=AB-12345&activity=1&riders=<the 16 riders>`; stored data has 18 riders, 16 selected, 400 m track, `togetherMs`/`groupMs` on every rider |
| 19 | replay | 17 riders shown: **10 with a colour, 7 small dots**; header "(17 shown, first 10 labelled)"; the all-day rider is listed but not shown ("together 0 min") |
| 20 | replay | riders with 0 min together are not in the list at all (the all-day rider), and no listed rider says "together 0 min" |
| 21 | dashboards (replay) | the replay page has the dashboards Replay and Riders; the track fits inside its space with its own proportions (about 1.96 wide to high) and the lap graph is not cut off below the screen |
| 22 | replay | the clock starts at the reference rider's first lap start **even though the other riders' laps arrive first** (the fake API delays the reference rider's laps by 800 ms on purpose) |
| 23-25 | replay | play/speed sit under the track, the lap graph under them, and there is no time slider; the lap graph follows "you" and the readout shows `Lap 1 · <s>s · <km/h> km/h`; every rider row shows lap, time, speed and the gap in metres to you |
| 26 | replay | the back link returns to `index.html?transponder=...&activity=...` (the same activity) |
| 27-29 | replay | clicking a small dot gives that rider a colour (still 10 coloured, checkbox untouched); clicking a coloured dot makes it small (the next rider takes the free colour); clicking your own dot does nothing |
| 30-31 | replay | Hide all keeps only you, Show all skated together restores the same 17; a rider can be added and removed with the checkbox |
| 32-33 | lap graph | starts with every lap in view (slider = slowest lap rounded up + 1), the slider and the text box stay in sync, invalid text shows an error without changing the slider, clicking the graph moves the replay clock |
| 34 | replay | **Compare** draws another rider in the lap graph: the graph changes, the line under the header names him with his lap time and the difference to yours, the line is paler (half transparent) and in another colour (checked by counting canvas pixels), only one rider at a time, hiding him ends it, and turning it off restores the graph exactly; you cannot compare with yourself |
| 35 | playback | the clock advances by at least 4 s in 1.5 s at 5x, and the button toggles Play/Pause |
| 36 | remembered settings | after choosing 30x and following another rider, reloading the replay keeps 30x and that rider |
| 37 | theme | the switch sets `data-theme="dark"`, stores it in `localStorage`, changes the page colour, and switches back |
| 38 | remembered settings | after moving the "lap time threshold" slider, reloading the main page keeps that value |
| 39-41 | deep links (needs Chart.js) | `index.html?transponder=...&activity=...` opens that session (summary tiles filled, address unchanged); choosing another activity, or none, updates the address bar; an unknown activity id shows "Activity ... was not found" and is dropped from the address |
| 42 | phone layout | at 390 px wide neither the replay page nor the main page scrolls sideways, and a rider's live text sits under the name |
| 43 | replay link | a replay link opens the same replay **without any stored data** (as on another computer or in a private window): the whole replay is rebuilt from the address, 17 riders shown, the all-day rider not, the clock starts when you entered the ice, nothing is written to storage |
| 44 | replay link | `riders=2,3` shows only you and those two; the address bar follows the list when a rider is added |
| 45 | replay | the **share button** is a small icon button in the top right corner and copies the link (the clipboard holds the address of the replay) |
| 46 | replay link | `riders=none` shows only you; a link to an unknown activity gives the message "Activity ... was not found" |
| 47 | replay | without stored data the page explains how to open a replay |
| 48 | app | every page is called Icesights, links the manifest, and the manifest and each of its icons are served as PNG images |
| 49 | app | the **service worker** takes over the page and keeps the app shell (20 or more files); with the network switched off the app (and a replay link) still opens, scripts included |
| 50 | app | the **Install app** button appears when the browser offers the install (the default install banner is replaced), starts the install when clicked, and hides again |
| 51 | app | a page with a transponder in the address **finishes loading** (the `load` event fires) even though the profile picture cannot be loaded, and the failed picture is removed |
| 52 | app | **one app per transponder**: with `?transponder=` the manifest is the transponder's own (own `id`, `start_url` on that transponder, name and short name), Chrome accepts it (no manifest or installability errors) and offers it, the button reads "Install XX-12345"; another transponder changes the manifest, something that is not a transponder gives the general app again |
| 53 | app | loading a transponder on the main page makes "Install" the app of that transponder |
| 54 | whole run | **no exception and no `console.error` on any page** |

## 5. How to verify the output

### 5.1 Exit codes (use these in scripts and CI)

| Command | 0 | 1 | 2 |
|---|---|---|---|
| `npm test` | all passed | at least one test failed | - |
| `npm run test:worker` | `ALL PASS` | `<n> FAILED` | - |
| `npm run test:e2e` | `ALL PASSED` (may include `SKIP`s) | at least one step `FAIL`ed | the test could not run: no browser found, or the browser did not start |

### 5.2 Expected tallies (a change in these numbers means tests were added or removed)

| Suite | Expected |
|---|---|
| unit | `# tests 157`, `# suites 42`, `# pass 157`, `# fail 0`, `# cancelled 0`, `# skipped 0` |
| Worker | 49 `PASS` lines, no `FAIL`, last line `ALL PASS` |
| browser | 27 `PASS` lines, no `FAIL`, no `SKIP`, last line `ALL PASSED`. Without access to the Chart.js CDN, the four chart steps are replaced by one `SKIP` line (23 `PASS` lines) and the last line reads `ALL PASSED (1 skipped)` |

Quick machine check:

```bash
npm test 2>&1 | grep -E "^# (tests|pass|fail)"                          # tests 157 / pass 157 / fail 0 (piped output is TAP;
                                                                        # in a terminal the same lines start with "ℹ" instead of "#")
npm run test:worker 2>&1 | grep -c "^PASS"                              # 49
npm run test:e2e 2>&1 | grep -cE "^PASS"                                # 27
npm run test:e2e 2>&1 | grep -E "^(FAIL|SKIP)"                          # nothing when everything ran
```

### 5.3 Failure, or an environment problem?

| You see | Meaning | Action |
|---|---|---|
| `FAIL  <step>` followed by an indented reason | a real failure of the code or of a test | read the reason: it names the expected and the actual value; then look at the source file in the table of section 3 |
| `SKIP  main page: lap table, statistics and GPX download  (Chart.js could not be loaded ...)` | no internet access to the Chart.js CDN, so the four steps that need the charts (summary, speed analysis, slider, GPX download) cannot run | not a code failure. Re-run with internet to execute those steps; the rest of the run is valid |
| `No Chrome, Chromium or Edge found ...` (exit code 2) | no browser at a known location | install one or set `CHROME_PATH` |
| `The browser did not start.` | browser found but it could not be started (sandbox, display, permissions) | try another browser via `CHROME_PATH`; on Linux servers use a Chromium package |
| `Timed out after 30 s waiting for: ...` | a page did not reach the expected state | run the step's page in a normal browser against the same server to see what is different; check for a JavaScript exception in `page.problems` |
| `EADDRINUSE` / connection refused for the debugging port | the random debugging port was taken | just run again (a new random port is chosen) |
| unit tests: `Values have same structure but are not reference-equal` | a test compared an array/object that came out of the sandbox with one made in the test | wrap the value with `hostCopy(...)` (see section 7) |

### 5.4 Reading a failure precisely

- Unit tests use `assert` from Node: the message shows `actual` and `expected`. For time-based numbers the tests use tolerances (for example `± 0.001`); a failure outside the tolerance is real.
- The browser test evaluates JavaScript **inside the page** and asserts in Node. When a step fails, the message includes what was found. To look at the page yourself, start the server and open it by hand:
  ```bash
  node -e "const {buildFakeData}=require('./tests/fixtures/fake-mylaps-data');const {buildStubScript}=require('./tests/fixtures/fake-api-stub');const {startStaticServer}=require('./tests/e2e/browser');startStaticServer(buildStubScript(buildFakeData())).then(({port})=>console.log('open http://127.0.0.1:'+port+'/index.html?transponder=AB-12345'))"
  ```
  This prints an address to open in any browser; the page then runs against the fake data. (Stop it with Ctrl+C.)

## 6. The fake data

Source: `tests/fixtures/fake-mylaps-data.js`. It builds **one busy evening at a fake rink** ("Jaap Eden",
sport "Speed Skating", track length 400 m, location id 5) in exactly the shape the real API returns
(`dateTimeStart` as ISO string, `duration` as text such as `"38.412"`, `stats`, `bestLap`, `sessions[].laps[]`).
`T0` is `2026-09-01T18:00:00Z`; times below are minutes after `T0`. Laps are back to back with a duration of
`pace + sin(lapNumber/3 + id) * 1.5` seconds, so the data is deterministic.

| Id | Who | Activity window | Laps | Purpose |
|---|---|---|---|---|
| 1 | **you** (chip `AB-12345`, "Alex Evers - Zoom") | 0 - 20 | 38 s pace | the reference rider; everything is relative to this activity |
| 2, 3, 4, 7 | Bram, Eva, Gijs, Early Bird | 5-25, 10-30, 12-40, -5-15 | 36-44 s pace | riders who overlap you partly |
| 20 - 31 | twelve "Extra" riders | 0 - 20 | 37-42 s pace | makes more than 10 riders so the "10 coloured + small dots" rule is exercised |
| 40 | Daan "Allday" | **-30 - 90** | only between **40 and 55** | activity window covers yours, but he skated long after you: must show **0 min together** |
| 5 | Ilse | 300 - 330 | | skates 5 hours later: must **not** be listed as overlapping |
| 9 | Old Session | 2026-08-01 | | another month: must **not** be listed |
| 101 - 124 | your older sessions (same chip as you) | 2024 - 2026, one hour each | none (they are only listed) | fills your activity list with 25 activities: 13 in 2026 (12 older + today's), 9 in 2025, 3 in 2024, to exercise the year filter. Dates are mid-month, so the year is the same in every time zone |

Numbers derived from it (used by the browser test):

- overlapping activities = ids 2, 3, 4, 7, 20-31, 40 = **17** (5, 9 and yourself excluded)
- riders who really skated with you (together > 0) = 17 - the all-day rider = **16**
- your activity list = **25** activities (13 in 2026, 9 in 2025, 3 in 2024); the fake API returns them all for your chip, newest first
- replay shows you + those 16 = **17** riders: 10 coloured, 7 small; the all-day rider is listed but hidden
- payload stored for the replay: 18 riders (you + 17), `selected` = 16

The fake API for the browser (`fixtures/fake-api-stub.js`) answers `userid`, `activities`, `account`,
`locations` (all activities newest end time first) and `laps`; everything else (avatars) is a 404. It also
replaces `window.open` so "Open replay" records its address in `window.__opened`. **The reference rider's laps
are delayed by 800 ms** so that on the replay page the other riders' laps arrive first (this reproduces a real
race condition that once started the replay at the wrong time).

`fixtures/fake-location-server.js` fakes the list of activities of a rink the way the real endpoint behaves:
**a page holds at most 200 activities even when more are requested, and the list is sorted by end time,
newest first.** `makeActivities(n)` creates such a list in which every 7th session started 6 hours before it ended.

## 7. How the unit tests reach the browser scripts

The site's JavaScript files are **plain browser scripts**, not modules: they share one global scope and are
loaded in a certain order by the HTML pages. `tests/helpers/browser-scripts.js` reproduces that inside a Node
`vm` context:

```js
const { loadBrowserScripts, hostCopy } = require('../helpers/browser-scripts');
const app = loadBrowserScripts(['utils.js', 'replay-track.js', 'replay-model.js']);   // load order matters
const { normalizeLaps, riderStateAt } = app.sandbox;   // function declarations are properties of the sandbox
const minKph = app.get('MIN_SKATING_KPH');             // top-level const/let are not: read them by name
app.sandbox.fetch = async url => ({ ok: true, status: 200, json: async () => ({}) });   // replace a global
```

Rules to remember when writing tests:

1. **Load order = the script order of the HTML page** (`utils.js` first; `replay-model.js` needs `replay-track.js` because it calls `trackDelta`).
2. **Arrays and objects created by the scripts belong to another JavaScript realm.** `assert.deepEqual` treats them as different from the same data made in the test. Wrap them: `assert.deepEqual(hostCopy(result), [1, 2])`.
3. Anything the scripts read from the environment (`fetch`, `document`, `setTimeout`) is a property of the sandbox and can be replaced per test. `api.test.js` replaces `setTimeout` so that retry waits (500 ms x attempt) do not slow the tests down.
4. The scripts contain `if (typeof module !== 'undefined') module.exports = ...` guards for use in Node; inside the sandbox `module` is undefined, so they are skipped. Use `app.sandbox.<name>`.
5. DOM-only code (`script.js`, `replay.js`, `fetch_overlapping_sessions.js`) is exercised by the browser test, not by unit tests.

## 8. Prove the tests can fail (mutation checks)

A green result is only meaningful if the tests go red when the code is wrong. Three deliberate breakages, each
of which **must** make tests fail. Do this only on a clean working tree; `git checkout -- <file>` restores the file.

```bash
git status --short api.js replay-model.js replay-track.js       # must print nothing

# 1) paging skips 50 of every 200 activities again  -> expect 3 failures in api.test.js
sed -i 's/offset += newActivities.length;/offset += requestedCount;/' api.js
npm test; git checkout -- api.js

# 2) break laps are counted as skating              -> expect 2 failures (riderStateAt, onIceOverlapMs)
sed -i 's/^const MIN_SKATING_KPH = 8;/const MIN_SKATING_KPH = 0;/' replay-model.js
npm test; git checkout -- replay-model.js

# 3) finish line moved back to the middle of the straight -> expect 3 failures in replay-track.test.js
sed -i 's|f = ((((f % 1) + 1) % 1) + 1 / 8) % 1;|f = (((f % 1) + 1) % 1);|' replay-track.js
npm test; git checkout -- replay-track.js

npm test                                                         # green again: 157 passed
```

(`sed -i` is GNU sed, as in Git Bash or Linux. On macOS use `sed -i ''`. On plain PowerShell, edit the line by hand.)

The results seen when this was written: 106 pass / 3 fail, 107 pass / 2 fail, 106 pass / 3 fail, then 109 pass / 0 fail (before the group rule was rewritten).

The same idea works for the newer features (make a change, expect the named test to fail, restore the file): setting `ACTIVITIES_COUNT` in `api.js` to 100 fails the `fetchActivities` test; making `saveSetting` do nothing fails the two "remembers ..." browser steps; removing the `yearFilter` change handler in `script.js` fails the year filter step.

## 9. Optional: checks against the live proxy

These are **not** part of the automated suites (they need internet and hit a real service), but they show
that the deployed proxy behaves as documented. Replace the transponder by any valid one (format `XX-12345`).

```bash
W=https://mylaps-proxy.iceskater.workers.dev

curl -s  "$W/"                                                        # -> MYLAPS proxy is running.
curl -si "$W/api/mylaps/userid/PZ-28583" | head -20                   # 200, JSON {"userId": ...}
for i in 1 2 3; do curl -s -o /dev/null -D - "$W/api/mylaps/userid/PZ-28583" | grep -i '^x-upstream-cache'; done
                                                                      # first MISS (maybe twice), then HIT: Cloudflare cache works
curl -s -o /dev/null -w "%{http_code}\n" -H "Origin: https://evil.example" "$W/api/mylaps/userid/PZ-28583"   # 403
curl -s  "$W/api/mylaps/laps/..%2Fx"                                  # {"error":"Missing or invalid id in the path."}
```

Expected: JSON answers with `Cache-Control: public, max-age=...`; `X-Upstream-Cache` reaches `HIT`; other origins get 403.
Be considerate: this is an unofficial API behind a free-tier proxy, so do not loop requests in bulk.

## 10. Rules the tests protect (domain knowledge)

Understanding these makes the tests (and the code) easy to read.

- **Laps and the finish line.** A lap starts when the rider crosses the finish line (`dateTimeStart`) and lasts `duration`. Its time is only known when it ends, so a lap's dot in the graph is drawn at the lap's **end**.
- **Position inside a lap** is interpolated evenly: `fraction = (t - lapStart) / lapDuration` (constant speed within a lap). Fraction 0 is the finish line.
- **The track** is an oblong of total length 1: corner (0-0.25), straight (0.25-0.5), corner (0.5-0.75), straight (0.75-1); on a 400 m track that is 100 m each. The finish line is at the end of the bottom straight, right before the right-hand corner. Skaters move counter-clockwise.
- **Break laps.** Real sessions contain "laps" of 5-10 minutes (someone stepped off the ice). A lap slower than **8 km/h** is a break: the rider is off the ice, is ignored in overlap and group calculations, and appears as a grey dot pinned to the top of the lap graph.
- **Small gaps.** A gap of up to 5 s between two laps keeps the rider at the finish line instead of making them disappear.
- **Skated together** = total time both riders were skating at the same moment (overlap of their lap intervals, breaks excluded). It is 0 for someone whose activity window merely covers yours (an all-day recording).
- **In your group** = riders who cross the finish line within 1 second of you, and then each next rider who crosses within 1 second of the one before (forwards and backwards), as far as a quarter of your lap time before and after you (about 100 m). Each such crossing counts as one of your laps for that rider. It is decided from everyone's finish crossings together (`groupMembership`), so it is not a per-rider measurement.
- **Sorting of overlapping riders**: first by "in your group" in **whole minutes** (as displayed, longest first), then by "skated together" (whole minutes), and only then by the exact values. So everyone at 0 min in the group is ordered by time together. Riders that could not be measured come last.
- **"Select all" / "Show all"** only pick riders with more than 0 min together (fallback: everyone, when nobody could be measured).
- **Colours.** The reference rider and the first riders that were shown (10 in total) get a coloured dot with initials; every other rider is a small blue dot. Clicking the dot in the rider list gives or takes away a colour; when all 10 colours are taken, the rider picked longest ago gives one up. Ten colours are validated for both themes.
- **The rink activity list** (`/locations/:id`): a page holds **at most 200** activities even if 250 are requested, so the next offset must advance by the number received; the list is sorted by **end time**, newest first, so paging stops when the last activity of a page ended before the session started (comparing start times stops too early).
- **Caching.** Laps of an activity that started on an earlier day (and has ended) are requested with `?finished=1`, which lets the proxy cache them for 30 days. Activities of today and live ones are not kept long.
- **The whole activity list.** Without a count the proxy returns only the newest 100 activities; the website asks for `count=500` (the proxy's maximum), so older sessions (back to 2011 for the developer's account) appear. A year filter narrows the list; a selected activity stays selected only when it is in the chosen year.
- **Active time.** MYLAPS reports the total training time (first to last lap) and the active training time (the laps). The session summary shows the active time and its share of the total; the card says "N/A" when either time is missing.
- **Remembered settings.** `localStorage` keys `mylaps.maxFastLapSeconds` (main page slider), `mylaps.replaySpeed` and `mylaps.followChip` (the transponder of the rider whose lap graph was followed last), plus `theme`. Values that no longer fit (for example a slider value outside its range) are ignored, and a browser that blocks storage simply forgets the settings.
- **Deep links.** `index.html?transponder=XX-12345&activity=123` opens straight on that session; the address bar follows the chosen activity (`history.replaceState`), so it can be copied and shared. An unknown activity id shows a message. The replay's back link carries the activity id.
- **Replay links.** `replay.html?transponder=...&activity=...&riders=...` works without stored data: the replay is rebuilt from the address with the same search as the main page (`loadOverlappingRiders`). `riders=none` means nobody but you; without `riders`, everyone who skated with you. The address bar follows the shown riders and the share button copies it.
- **Phone layout.** Under 768 px the page uses one column and the rider details sit under the name; on touch screens (`pointer: coarse`) buttons, checkboxes, rider dots and the theme switch are larger. Tables that are wider than a phone scroll inside their own box, never the page.
- **Master tracks.** One GPX lap per rink in `/tracks`, registered in `MASTER_TRACKS` (`gpx-generator.js`) by MYLAPS location id (with a name fallback). A rink without a file gets no download button.

## 11. Changing things

**Add a rink for the Strava GPX download.** Put a one-lap GPX file in `tracks/` (about 400 m, first point = last point, timestamps increasing), add an entry to `MASTER_TRACKS` in `gpx-generator.js`, then run `npm test`. `gpx-generator.test.js` fails if a file in `tracks/` is not registered, if a registered file is missing, or if a file is not a closed lap of 380-420 m. Add a line to the id/name tests in the same file for the new rink. (Rinks that are not 400 m long, such as Nijmegen with 312 m, would need the length check adjusted.)

**Add a unit test.** Create `tests/unit/<name>.test.js`, use `node:test` (`describe`, `it`) and `node:assert/strict`, load the scripts with `loadBrowserScripts` (section 7). It is picked up automatically by the pattern `tests/unit/*.test.js`.

**Add fake riders or laps.** Edit the `CAST` list in `fixtures/fake-mylaps-data.js` and update the derived numbers in section 6 and in the constants at the top of `replay-flow.e2e.js` (`OVERLAPPING`, `SKATED_WITH_YOU`, the "10 coloured" expectation depends on having more than 10 riders shown).

**Add a browser step.** Add another `await step('name', async () => { ... })` in `replay-flow.e2e.js`. Inside a step, `page.evaluate('<javascript>')` runs code in the page and returns the result; `page.waitFor('<expression>', 'description')` waits until an expression is true. Keep steps independent of timing (wait for a state, do not sleep).

**Look at the page (screenshots).** The browser helper exposes `page.send(...)` for raw DevTools commands, for example `Page.captureScreenshot`. Screenshots are not asserted by any test; use them to inspect layout changes by eye.

## 12. Troubleshooting

- **PowerShell: `npm.ps1 cannot be loaded because running scripts is disabled on this system`**: a Windows setting, not a project problem. Use `npm.cmd` instead of `npm`, or Command Prompt / Git Bash (see section 2).
- **Everything fails with a syntax error at `??`, `?.` or `node:test`**: Node is too old. Install Node 22 or newer.
- **`npm test` finds no tests**: run it from the repository root, and check that the quotes around the glob survive your shell (`"tests/unit/*.test.js"`).
- **`test:e2e` prints one `SKIP` line instead of the four chart steps**: Chart.js could not be downloaded. Everything else ran.
- **`test:e2e` hangs at "waiting for the page to load"**: a page script threw during start-up. Run the manual server command from 5.4 and open the address with the browser's developer tools open.
- **Time-zone dependent step**: the replay start-clock step compares the page's clock with `new Date(T0).toLocaleTimeString('en-GB')` computed in Node. Both use the machine's time zone, so this only fails if the browser and Node run with different time zones (for example a browser in a container with another `TZ`). Start both with the same `TZ`.
- **Leftover folder `mylaps-e2e-*` in the temp directory, or headless browser processes still running after `test:e2e`**: the test stops the whole browser process tree and deletes its temporary profile itself. If a run was interrupted (Ctrl+C, crash) they can stay behind; it is safe to end the browser processes whose command line contains `mylaps-e2e-` and to delete the folders. It never fails a run.
- **Worker tests pass but the deployed Worker behaves differently**: the tests run the code with a fake MYLAPS and a fake `fetch`; Cloudflare's real cache (`cf` options) is only observable on the deployed Worker (section 9).

## 13. What is not covered

- **Real MYLAPS data.** Tests use fake data on purpose. Real answers contain oddities (all-day activities, 5-10 minute "laps", occasional `500`/`401` answers) that the fake data imitates only in part: the all-day rider, the response shape and the paging rules are imitated; the transient server errors are covered by the retry unit tests and the Worker tests.
- **Visual appearance.** No screenshot comparison, no phone-width layout test, no contrast checks (the colour palette was validated separately with a colour-blindness/contrast validator when it was chosen).
- **`search_user.html` / `search_user.js`** (name search page) and **`strava.js`** (an unfinished upload module that no page loads).
- **Cloudflare's real edge cache and CORS behaviour** (only checkable on the deployed Worker, section 9).
- **Rinks that are not 400 m** in the replay shape (the oblong is always drawn as a 400 m style track; times and speeds do use the real length).
