# Live Telemetry Synchronization

This document describes how the dashboard displays live, automatically synchronized telemetry data using vanilla JavaScript polling against the `/api/jp-stats` endpoint.

## Architecture Overview

The live telemetry system consists of three layers:

1. **Data Store**: DynamoDB table `jaytipargal_telemetry` stores site analytics events (pageviews, heartbeats, clicks)
2. **Backend API**: `Backend/jp-stats.js` — a Vercel serverless function that queries DynamoDB and returns aggregated JSON
3. **Frontend**: `Frontend/index.html` — vanilla ES5 JavaScript that polls the API every 10 seconds and updates the DOM

No build step, no framework, no bundler. The frontend is hand-written HTML with inline JavaScript.

## Backend: `/api/jp-stats`

The endpoint is defined in `Backend/jp-stats.js` and mapped via `vercel.json`.

### Authentication

All requests must include the `STATS_KEY` header:

```
Authorization: Bearer <STATS_KEY>
```

Unauthenticated requests receive a 401 response. Missing credentials return 503.

### Query Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `days` | 7 | Time window (1–90 days) |
| `site` | `jaytipargal.com` | Property to report on; use `all` for every property |

### Response Shape

```json
{
  "success": true,
  "source": "dynamodb",
  "window_days": 7,
  "site": "jaytipargal.com",
  "generated_at": "2026-09-20T12:34:56.789Z",
  "totals": {
    "events_in_window": 1234,
    "unique_ips": 89,
    "unique_sessions": 156,
    "page_views": 987,
    "heartbeats": 247,
    "active_now": 3,
    "avg_time_on_page": 142,
    "peak_hour": { "hour": "2026-09-20T10", "count": 67 }
  },
  "active_sessions": [ ... ],
  "daily": [ ["2026-09-14", 123], ... ],
  "hourly": [ ["2026-09-20T10", 67], ... ],
  "latest_heartbeats": [ ... ],
  "latest_events": [ ... ],
  "top": {
    "countries": [ ["United States", 45], ... ],
    "cities": [ ["New York", 23], ... ],
    "referrers": [ ["github.com", 12], ... ],
    "browsers": [ ["Chrome", 67], ... ],
    "os": [ ["Windows", 45], ... ],
    "devices": [ ["desktop", 78], ... ]
  },
  "sessions": [ ... ]
}
```

The `generated_at` field is the server's response timestamp, **not** the device sync time. For genuine device freshness, see Firestore `lastSeen` fields.

### Caching

Responses are cached in-memory for 5 seconds (`CACHE_TTL = 5000`). The cache key includes both `days` and `site` parameters, so different queries don't collide.

## Frontend: Polling Loop

The dashboard polls `/api/jp-stats` automatically using `setInterval`.

### Configuration

```javascript
var REFRESH_MS = 10000;  // Poll every 10 seconds
```

Defined at `Frontend/index.html:734`.

### Polling Logic

```javascript
function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
        if (!livePaused && !document.hidden) {
            load();  // Fetches /api/jp-stats and updates the DOM
            if ($('page-device') && $('page-device').classList.contains('active')) {
                loadDeviceHistory();
                loadLiveDevices();
            }
        }
    }, REFRESH_MS);
}
```

Defined at `Frontend/index.html:1903`.

### Key Behaviors

- **Pauses when tab is hidden**: `!document.hidden` prevents background tabs from hammering the API
- **Manual pause**: The `livePaused` flag lets users freeze the feed (e.g., while inspecting data)
- **Auth gate**: The `KEY` variable holds the `STATS_KEY`; the gate UI prompts for it on first load
- **Firestore polling**: A separate 10-second interval (`startFirestorePolling()`) refreshes device command queues from Firestore

### Live Indicator

The top bar shows a green pulsing dot (`.live-dot`) when polling is active:

```html
<div class="live-pill">
    <span class="live-dot"></span>
    <span>LIVE</span>
</div>
```

When polling pauses or the tab is hidden, the dot turns gray (`.live-dot.off`).

## Data Flow

```
Website visitor ──▶ /api/jp-track ──▶ DynamoDB (jaytipargal_telemetry)
                                              │
                                              ▼
Dashboard (setInterval 10s) ──▶ /api/jp-stats ──▶ Aggregated JSON ──▶ DOM update
```

The tracker (`Backend/jp-track.js`) writes events to DynamoDB. The stats endpoint reads and aggregates them. The dashboard polls and renders.

## Why Not WebSockets?

This project uses Vercel serverless functions, which are stateless and ephemeral. WebSockets require persistent connections and a long-running server — neither of which Vercel provides. Polling every 10 seconds is the correct pattern here:

- **Simple**: No connection management, no reconnection logic
- **Stateless**: Works with Vercel's serverless model
- **Sufficient**: 10-second granularity is fine for analytics dashboards
- **Cheap**: One HTTP request per tab per 10 seconds; DynamoDB reads are fast

If real-time push becomes necessary, the architecture would need to move to a persistent runtime (the `jp-agent` droplet) or a third-party service (Pusher, Ably). That's a separate project.

## Verification

To confirm live polling is working:

1. Open the dashboard (`https://jaytipargal.tech/index.html`)
2. Enter the `STATS_KEY` when prompted
3. Open browser DevTools → Network tab
4. Filter by `jp-stats`
5. Observe a new request every 10 seconds
6. Trigger a test event on the website (visit a page, click something)
7. Within 10 seconds, the dashboard should reflect the new event

## Related Files

| File | Purpose |
|------|---------|
| `Backend/jp-stats.js` | Serverless function that queries DynamoDB |
| `Backend/jp-track.js` | Serverless function that writes events to DynamoDB |
| `Frontend/index.html` | Dashboard with polling loop (line 734: `REFRESH_MS`, line 1872: `load()`, line 1903: `startAutoRefresh()`) |
| `vercel.json` | Maps `/api/jp-stats` to `Backend/jp-stats.js` |
| `Integrations/postgres.js` | Postgres client (used by other endpoints, not jp-stats) |

## See Also

- `QWEN.md` — project architecture overview
- `Backend/_auth.js` — authentication logic (`requireKey`, `checkKey`)
- `Devices/sandbox/dashboard_api.py` — Python dashboard for the sandbox device (separate system)
