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
- **Navigation:** `dashboards.js` builds the numbered marks on the right from the dashboards that are on screen. A dashboard that is hidden with the `hidden` class (for example the session dashboards before laps are loaded) is left out; a MutationObserver keeps the marks up to date. `Dashboards.goTo(id)` scrolls to one; `script.js` calls it after Fetch Laps (Session) and the overlap search (Together). The active mark's text label (e.g. "04 Records") only opens up while the page is actually scrolling or snapping between dashboards (`.dash-nav.is-scrolling`, toggled by a `scroll` listener with a short idle timeout) or on hover/keyboard focus; once scrolling settles it slides shut again, so it does not sit on top of the dashboard's own content while reading — only the small coloured mark next to it stays visible.
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

### Personal records (`history-store.js`, `records.js`, `records-ui.js`)

The "Records" dashboard on the main page remembers every **finished** session (`isFinishedActivity` in `api.js`: started on an earlier day and ended a while ago) in the browser's own storage (`localStorage`, one key for the whole device, `mylaps.history`), and computes personal bests across all of it. Nothing is sent anywhere; it survives until the visitor clears that browser's site data.

-   **One owner at a time.** The device remembers one transponder's history, not one per transponder ever looked up: the first transponder that is ever remembered (`rememberSession`) becomes the "owner" (`historyOwner`). Looking up a *different* transponder does not show that history and does not touch it: the dashboard shows a "This browser already remembers the history of transponder …" message instead, with a **Change my transponder** button; pressing it, after a confirmation naming the other transponder and how much is stored, calls `changeOwner` — this forgets everything and makes the new transponder the owner, starting from nothing. This keeps a shared or public computer from silently piling up other people's session history, and there is no separate "clear history" button: switching transponders is the only way to start over.
-   `history-store.js` (pure): `rememberSession` stores one activity's normalized laps the first time it is fetched, only for the current owner (it is never overwritten, so an exclusion is not lost by opening the same session again); `setSessionExcluded`/`setLapExcluded` leave a whole session or a single lap out of every calculation without deleting it (for a session that was not really the visitor, or a lap the timing got wrong), `deleteSession` forgets one session outright, `changeOwner` forgets everything and starts over for a new transponder. `historySessions` lists what is stored, newest first (empty for a transponder that is not the owner).
-   `records.js` (pure): `computePersonalRecords(sessions)` folds the stored (non-excluded) sessions into the fastest lap ever (with where and when), the fastest lap per **ice-skating season** (`perSeason`), a timeline of the best lap of every session (for the "getting faster?" chart), and `fastLapsPerSeason`: for every season, its own **fastest 20 %** of that season's laps (at least one), how many that is, and their average time — a slow season is judged against itself, not against a fast season. A season is not the calendar year: `seasonOf(dateMs)` runs it from **September through April**, spanning the turn of the year, so it is named after both years it touches (a lap skated in March 2026 and one skated in November 2025 are both season `"25/26"`); May through August is the off-season and adds no per-season row (its laps still count towards the totals and the fastest lap ever, just not towards any one season). Only real skating laps count (the same speed rule as `isSkatingLapMs` in `live-model.js`, `MIN_SKATING_KPH` from `replay-model.js`).
-   `records-ui.js` wires the dashboard: it is shown as soon as a transponder's activities are known (even before fetching any laps, showing what was already remembered on an earlier visit), and updated every time a session's laps are fetched. A **Load full history** button walks every finished activity of the transponder that is not yet stored and fetches its laps (`mapInBatches`-style, 5 at a time), so the whole history does not have to be opened one session at a time. The dashboard uses the page's full width (`#dashRecords .dash-inner`, dashboards.css) for a two-column layout: the left column stacks the "Best lap over time" line chart above the **"Fast laps per season"** bar-and-line chart (`fastCount` as bars, `avgFastMs` on a right-hand axis), both built with Chart.js's default category axis (season labels), not its `'time'` scale, since no date-adapter plugin is loaded here; the right column holds the "Best lap per season" table. Clicking a dot on the line chart, or a row of the per-season table, opens the "Stored sessions" list (if it was closed) and scrolls to and briefly highlights that session; each stored session also has its own **Fetch laps** button that opens it on the Session dashboard directly, without hunting for it in the activity dropdown first. The sessions table sits under a closed "Stored sessions" dropdown (a `<details>`, with the count of stored sessions in its summary), so a long history does not push the summary tiles and the charts off screen; opening it lets a session be excluded or deleted, and "Edit laps" expands a small grid of lap numbers to exclude a single lap.

