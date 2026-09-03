# Dashboard — Current

Live telemetry and device dashboard deployed to `jaytipargal.tech` via Vercel.

## Structure

```
Current/
├── frontend/     index.html, jp-tracker.js — dashboard UI + visitor tracker
├── backend/      api/ (18 Vercel serverless functions), lib/ (broker.js, stale.js)
├── others/       test/ (stale, broker, connect)
├── vercel.json   Vercel config (rewrites, crons, headers) — must stay at root
├── package.json  Dependencies — must stay at root
├── .env.example  Environment variable template
├── .gitignore    Ignores .vercel/, .env*
└── DASHBOARD.md  this file
```

> `vercel.json`, `package.json`, `package-lock.json`, `.gitignore`, and `.env.example`
> stay at the `Current/` root because Vercel expects them there. They are not in
> `others/` by design.

## Frontend

| File | Purpose |
|---|---|
| `index.html` | Dashboard single-page UI |
| `jp-tracker.js` | Client-side visitor analytics tracker |

## Backend

| Path | Purpose |
|---|---|
| `api/` | 18 Vercel serverless functions (stats, visitor, track, device, broker, check-stale) |
| `lib/broker.js` | Broker v2 — signature verification, Firestore codecs, hardware binding |
| `lib/stale.js` | Pure stale-detection logic (unit-testable, no I/O) |

## Others

| File | Purpose |
|---|---|
| `test/stale.test.mjs` | 8 cases — stale detection transitions |
| `test/broker.test.mjs` | 12 cases — broker v2 signature + Firestore contract |
| `test/connect.test.mjs` | 12 cases — Vercel Connect error mapping |

## Deployment

```powershell
cd Dashboard/Current
npm ci
npx vercel@latest --prod --yes
```

## Tests

```powershell
cd Dashboard/Current
node others/test/stale.test.mjs
node others/test/broker.test.mjs
node others/test/connect.test.mjs
```