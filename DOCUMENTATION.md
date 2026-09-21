# Icesights Documentation (formerly MYLAPS Activity Viewer)

This document provides an overview of the project structure, focusing on the Cloudflare Worker proxy server and its interaction with the frontend application. For a quick start see `README.md`; for running and verifying everything see `tests/README.md`.

## Project Overview

The MYLAPS Activity Viewer is a web application that fetches and displays training activity data from the MYLAPS Speedhive platform. It consists of a static frontend (HTML, CSS, JavaScript) and a serverless proxy backend running on Cloudflare Workers.

## Proxy Server (Cloudflare Worker)

The proxy server is essential for this application to work. The MYLAPS Speedhive API does not allow direct requests from a web browser (CORS restrictions, and it expects an `Origin`/`Referer` header that a browser cannot set). The proxy acts as a middleman: it receives requests from the frontend, forwards them to the MYLAPS API with the correct headers, and relays the answer back. It also **caches** answers, so repeated requests never reach MYLAPS.

### Key Details

-   **Location:** the code is in the `/cloudflare-worker` directory (`src/index.js`, `wrangler.toml`). A step-by-step setup guide is in `cloudflare-worker/README.md`.
-   **Public URL:** `https://mylaps-proxy.iceskater.workers.dev` (used as `PROXY_BASE_URL` in `api.js`, with `/api/mylaps` appended).
-   **Account:** Cloudflare free plan (100,000 requests per day, no credit card), account `contact.alexander.evers@gmail.com`.
-   **Who may use it:** only `https://alexanderevers.github.io`, local test servers and pages opened from a file (`ALLOWED_ORIGINS` in `wrangler.toml`). Other websites get a 403.
-   **Previous proxy:** an earlier Google Cloud Function (`mylapsProxyFunction`) was replaced by the Worker. It stopped responding (HTTP 503) and its code has been removed from the repository.

### Deployment

From the `cloudflare-worker` folder:

```bash
npm install          # first time only
npx wrangler login   # first time only: opens a browser, click Allow
npx wrangler deploy
```

To verify (run it twice; `X-Upstream-Cache` changes from `MISS` to `HIT`):

```bash
curl -i "https://mylaps-proxy.iceskater.workers.dev/api/mylaps/userid/PZ-28583"
```

