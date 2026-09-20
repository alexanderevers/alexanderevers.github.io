# Icesights (MYLAPS insights)

*Icesights = ice + insights.* The app was called "MYLAPS Activity Viewer" before; the repository keeps its name.

A static website that shows training data from the MYLAPS Speedhive ice-skating timing system: lap times,
speed-lap statistics, who else was on the ice with you, a race replay on an ice-track drawing, and a GPX
export for Strava. It runs as plain HTML/CSS/JavaScript on GitHub Pages (`https://alexanderevers.github.io`) and
talks to MYLAPS through a small proxy on Cloudflare Workers.

- **New here (person or AI)?** Read this file, then [DOCUMENTATION.md](DOCUMENTATION.md) (behaviour in detail),
  then [tests/README.md](tests/README.md) (how to run and verify everything).
- **Just want to check it works?** `npm test && npm run test:worker && npm run test:e2e` (Node 22+, no install needed).

## What it does

The site is a row of full-screen **dashboards** (racing look, dark or light): the page does not scroll in between, it snaps from one dashboard to the next, and a numbered navigation on the right shows where you are. The main page has Start, Session (the best lap as hero figure), Speed laps and Together (a timing tower with a bar per rider); the replay has Replay (track, controls and lap graph on one screen) and Riders.

| Page | Features |
|---|---|
| `index.html` (main) | look up a transponder (`XX-12345`; the field adds capitals and the dash by itself and cleans up pasted text); list **all** its activities (up to 500, with a year filter, each with its day of the week: "Tue 01/09/2026 - 20:00 - ..."); session summary tiles and charts; a "lap time threshold" slider that separates speed laps from the rest; speed-lap analysis (average, median, best 5, consistency, fade, speed blocks with distance and totals, distribution); session summary cards (including how much of the session you were really skating); **GPX download for Strava** (for rinks that have a track file); **find overlapping sessions**: every rider who was on the ice during the activity, with *skated together* and *in your group* estimates, sorted by in your group first, then by skated together |
| `replay.html` | **race replay**: the chosen riders on an oblong 400 m ice track, driven by their real lap times; play/pause/speed, and click or drag the lap graph (under the play controls) to jump to a moment; up to 10 riders with a colour and initials, the rest as small dots (click a rider's dot in the list to give or take a colour); a lap-time graph of one rider with a moving line and a max-lap-time slider, and a **Compare** button on every rider to draw that rider's lap times in the same graph (paler, other colour); riders with 0 min together are left out of the replay; show/hide riders one by one or "all who skated with you" |
| `search_user.html` | search riders by name and see their last session |
| all pages | works on a phone (one column, big touch targets); the main page address can be shared as a **deep link**: `index.html?transponder=XX-12345&activity=123` opens straight on that session. A replay can be shared too: its address (`replay.html?transponder=...&activity=...&riders=...`) rebuilds the whole replay on any computer, and the share button in the top right corner of the replay page copies it. Light/dark theme switch (follows the OS until you choose). The theme, the "lap time threshold", the replay speed and the rider you followed last are remembered in your browser |

## Install it as an app

Icesights is an installable web app (PWA). In Chrome on Android open the site and choose **Install app** (or press the **Install app** button in the top bar when it appears); it then opens in its own window with its own icon. **One app per transponder:** once a transponder is loaded (or the address has `?transponder=XX-12345`) the button reads **Install XX-12345**; that installs a separate app with its own name and icon that opens on that transponder's activities, so the number is filled in and loaded when you start it. Every transponder can have its own app. It works on desktop Chrome and Edge too, and iPhones can use "Add to Home Screen". The app opens without a connection (the shell), but the lap data still needs the internet. Details in [DOCUMENTATION.md](DOCUMENTATION.md#installable-app-pwa).

## Architecture

```
 browser (GitHub Pages)                        Cloudflare Worker                     MYLAPS Speedhive
 index.html / replay.html /        HTTPS       cloudflare-worker/src/index.js        usersandproducts-api.speedhive.com
 search_user.html              -------------->  - validates path and query   ----->  practice-api.speedhive.com
 plain scripts, Chart.js (CDN)                  - adds Origin/Referer headers        search.speedhive.com
                                <--------------  - adds CORS headers          <-----
                                                - caches answers (30 days for
                                                  finished sessions ... 1 minute)
```

Why a proxy: the MYLAPS API does not allow requests straight from a browser (CORS) and expects an `Origin` and
`Referer` header that a browser cannot set. The Worker forwards requests with those headers, only serves the
GitHub Pages site (and local test servers), and caches answers so repeated requests never reach MYLAPS.

## Repository map

```
index.html  script.js  chart-factory.js  stats.js  gpx-generator.js   main page (charts, statistics, GPX)
fetch_overlapping_sessions.js                                        overlapping riders, sorting, "Open replay"
replay.html  replay.js  replay-model.js  replay-track.js             race replay, lap model, track geometry
dashboards.js  dashboards.css                                        the full-screen dashboards: snap scrolling, navigation, racing look
manifest.webmanifest  sw.js  pwa.js  icons/                          installable app: manifest, service worker, install button, app icons
tools/generate-icons.js                                              draws the app icons (icons/*.png)
search_user.html  search_user.js                                     name search
api.js  utils.js  theme.js  style.css                                proxy calls (retries, paging), helpers, theme, styles
strava.js                                                            unfinished Strava upload module (not loaded by any page)
tracks/*.gpx                                                         one lap per rink for the GPX export
ijsbanen_list.txt                                                    Dutch rinks with MYLAPS ids, lap length, and whether a track exists
cloudflare-worker/                                                   the proxy (README with step-by-step setup, tests, wrangler config)
tests/                                                               unit, browser (end-to-end) tests and the fake data
DOCUMENTATION.md                                                     architecture and behaviour
```

There is **no build step and no framework**. Each page loads its scripts in a fixed order (see the `<script>`
tags at the bottom of each HTML file); the scripts share one global scope. `api.js` holds the proxy address
(`PROXY_BASE_URL`).

## Run it locally

The site is static, so any web server works. Use `http://` (not `file://`): the GPX export loads track files
with `fetch`, which browsers block for local files.

```bash
npx --yes http-server -p 8080 -c-1        # then open http://localhost:8080/
# alternatives: python -m http.server 8080   |   VS Code "Live Server" (port 5500)
```

The proxy only accepts `https://alexanderevers.github.io`, `localhost`/`127.0.0.1` on ports **8080** and **5500**,
and pages opened from a file. Another port is answered with `403`; change `ALLOWED_ORIGINS` in
`cloudflare-worker/wrangler.toml` and redeploy if you need one.

**On Windows PowerShell, `npm` or `npx` may fail with "running scripts is disabled on this system".** Use
`npm.cmd` / `npx.cmd` instead (for example `npm.cmd test`), or open Command Prompt or Git Bash. A one-time fix for
PowerShell is `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`. Details in
[cloudflare-worker/README.md](cloudflare-worker/README.md#run-it-on-your-own-computer).

To try the pages **without internet or the real API**, use the fake data of the tests. This prints an address to open:

```bash
node -e "const {buildFakeData}=require('./tests/fixtures/fake-mylaps-data');const {buildStubScript}=require('./tests/fixtures/fake-api-stub');const {startStaticServer}=require('./tests/e2e/browser');startStaticServer(buildStubScript(buildFakeData())).then(({port})=>console.log('open http://127.0.0.1:'+port+'/index.html?transponder=AB-12345'))"
```

## Test it

Node.js 22 or newer. No `npm install` is needed.

```bash
npm test               # 157 unit tests (about 1.5 s)
npm run test:worker    # the proxy's tests against a fake MYLAPS
npm run test:e2e       # a real headless Chrome/Edge clicking through the whole flow on fake data (about 11 s)
npm run test:all       # unit + worker
```

Everything about running, expected output, exit codes, the fake data, mutation checks and troubleshooting is in
[tests/README.md](tests/README.md).

## Deploy

- **Website**: push to the default branch; GitHub Pages serves the repository root. Make sure new files (for
  example a `.gpx` in `tracks/`) are committed, otherwise the live site returns 404 for them.
- **Proxy**: `cd cloudflare-worker && npx wrangler deploy` (first time: `npm install`, `npx wrangler login`).
  Address: `https://mylaps-proxy.iceskater.workers.dev`. Full step-by-step guide in
  [cloudflare-worker/README.md](cloudflare-worker/README.md).

## Core ideas (the short version)

- A lap starts when the rider crosses the finish line and lasts `duration`; a position inside a lap is interpolated
  evenly. Laps slower than 8 km/h are *breaks* (someone stepped off the ice) and are ignored.
- **Skated together** = time both riders were skating at the same moment. **In your group** = time you crossed
  the finish line together with a group: riders who cross the finish line within 1 second of you, and then each next rider who crosses within 1 second of the one before (forwards and backwards), as far as a quarter of your lap time before and after you (about 100 m). Each such crossing counts as one of your laps for that rider.
- The rink's activity list has pages of at most 200 and is sorted by **end** time; the code pages accordingly.
- Laps of activities that ended more than 15 minutes ago are requested with `?finished=1`, which lets the proxy cache
  them for 30 days.
- One master GPX lap per rink in `tracks/`, registered in `gpx-generator.js` by MYLAPS location id.

The full list of rules, each backed by a test, is in [tests/README.md](tests/README.md#10-rules-the-tests-protect-domain-knowledge).

## Known limitations

- Rinks that are not 400 m (Nijmegen 312 m, Leiden 250 m) show correct times and speeds, but the replay always draws
  the track with 400 m proportions.
- Rinks without a track file have no GPX download (see `ijsbanen_list.txt` for which ones).
- `strava.js` (direct upload to Strava) is unfinished and not wired in; the GPX is downloaded as a file.
- The main page loads Chart.js from a CDN, so its charts need internet access.