### Race replay (`replay.html`)

Shows the riders of overlapping sessions on an oblong 400 m track. It is opened from the main page: fetch an activity, press **Find Overlapping Sessions**, tick the riders and press **Open replay**.

-   `fetch_overlapping_sessions.js` stores the riders (no lap data) in `localStorage` under `replayData` (a shortcut on the same computer) and opens `replay.html?transponder=<chip>&activity=<id>&riders=<activity ids>`.
-   `replay.js` fetches the laps of every rider that is switched on. Riders can be added or removed on the replay page, one by one or with **Show all** / **Hide all**; laps are fetched 5 at a time. The reference rider and the first 9 riders shown get a coloured dot with initials (10 validated colours); every further rider is a small blue dot. Click the dot in front of a rider in the list to give that rider a colour (also when they are far down the list or hidden), or to turn it back into a small dot; when all 10 colours are taken, the rider picked longest ago gives its colour up.
-   Each overlapping rider gets a **skated together** time: the time both riders were skating at the same moment, computed from the real laps (`onIceOverlapMs`). Laps slower than 8 km/h count as breaks and are ignored, so riders who only share the same all-day session window show 0 min.
-   Each overlapping rider also gets an **in your group** time (`groupMembership`, worked out from everyone's finish crossings, see `finishCrossings`): riders who cross the finish line within 1 second of you, and then each next rider who crosses within 1 second of the one before (forwards and backwards), as far as a quarter of your lap time before and after you (about 100 m). Each such crossing counts as one of your laps for that rider. Only skating laps count, and the grouping looks at all riders together, so it runs after every rider's laps are fetched. Riders are sorted by in your group (longest first, in the whole minutes shown on the cards); riders with the same group minutes, in particular everyone at 0 min, go by skated together (whole minutes); exact times only break the remaining ties (`compareOverlappingRiders`). It only uses lap data that is already fetched, so it costs no extra API calls. The constants are `GROUP_GAP_MS` (1 s) and `GROUP_WINDOW_SHARE` (0.25) in `replay-model.js`.
-   `replay-model.js` turns laps into positions: a lap starts when the rider crosses the finish line, and the position inside a lap is interpolated evenly over the lap time. `replay-track.js` holds the track geometry.

### Live page (`live.html`)

Shows who is on the ice at a rink now (default IJsbaan Twente, 456). Opened with the "Live" button in the menu of the main page, or by address (`live.html?rink=456&poll=5`, poll 1-60 s).

-   `api.js`: `fetchLiveActivities` and `fetchLiveLaps` add `?live=1`; the Worker then caches laps and location lists for 1 second (`LIVE_SECONDS`), otherwise 60 s / 5 min. A private rider answers 401, shown under "Results are private".
-   `live-model.js` (pure, unit tested): `liveCandidates` keeps activities that ended less than 15 minutes ago (`LIVE_WINDOW_MS`); `riderLive` gives the status: **skating** (last crossing less than 2 minutes ago, `LIVE_ACTIVE_MS`), **waiting** (no lap yet, under 2 minutes after the start), **resting** ("Recently on the ice"), **left** (15 minutes or more without a crossing: not listed). It also gives the start time and duration of the activity (up to now while skating, otherwise up to the last crossing).
-   `lapsFetchDue` decides per rider when to fetch laps again: a second after the next crossing is expected (the shorter of the last lap and the recent average), then with growing pauses (1.5-8 s), a safety refresh every 30 s, resting riders every 20 s. Measured at Twente: a lap is in the API 2-3.6 s after it ended, while the `endTime` of the rink list lags about 6 s, so it is not used as a trigger.
-   **Colours and the top of the list (live page)**: every rider is a small blue dot until his name is pressed (in the list or on the track). Then he gets a colour and initials: up to ten riders; pressing an eleventh takes the colour of the one who was pressed first. A rider who is compared (second press) also gets a colour, and one who is pressed again while compared becomes the only selection and keeps it. Letting go of the selected rider takes his colour. The rider pressed last stays on top of the list in a group "Selected"; the others are sorted below him (fastest lap or latest crossing). (On the marathon page the first ten of the newest list have the colours, and the rider pressed last is on top as well, with his place, while he is still in the list below.) The menu of the live page has "Marathon" and the menu of the marathon page has "Live" (the main page has both).
-   **The place in the graph** (marathon page): the lap graph of the selected rider also has his place in the list of every lap, as a dashed line with small squares on an axis of its own on the right (place 1 at the top; `placesOf` of the standings). The tooltip of a lap shows the place as well.
-   **Names**: everywhere a rider is shown, the real name (given name and surname of his account, `accountFullName` in `utils.js`) comes first and the transponder name is only shown where there is room, small and not bold: on the cards of the overlapping sessions the name is followed by a line `transponder name, transponder number` (the same thing is not shown twice: a transponder name that is the number is left out) and then the date, and the replay list has the transponder name in its small line. Without a readable account (private or unknown profile) the transponder name is used as the name. On the live and marathon pages the name is looked up for every rider on the page (`ensureNames`: from the account of the `gaUId` of his activity, four at a time, kept for the visit; the proxy keeps accounts for a day), so the lists, the dots (initials) and the tooltips use it. The title of the lap-time graph is `NAME, XX-11111` (the transponder number after the name; on the marathon page followed by `· position N`, the place of the rider in the list). Riders whose name is not known yet show their transponder name until it arrives.
-   The position of a dot is an estimate (`liveFraction` in `live-model.js`). The laps arrive a few seconds after the crossing, so the dot never waits at the finish line. A rider who is not getting slower keeps going at the usual lap time, past the line into the next lap. A rider who was slower in his last lap than in the one before is still in the current lap: that lap is expected to take longer by the same difference, and when even that time has passed the dot slows down further and creeps towards the line without reaching it. When the real lap arrives the dot follows the real crossing. The dot that is drawn is not put where the estimate says: every rider has a shown position that only goes up (`liveShownStep`). It runs at his usual speed, a little faster or slower to close in on the estimate, so a difference (for example when the real lap arrives) is worked away during the coming lap. The speed stays between 40 % and 200 % of the usual one: the dot never stops at the line and never jumps.
-   `live-graph.js`: lap-time graph of the selected rider (like the replay graph), with a max-lap-time slider; slower laps and breaks are greyed out at the top. The first click on a rider selects; a click on another rider compares (his laps are drawn paler in the same graph, one compared rider at a time); a click on the compared rider makes it the only selection; a click on the selected rider lets go of everything (`selectRider` in `live.js`).

#### Marathon analysis from the main page

When the overlapping sessions are fetched, the page also finds out whether the activity was a marathon (`marathonDetect` in `live-model.js`, result kept on the list as `sessions.marathon`): a break of at least 2.5 minutes before the start (`MARATHON_DETECT_BREAK_MS`) and at least 15 riders (`MARATHON_DETECT_MIN_RIDERS`) whose first race crossing lies within 5 minutes of that of the selected rider (the reference rider included; the first crossing after the break that starts the main run of the rider, that is the stretch after a break in which he skated the most laps, else the first crossing of the activity; a long lap at the very end of the activity, a lap to skate out, is a break too but nothing follows it, so it is not taken for the start). Of these riders at least 30 % must have had such a break, so a busy training session is not taken for a race. And a lap later at least 75 % of them must cross the finish line as a group again (within 30 seconds of the crossing of the selected rider one lap after the start: the empty first lap): riders who only pass by, or stop after the start, do not make a race (`MARATHON_DETECT_NEXT_SHARE`, `MARATHON_DETECT_NEXT_WINDOW_MS`). If it was a marathon a **Marathon analysis** button appears next to "Open replay"; it opens `marathon.html?activity=<id>&rink=<rink>` in a new tab (`marathonAddress`), which loads that activity as a replay. On the marathon of 11/03/2026 at Jaap Eden this finds 35 riders, 19 of them after a break.

#### Marathon mode

Marathon mode is a page of its own: `marathon.html` shares the script of the live page (`live.js`) and has `data-page="marathon"` on the body, which turns marathon mode on. `live.html` has no marathon controls (the script looks them up with `$m`, so a control that is not in the page does no harm). "Marathon" is in the menu of the main page.

Marathon mode (`?laps=25` in the address sets the number of laps of the race) is for a race of a group of about 50 riders who cross the finish line more or less together. The list of riders is replaced by a list per lap (`marathonStandings` in `live-model.js`, pure and unit tested). A timing mat sometimes misses riders (in the marathon of 11/03/2026 at Jaap Eden the mat missed laps 2 to 5 of most riders: their first registered crossing was one long lap of about 200 s), which is why a long crossing counts as the laps of the group in that time.

-   **Race crossings of a rider** (`marathonCrossings`): only the laps after his last gap of more than 5 minutes (`MARATHON_GAP_MS`). Warm-up laps from before the start do not count; before the start there is always such a gap. Only crossings before `nowMs` are looked at, so the same code shows a race as it was at any moment.
-   **The start time** is an absolute time (for example 21:00:00; a time field and a slider next to it). From **20 seconds before it** all riders are selected: the lap a rider is in then (his first crossing from that moment) is his lap 1, and every next crossing is the next lap. Everything before it (the warming up, the minutes of waiting for the start, in which the mat may register nothing or one long lap) is not part of the race, and everything is measured from the start time: the time of the laps, the gaps, the interpolation of the dots. The first lap is measured from the start time. Without a choice the program picks the start of the first lap of the group in which at least half of the usual number of riders crossed (shown as "(auto)"). A rider who is **lapped** has one lap fewer than the group, and a rider who started late has fewer laps too. Only when the timing mat missed a rider during the race (one long crossing, at least 1.7 times his usual lap time, of a rider who was skating with the group) the laps are counted from the time: the laps the group did in that time (the group's laps are numbered by the first rider of every lap, `MARATHON_LAP_SHARE`).
-   **The finish lap** is the lap of the rider with the most laps (or the lap chosen with the finish slider). **Everybody who comes in during that lap counts for the result**: the list of a lap is every rider who crosses the line from the moment the first rider finishes that lap until the first rider finishes the next one, so also lapped riders (they come in with fewer laps). They are ordered by their number of laps, then by the time they crossed, and the laps column shows each rider's own number of laps. The first rider is the one who passes the finish line first. Riders who did not come in during the newest lap yet are listed below, in one of two groups (see below).
-   **The list of a lap**: the riders who crossed in that lap, in the order of crossing: place, the number of **laps**, time of day, **gap** to the first rider (seconds), **distance** to the first rider (the gap at the speed of that rider in that lap, in metres), lap time and **time** (from the real start, see below). The first rider of a lap is whoever crosses first. Riders who did not cross the newest lap yet are listed below, in "Still to cross the line" while only one lap behind (he could still cross any moment) or, once more than a lap behind, in a separate "Off the ice" group at the bottom, dimmed to 50 % opacity in both the list and his dot on the track — a rider who has really fallen out of this lap's race, not just running a bit late (`status: 'coming'`/`'lapped'` on `marathonStandings`'s `pending`, `.lapped` on the row and `ctx.globalAlpha` on the dot in `drawTrack`). A rider one lap behind keeps his "still to cross the line" status for 30 seconds after the winner crosses the finish line even once the race already counts as finished (`MARATHON_FINISH_GRACE_MS`): the race laps being reached does not by itself mean the mass finish is over, a rider a few seconds behind should not be dimmed away the instant the winner is over the line. Every new lap gives a new list.
-   **Start and finish (sliders)**: the start time (time field and slider) is described above; the finish lap slider (flag) counts the laps of the race from there and chooses the lap of the list; as long as it is on its last position it follows the race, so the list moves on to every new lap. The time column runs from the start time to the rider's crossing of the finish lap: the same start for every rider. The start time and the finish are shown as two flags in the lap graph, and the lap graph is zoomed in on them: the start at the left, the finish at the right, only the laps in between are drawn. The graph runs to the last crossing of the finish lap (the riders who come in after the first rider are in it too, so the last lap and the last place of every rider are drawn); the flag of the finish stays at the first rider. While the start slider is being moved the graph shows the whole activity, so it is easy to see where the start line goes.
-   **The last lap**: with the number of race laps filled in, later laps are ignored and the race is "finished" when the first rider has done them all. Without it (auto), laps at the end in which at least 3 riders crossed and the median lap time is at least 30 % above the usual lap time (`MARATHON_SKATE_OUT`) are laps to skate out and do not count (the last lap of a race is a fast one; the crossing after it does not count); the race is then finished. Without such a lap it is finished when nobody has crossed for 90 seconds (`MARATHON_QUIET_MS`).
-   **The settings of the marathon dots** (marathon.html only; the live page keeps its own): the estimate of the place of a dot is made from his **last lap** instead of the pace over the last three laps and **without** the rule for a rider who is slowing down (`MARATHON_ESTIMATE_OPTIONS`), and the shown dot catches up with the estimate in 5 % of a lap (instead of 40 %) within 0.2 to 3 times his speed (`MARATHON_SHOWN_OPTIONS`; it still never stops). Measured against the real lap times of the marathon of 11/03/2026 (33 riders, 343,000 moments, a lap known 3 seconds after it ended): the mean distance between the dot and the real place went from 15.5 m to 11.7 m (median 11.6 m to 7.9 m, share within 10 m 44 % to 59 %). The remaining error is mostly the variation of the lap time from lap to lap, not the delay of the API (0 s delay: 10.4 m). A pack skates evenly, which is why the settings do not fit a training with riders who slow down.
-   **Replay: the known lap time.** In a replay the whole activity is known, so the lap a rider is in has a real duration: his place on the track is the time since his last crossing as a share of that real lap (`knownFraction`), not a prediction from his pace, and the dot is put exactly there (no smoothing towards an estimate). Only when there is no such lap (before his first crossing since the start, in a break) the estimate is used. In the live mode nothing is known about the lap he is in, so it stays a prediction.
-   **The track** still shows the riders as dots with the same interpolation as in the normal mode, but a rider is only shown from his **first real crossing since the start** (`marathonTrackLaps`): the first crossing the API really gives from 20 seconds before the start time (in the first lap nobody has been dropped yet, so it is about the same time for everybody). Before it he is not on the track and nothing is guessed (so the first laps are not a mess of dots that were placed from the crossings of the warming up); the crossings before it are not looked at, and his first lap is measured from the start time. From that crossing he goes round from the finish line at his own pace and the picture follows the real crossings as usual. The first ten riders of the newest list get a colour and initials (the same colour dot is in their row).
-   Clicking a row selects the rider (lap graph and track follow). In marathon mode the laps of up to 10 riders are fetched at the same time.
-   **Replay by activity number**: fill in the activity number of a rider of a marathon (or `?activity=7522190945` in the address) and press "Replay". The lap list of that activity gives the day and the time; the rink is searched (the chosen rink first, then the other rinks until the activity is in the list of a rink on that day); everybody who skated at the same time is loaded (`fetchLaps` with the finished hint, so the laps of a day in the past come from the cache). The page then shows the rink as it was at the moment of a replay clock: it opens on the final result; play (1, 2, 5, 10, 20 or 30 times), a slider for the time, and "Back to live". **A replay starts at the chosen start time**: changing the start time sets the clock to it, the slider of the time runs from there, and Play at the end starts again from there (not at the moment the first rider started his activity). Nothing is asked for live data during a replay. What happened outside the time of the activity (other races that evening) is not part of it.
-   **Export video**: the "Export video" button in the replay bar records the track canvas while the replay plays, from the chosen start to the end, with the browser's own `canvas.captureStream(30)` + `MediaRecorder` (`.webm`, `vp9`/`vp8`/plain webm, whichever the browser supports) — nothing is uploaded anywhere. It starts the replay playing from `replay.fromMs` at the current speed, and downloads the recording as `marathon-<rink>-<day>.webm` once it stops: by pressing the button again, automatically when the replay reaches the end, or when leaving the replay ("Back to live" or starting a new one) — in every case what was recorded so far is downloaded, so stopping early still gives a usable (shorter) video. Needs a browser with `canvas.captureStream`/`MediaRecorder` (Chrome, Edge, Firefox; not reliable in Safari), and only appears in the replay bar of `marathon.html`.

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