Other useful commands: `npm test` (checks against a fake MYLAPS), `npx wrangler dev` (run it locally on http://127.0.0.1:8787 without a login) and `npx wrangler tail` (live logs).

### Caching

| Data | Kept by Cloudflare for |
|---|---|
| Laps of an activity that started on an earlier day (the site adds `?finished=1`) | 30 days |
| Laps of an activity that may still be recording | 1 minute |
| Transponder to account, account profile, avatar | 1 day |
| A rider's activity list, chip activity list | 2 minutes |
| Activity list of a location | 5 minutes |
| Name search | 10 minutes |

Error answers are never cached. Browsers keep answers for at most one day (`Cache-Control`).

### Endpoints

The proxy exposes several endpoints that map to the underlying MYLAPS API:

-   `/api/mylaps/userid/:transponder`: Fetches the `userId` for a given transponder number.
-   `/api/mylaps/activities/:userId`: Fetches a list of activities for a user. Supports optional `count` (1 to 500, default 100) and `order` query parameters. The website asks for `count=500` so that the whole list comes back; without it only the newest 100 activities are returned.
-   `/api/mylaps/search?term=...`: Searches active profiles by name. Supports `count` and `offset`.
-   `/api/mylaps/laps/:activityId`: Fetches lap data for a specific activity. Add `?finished=1` for an activity that started on an earlier day (and has ended) so the laps are cached for a long time; activities of today are only cached for a minute (live: one second).
-   `/api/mylaps/account/:userId`: Fetches a user's profile information (name, etc.).
-   `/api/mylaps/avatar/:userId`: Fetches a user's profile image.
-   `/api/mylaps/locations/:locationId`: Fetches a list of activities for a location (`year`, `sport`, `count`, `offset`). A page holds at most 200 activities and the list is sorted by end time, newest first.
-   `/api/mylaps/chips/:chipCode`: Fetches a list of activities for a specific chip.

## Frontend Application

The frontend is a single-page application that handles user input, makes requests to the proxy server, and visualizes the data.

### Key Files

-   **`index.html`**: The main HTML file containing the structure of the page.
-   **`script.js`**: The core JavaScript file that contains the application logic for fetching data, handling user interactions, and updating the UI.
-   **`api.js`**: This file contains the functions responsible for making `fetch` requests to the proxy server. The `PROXY_BASE_URL` constant in this file must point to your deployed Cloudflare Worker URL (with `/api/mylaps` appended).
-   **`style.css`**: Contains all the styles for the application.

### Activity list, active time and remembered settings

- **Activity list:** `api.js` requests up to 500 activities (`ACTIVITIES_COUNT`). Each activity is listed with the day of the week ("Tue 01/09/2026 - 20:00 - Speed Skating - Jaap Eden", `formatDateTimeWithDay` in `utils.js`), and the same goes for the Start Time box next to the list. When they span more than one year a **Year** filter appears above the list ("All years (144)", "2026 (28)", ...). `utils.js` holds the helpers (`activityYearCounts`, `filterActivitiesByYear`).
- **Active time:** the session summary has an **Active Time** card: MYLAPS's `activeTrainingTime` and its share of `totalTrainingTime` (`activeTimeShare` in `stats.js`).
- **Remembered settings** (browser `localStorage`, via `loadSetting`/`saveSetting` in `utils.js`, all keys start with `mylaps.`):

| Key | What | Where |
|---|---|---|
| `theme` | light or dark, when you switched it by hand | all pages |
| `mylaps.maxFastLapSeconds` | the "lap time threshold" slider | main page |
| `mylaps.replaySpeed` | replay speed (1x to 60x) | replay page |
| `mylaps.followChip` | transponder of the rider whose lap graph you followed last (used again when that rider is in the replay) | replay page |

Nothing is sent to a server; a browser that blocks storage just forgets the settings.

### Dashboards (the look of the site)

Both pages are a row of **full-screen dashboards** (`<section class="dash">`, one screen each) instead of one long page:

- **Snapping:** `html.dashboards` uses `scroll-snap-type: y mandatory` and every `.dash` has `scroll-snap-align: start` with `scroll-snap-stop: always`, so the page stays put until you move on and then jumps to the next dashboard. A dashboard that is taller than the screen scrolls inside itself (`.dash-inner`), never the page. Phones and keyboards work the same way.
- **Navigation:** `dashboards.js` builds the numbered marks on the right from the dashboards that are on screen. A dashboard that is hidden with the `hidden` class (for example the session dashboards before laps are loaded) is left out; a MutationObserver keeps the marks up to date. `Dashboards.goTo(id)` scrolls to one; `script.js` calls it after Fetch Laps (Session) and the overlap search (Together).
- **Main page:** Start (choose transponder, year and activity), Session (summary tiles with the best lap as the hero figure, lap time threshold slider, lap chart), Speed laps and Together (the timing tower: position, rider, bars for skated together and in your group as a share of your session). `#lapsData` is a `display: contents` wrapper that shows and hides the three session dashboards together.
- **Replay page:** Replay (title, track, play controls, lap graph; the track is drawn as large as fits the space, see `resize()` in `replay.js`) and Riders (list with Compare buttons). Loading and error messages have their own screen (`#replayMessage`).
- **Hovering the lap chart:** the bars and the line of a speed lap are drawn at the same place, so the tooltip would list the lap twice (and the average line as a third item). `overviewTooltipFilter` in `chart-factory.js` keeps one item per lap and leaves the average line out. There is no separate lap table any more; the tooltip shows the lap number, time, start time, difference, session time and speed.
- **Look:** `dashboards.css` (layout, top bar, navigation, tiles, timing tower) on top of `style.css` (the colour tokens: near-black surfaces and a racing red accent `--accent`; `--accent-text` is the shade used for text). The data colours (`--cat-*`, `--series-*`) did not change; they were validated again against the new surfaces (`validate_palette.js`). Loading and error banners float above the dashboards (`.status-banner`).

### Installable app (PWA)

The site can be installed as an app ("Install app" in Chrome on Android, desktop Chrome and Edge; "Add to Home Screen" on iOS). Chrome's requirements are met by:

- **`manifest.webmanifest`:** name and short name `Icesights`, `display: standalone`, start page `index.html`, dark colours (`#12121a`), and the icons: 192 and 512 for any use plus a 512 **maskable** icon (Android cuts it to its own shape, so the mark stays inside the safe zone). Every page links it, plus `theme-color`, the icons and `viewport-fit=cover` (`env(safe-area-inset-*)` keeps the top bar and navigation inside notches and rounded corners).
- **`icons/`:** a slanted "i" with a red dot, drawn by `tools/generate-icons.js` with the headless browser of the tests (`node tools/generate-icons.js`); change the drawing there and run it again.
- **`sw.js` (service worker):** pages, scripts and styles of this site are **network first** (a new deploy shows up at once) with the cached copy used only when there is no connection, so the app opens offline. Chart.js from the CDN is kept and refreshed in the background. The MYLAPS proxy and avatars are never touched: the Cloudflare Worker already caches those. Change `VERSION` in `sw.js` when its file list changes; old caches are removed when the new worker activates. A unit test checks that every script, stylesheet and icon the pages load is in the list.
- **`pwa.js`:** registers the service worker (on https or localhost) and shows the **Install app** button in the top bar when Chrome offers the install (`beforeinstallprompt`), hiding it again after the install.

- **One app per transponder:** `pwa.js` makes the manifest of a transponder in the browser (`transponderManifest`, a Blob address): its own `id` (`<site>/?transponder=XX-12345`, so Chrome treats it as a different app), name `Icesights XX-12345`, short name `XX-12345` and `start_url=index.html?transponder=XX-12345`, which the main page loads straight away (deep link). `Pwa.useTransponder(...)` is called with the transponder of the address and again by `script.js` when a transponder was loaded; the button then reads "Install XX-12345". Chrome only offers the install again for a manifest that was swapped **after** its first offer, so the swap waits for that offer (or 3 seconds after the page has loaded). The general app (no transponder) is unchanged. All apps share the browser storage of the site, so remembered settings are shared.
- **Why the page must finish loading:** the service worker is registered, and Chrome makes its install offer, only after the `load` event. The profile picture used to keep `load` from ever firing when it could not be loaded (its error handler set `src = ""`, which failed again, over and over); it now removes the picture instead. A browser test checks that a page with a transponder finishes loading.

The installed app opens the site at its normal address, so deep links and shared replay links work in it as well. Not included: a Play Store app (a Trusted Web Activity), notifications, and offline lap data.

### The transponder field

The number is always written as `XX-12345` (two capital letters, a dash, five digits). `formatTransponderInput` in `utils.js` runs on every keystroke (`script.js`): letters become capitals, the dash is added by itself after the second letter, a typed dash is not added twice, digits before the two letters and letters after them are left out, and a sixth digit is ignored. While deleting the dash is not added back, so it can be removed. The caret stays where you are typing. When you paste text that holds a whole number (for example "Transponder: pz - 28583"), `findTransponderInText` replaces the field with `PZ-28583`; a partial number is pasted as usual and cleaned up by the same input handler.

### Deep links and phone layout

- **Deep links:** `index.html?transponder=XX-12345&activity=123` loads the transponder's activities and opens that activity's laps. `script.js` keeps the address bar in step with the chosen activity (`history.replaceState`), so the address can simply be copied; `pendingActivityId` holds the id from the link until the list has loaded. An id that is not in the list gives a message. The replay page's back link (`index.html?transponder=...&activity=...`) returns to the same activity.
- **Phone layout:** `style.css` has a `max-width: 768px` block (one column, rider details under the name) and a `pointer: coarse` block (larger buttons, checkboxes, dots, theme switch). Wide tables scroll inside their own box. The browser test checks that neither page scrolls sideways at 390 px.

### Comparing lap times and riders who were not on the ice with you

- **Compare (replay):** every rider row has a **Compare** button (not on the rider the graph follows). One rider at a time is drawn in the lap graph in a second colour at 55% opacity, at the moments he really crossed the line, so the laps of riders skating together line up. Next to the graph a line shows his current lap and the difference to your lap (`+0.31s` = he is slower). The graph's time window makes room for his laps. Comparing a hidden rider shows him first; hiding him, or following him instead, ends the comparison.
- **Left out:** riders with 0 min together (they were not on the ice at the same time as you, for example an all-day recording) are not in the replay's rider list at all. The main page's overlap list still shows them, dimmed. Riders whose time together could not be measured (no lap data) stay.

### Sharing a replay

`replay.html?transponder=XX-12345&activity=123&riders=11,12,13` holds everything needed to open the same replay on **any** computer or in a private window, where nothing is stored. When there is no stored replay for that transponder and activity, `replay.js` rebuilds it: `fetchActivities` finds the activity, then `loadOverlappingRiders` (shared with the main page, in `fetch_overlapping_sessions.js`) runs the same search and calculations as the main page, and `riders` decides who is shown (`riders=none` shows only you; without `riders` everyone who skated with you is shown). Rebuilding takes as many requests as the overlap search (most are cached by the proxy). `replay.js` keeps the address bar in step with the riders that are shown (`history.replaceState`), and the **share button** (icon, top right corner) copies that address. An unknown activity gives a message.

### GPX download for Strava

`gpx-generator.js` turns the laps of a session into a GPX file. It needs a **master track** per ice rink: one lap of the rink as a GPX file in `/tracks`, whose points are spread over every lap of the session. The rinks are listed in `MASTER_TRACKS` at the top of `gpx-generator.js` and matched by MYLAPS location id (or by name):

| File | Rink | MYLAPS location ids |
|---|---|---|
| `tracks/1_jaapeden_amsterdam_master_track.gpx` | Jaap Eden ijsbaan, Amsterdam | 2040 |
| `tracks/2_westfries_hoorn_master_track.gpx` | Kunstijsbaan de Westfries, Hoorn | 205, 3689 |
| `tracks/3_breda_master_track.gpx` | Kunstijsbaan Breda | 3111 |
| `tracks/4_ireenwustijsbaan_tilburg_master_track.gpx` | Ireen Wüst IJsbaan, Tilburg | 2838 |
| `tracks/5_kennemerland_haarlem_master_track.gpx` | Kennemerland IJsbaan, Haarlem | 2822 |

For a rink without a track file the download button is not shown. To add a rink: record one lap (about 400 m, starting and ending at the finish line) as a GPX file, put it in `/tracks` and add a line to `MASTER_TRACKS`.

### Race replay (`replay.html`)

Shows the riders of overlapping sessions on an oblong 400 m track. It is opened from the main page: fetch an activity, press **Find Overlapping Sessions**, tick the riders and press **Open replay**.

-   `fetch_overlapping_sessions.js` stores the riders (no lap data) in `localStorage` under `replayData` (a shortcut on the same computer) and opens `replay.html?transponder=<chip>&activity=<id>&riders=<activity ids>`.
-   `replay.js` fetches the laps of every rider that is switched on. Riders can be added or removed on the replay page, one by one or with **Show all** / **Hide all**; laps are fetched 5 at a time. The reference rider and the first 9 riders shown get a coloured dot with initials (10 validated colours); every further rider is a small blue dot. Click the dot in front of a rider in the list to give that rider a colour (also when they are far down the list or hidden), or to turn it back into a small dot; when all 10 colours are taken, the rider picked longest ago gives its colour up.
-   Each overlapping rider gets a **skated together** time: the time both riders were skating at the same moment, computed from the real laps (`onIceOverlapMs`). Laps slower than 8 km/h count as breaks and are ignored, so riders who only share the same all-day session window show 0 min.
-   Each overlapping rider also gets an **in your group** time (`groupMembership`, worked out from everyone's finish crossings, see `finishCrossings`): riders who cross the finish line within 1 second of you, and then each next rider who crosses within 1 second of the one before (forwards and backwards), as far as a quarter of your lap time before and after you (about 100 m). Each such crossing counts as one of your laps for that rider. Only skating laps count, and the grouping looks at all riders together, so it runs after every rider's laps are fetched. Riders are sorted by in your group (longest first, in the whole minutes shown on the cards); riders with the same group minutes, in particular everyone at 0 min, go by skated together (whole minutes); exact times only break the remaining ties (`compareOverlappingRiders`). It only uses lap data that is already fetched, so it costs no extra API calls. The constants are `GROUP_GAP_MS` (1 s) and `GROUP_WINDOW_SHARE` (0.25) in `replay-model.js`.
-   `replay-model.js` turns laps into positions: a lap starts when the rider crosses the finish line, and the position inside a lap is interpolated evenly over the lap time. `replay-track.js` holds the track geometry.

### Live page (`live.html`)

Shows who is on the ice at a rink now (default IJsbaan Twente, 456). Not linked from the menu yet; open it by address (`live.html?rink=456&poll=5`, poll 1-60 s).

-   `api.js`: `fetchLiveActivities` and `fetchLiveLaps` add `?live=1`; the Worker then caches laps and location lists for 1 second (`LIVE_SECONDS`), otherwise 60 s / 5 min. A private rider answers 401, shown under "Results are private".
-   `live-model.js` (pure, unit tested): `liveCandidates` keeps activities that ended less than 15 minutes ago (`LIVE_WINDOW_MS`); `riderLive` gives the status: **skating** (last crossing less than 2 minutes ago, `LIVE_ACTIVE_MS`), **waiting** (no lap yet, under 2 minutes after the start), **resting** ("Recently on the ice"), **left** (15 minutes or more without a crossing: not listed). It also gives the start time and duration of the activity (up to now while skating, otherwise up to the last crossing).
-   `lapsFetchDue` decides per rider when to fetch laps again: a second after the next crossing is expected (the shorter of the last lap and the recent average), then with growing pauses (1.5-8 s), a safety refresh every 30 s, resting riders every 20 s. Measured at Twente: a lap is in the API 2-3.6 s after it ended, while the `endTime` of the rink list lags about 6 s, so it is not used as a trigger.
-   The position of a dot is an estimate: share of the usual lap time since the last crossing.
-   `live-graph.js`: lap-time graph of the selected rider (like the replay graph), with a max-lap-time slider; slower laps and breaks are greyed out at the top.

### Data Flow

1.  A user enters a transponder number and clicks "Fetch Activities".
2.  `script.js` calls the `fetchActivities` function in `api.js`.
3.  `api.js` makes a request to the proxy's `/userid/:transponder` endpoint to get the `userId`.
4.  `api.js` then makes parallel requests to the `/activities/:userId` and `/account/:userId` endpoints.
5.  When the data is returned, `script.js` calls `displayProfileInfo` to show the user's name and avatar, and populates the activities dropdown.

## Testing

Automated tests live in `tests/` (unit tests, a headless-browser end-to-end test on fake data) and `cloudflare-worker/test/`
(proxy tests). Run `npm test`, `npm run test:worker` and `npm run test:e2e` from the repository root; Node.js 22 or newer,
no install needed. `tests/README.md` explains how to run them, what output to expect and how to tell a real failure
from an environment problem.

