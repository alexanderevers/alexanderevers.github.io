# MYLAPS proxy on Cloudflare Workers

A small Cloudflare Worker that is the proxy of the website (it replaced an earlier Google Cloud Function): it forwards the
website's requests to the MYLAPS Speedhive API (which does not allow requests straight from a browser) and
adds the CORS headers. It also **caches** answers, so repeated requests never reach MYLAPS.

Cloudflare's free plan allows 100,000 requests per day and needs no credit card.

## Set it up, step by step

### 1. Create a free Cloudflare account (once)
1. Go to <https://dash.cloudflare.com/sign-up>, fill in your email and a password.
2. Click the verification link that Cloudflare emails you.
3. If it asks you to add a website or pick a plan, skip that; you do not need a domain.

### 2. Choose your `workers.dev` name (once)
1. In the dashboard, open **Workers & Pages** in the left menu.
2. If it asks for a subdomain, pick a name, for example `alexanderevers`. This becomes part of the address:
   `https://mylaps-proxy.<your-name>.workers.dev`

### 3. Log in from the terminal (once)
```bash
cd cloudflare-worker
npm install
npx wrangler login
```
A browser window opens. Click **Allow**. Then check which account you are connected to:
```bash
npx wrangler whoami
```

### 4. Deploy
```bash
npx wrangler deploy
```
The last line prints the address of your Worker. Open `<address>/` in a browser: it should say
"MYLAPS proxy is running."

### 5. Check that it works and that caching works
```bash
curl -i "https://mylaps-proxy.<your-name>.workers.dev/api/mylaps/userid/PZ-28583"
```
Run it twice. The header `X-Upstream-Cache` says `MISS` on the first request and `HIT` on the next ones:
the second answer came from Cloudflare's cache and MYLAPS was not asked again.

### 6. Point the website at it
In `../api.js`, change `PROXY_BASE_URL` to
`https://mylaps-proxy.<your-name>.workers.dev/api/mylaps`, then push to GitHub Pages.

### 7. The old Google proxy is gone
The earlier Google Cloud Function proxy stopped responding (HTTP 503) and its code has been removed from the
repository. If the Google Cloud project `proxyapi-475018` still exists, open its **Cloud Run** and **Cloud Functions**
pages once to make sure nothing is left running or billing.

## What gets cached, and for how long

| Data | Cloudflare keeps it | Why |
|---|---|---|
| Laps of a **finished** activity (the site adds `?finished=1`) | 30 days | Laps of a finished session never change |
| Laps of an activity that may still be recording | 1 minute | They can still change |
| Transponder to account, account profile, avatar | 1 day | Almost never changes |
| A rider's activity list, chip activity list | 2 minutes | New sessions show up here |
| Activity list of a location (overlapping sessions) | 5 minutes | Grows all day |
| Name search | 10 minutes | |

Error answers are never cached. The visitor's browser also keeps answers (at most one day).

## Good to know
- **Which websites may use it:** only `https://alexanderevers.github.io`, local test servers and pages opened
  from a file. Change the list in `wrangler.toml` (`ALLOWED_ORIGINS`) and deploy again.
- **Tests:** `npm test` runs the checks in `test/handler.test.mjs` against a fake MYLAPS. `npx wrangler dev` runs the Worker on your own
  computer (`http://127.0.0.1:8787`) without any login.
- **Logs:** `npx wrangler tail` shows live requests and errors.
- **Limits:** the free plan allows 100,000 requests a day. Showing the overlapping riders of a busy session
  takes a few hundred requests, so there is plenty of room, and cached answers make it less.
