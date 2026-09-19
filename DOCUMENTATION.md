# MYLAPS Activity Viewer Documentation

This document provides an overview of the project structure, focusing on the Google Cloud Function proxy server and its interaction with the frontend application.

## Project Overview

The MYLAPS Activity Viewer is a web application that fetches and displays training activity data from the MYLAPS Speedhive platform. It consists of a static frontend (HTML, CSS, JavaScript) and a serverless proxy backend running on Google Cloud Functions.

## Proxy Server (Cloudflare Worker)

The proxy server is essential for this application to work. The MYLAPS Speedhive API does not allow direct requests from a web browser (CORS restrictions, and it expects an `Origin`/`Referer` header that a browser cannot set). The proxy acts as a middleman: it receives requests from the frontend, forwards them to the MYLAPS API with the correct headers, and relays the answer back. It also **caches** answers, so repeated requests never reach MYLAPS.

### Key Details

-   **Location:** the code is in the `/cloudflare-worker` directory (`src/index.js`, `wrangler.toml`). A step-by-step setup guide is in `cloudflare-worker/README.md`.
-   **Public URL:** `https://mylaps-proxy.iceskater.workers.dev` (used as `PROXY_BASE_URL` in `api.js`, with `/api/mylaps` appended).
-   **Account:** Cloudflare free plan (100,000 requests per day, no credit card), account `contact.alexander.evers@gmail.com`.
-   **Who may use it:** only `https://alexanderevers.github.io`, local test servers and pages opened from a file (`ALLOWED_ORIGINS` in `wrangler.toml`). Other websites get a 403.
-   **Previous proxy:** a Google Cloud Function (`mylapsProxyFunction`, code in `/proxyserver`). It is replaced by the Worker and can be deleted once the Worker has run without problems: `gcloud functions delete mylapsProxyFunction --gen2 --region us-central1`.

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
| Laps of a finished activity (the site adds `?finished=1`) | 30 days |
| Laps of an activity that may still be recording | 1 minute |
| Transponder to account, account profile, avatar | 1 day |
| A rider's activity list, chip activity list | 2 minutes |
| Activity list of a location | 5 minutes |
| Name search | 10 minutes |

Error answers are never cached. Browsers keep answers for at most one day (`Cache-Control`).

### Endpoints

The proxy exposes several endpoints that map to the underlying MYLAPS API:

-   `/api/mylaps/userid/:transponder`: Fetches the `userId` for a given transponder number.
-   `/api/mylaps/activities/:userId`: Fetches a list of activities for a user. Supports optional `count` (default 100) and `order` query parameters.
-   `/api/mylaps/search?term=...`: Searches active profiles by name. Supports `count` and `offset`.
-   `/api/mylaps/laps/:activityId`: Fetches lap data for a specific activity. Add `?finished=1` for an activity that ended a while ago so the laps are cached for a long time.
-   `/api/mylaps/account/:userId`: Fetches a user's profile information (name, etc.).
-   `/api/mylaps/avatar/:userId`: Fetches a user's profile image.
-   `/api/mylaps/locations/:locationId`: Fetches a list of activities for a location (`year`, `sport`, `count`, `offset`). A page holds at most 200 activities and the list is sorted by end time, newest first.
-   `/api/mylaps/chips/:chipCode`: Fetches a list of activities for a specific chip.

## Frontend Application

The frontend is a single-page application that handles user input, makes requests to the proxy server, and visualizes the data.

### Key Files

-   **`index.html`**: The main HTML file containing the structure of the page.
-   **`script.js`**: The core JavaScript file that contains the application logic for fetching data, handling user interactions, and updating the UI.
-   **`api.js`**: This file contains the functions responsible for making `fetch` requests to the proxy server. The `PROXY_BASE_URL` constant in this file must point to your deployed Google Cloud Function URL.
-   **`style.css`**: Contains all the styles for the application.

### GPX download for Strava

`gpx-generator.js` turns the laps of a session into a GPX file. It needs a **master track** per ice rink: one lap of the rink as a GPX file in `/tracks`, whose points are spread over every lap of the session. The rinks are listed in `MASTER_TRACKS` at the top of `gpx-generator.js` and matched by MYLAPS location id (or by name):

| File | Rink | MYLAPS location ids |
|---|---|---|
| `tracks/1_jaapeden_amsterdam_master_track.gpx` | Jaap Eden ijsbaan, Amsterdam | 2040 |
| `tracks/2_westfries_hoorn_master_track.gpx` | Kunstijsbaan de Westfries, Hoorn | 205, 3689 |
| `tracks/3_breda_master_track.gpx` | Kunstijsbaan Breda | 3111 |
| `tracks/4_ireenwustijsbaan_tilburg_master_track.gpx` | Ireen Wüst IJsbaan, Tilburg | 2838 |

For a rink without a track file the download button is not shown. To add a rink: record one lap (about 400 m, starting and ending at the finish line) as a GPX file, put it in `/tracks` and add a line to `MASTER_TRACKS`.

### Race replay (`replay.html`)

Shows the riders of overlapping sessions on an oblong 400 m track. It is opened from the main page: fetch an activity, press **Find Overlapping Sessions**, tick the riders and press **Open replay**.

-   `fetch_overlapping_sessions.js` stores the riders (no lap data) in `localStorage` under `replayData` and opens `replay.html?activity=<id>`.
-   `replay.js` fetches the laps of every rider that is switched on. Riders can be added or removed on the replay page, one by one or with **Show all** / **Hide all**; laps are fetched 5 at a time. The reference rider and the first 9 riders shown get a coloured dot with initials (10 validated colours); every further rider is a small blue dot. Click the dot in front of a rider in the list to give that rider a colour (also when they are far down the list or hidden), or to turn it back into a small dot; when all 10 colours are taken, the rider picked longest ago gives its colour up.
-   Each overlapping rider gets a **skated together** time: the time both riders were skating at the same moment, computed from the real laps (`onIceOverlapMs`). Laps slower than 8 km/h count as breaks and are ignored, so riders who only share the same all-day session window show 0 min.
-   Each overlapping rider also gets an **in your group** estimate (`groupTimeMs`): the time both were within 50 m of each other on the track while skating, corrected for the ~25% of the time unrelated skaters are that close by chance (so riders who only share the ice show about 0). Riders are sorted by skated together (in whole minutes), then by in your group. Both use only lap data that is already fetched, so they cost no extra API calls.
-   `replay-model.js` turns laps into positions: a lap starts when the rider crosses the finish line, and the position inside a lap is interpolated evenly over the lap time. `replay-track.js` holds the track geometry.

### Data Flow

1.  A user enters a transponder number and clicks "Fetch Activities".
2.  `script.js` calls the `fetchActivities` function in `api.js`.
3.  `api.js` makes a request to the proxy's `/userid/:transponder` endpoint to get the `userId`.
4.  `api.js` then makes parallel requests to the `/activities/:userId` and `/account/:userId` endpoints.
5.  When the data is returned, `script.js` calls `displayProfileInfo` to show the user's name and avatar, and populates the activities dropdown.