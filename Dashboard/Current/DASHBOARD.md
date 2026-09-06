# Dashboard — Current

Live telemetry and device dashboard deployed to `jaytipargal.tech` via Vercel.

## Structure

```
Current/
├── frontend/     Existing dashboard UI, visitor tracker, historical device copies
├── api/          Vercel serverless functions
├── lib/          Shared backend utilities
├── others/       build-frontend.mjs and test/
├── dist/         Generated static deployment output (ignored by Git)
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

The three source sections remain separate. `npm run build` assembles them into
`Current/dist/` without editing any source files:

| Source | Generated file | Public path |
|---|---|---|
| `Current/frontend/index.html` | `dist/index.html` | `/` |
| `Current/frontend/jp-tracker.js` | `dist/jp-tracker.js` | `/jp-tracker.js` |
| `S24/frontend/index.html` | `dist/s24.html` | `/s24` |
| `Vivobook/frontend/index.html` | `dist/vivobook.html` | `/vivobook` |

Edit device pages in their own `S24/frontend/` and `Vivobook/frontend/` folders.
The historical `Current/frontend/s24.html` and `vivobook.html` copies are retained
but excluded from the build. A missing source page fails the build; it never
falls back to a historical copy.

Other frontend assets keep their relative paths at the site root. Use distinct
paths such as `S24/frontend/s24/status.css` (served at `/s24/status.css`) and
`Vivobook/frontend/vivobook/status.css` to avoid collisions. Different files
targeting the same output path fail the build. Hidden files and `node_modules`
are excluded. The output directory is rebuilt so removed assets disappear.

The existing `api/`, `lib/`, rewrites, headers, cron jobs, and clean URLs remain
in place. Only the generated static files go into `dist/`.

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

Vercel project: `jayti-dashboard`. Keep Root Directory set to
`Dashboard/Current`, Framework Preset to Other, and **Include source files
outside of the Root Directory in the Build Step** enabled so the build can
read both sibling frontend folders. See the [Vercel monorepo FAQ](https://vercel.com/docs/monorepos/monorepo-faq#can-i-share-source-files-between-projects-are-shared-packages-supported).

`vercel.json` sets Build Command to `npm run build` and Output Directory to
`dist`. These values override the Dashboard fields for deployments of this
configuration. If setting the Dashboard fields explicitly, use those same values.
The root directory stays `Dashboard/Current`; no repository-root project is needed.

Verify locally:

```powershell
cd Dashboard/Current
npm ci
npm run test:frontend
npm run build
```

Production deploys through the repository's existing Vercel Git integration.
Include the build script, configuration, and sibling frontend sources in the
same repository revision. Uploading only `Current/` omits the two required
device sections and will fail the build.

## Tests

```powershell
cd Dashboard/Current
npm run test:frontend
node others/test/stale.test.mjs
node others/test/broker.test.mjs
node others/test/connect.test.mjs
```
