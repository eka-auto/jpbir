// Vercel-sourced analytics for the dashboard.
//
// Everything else on this dashboard reads our own Firestore/Blob telemetry.
// This endpoint is the one place that reads VERCEL's own view of the same
// traffic, so the two can be compared: Vercel counts at the edge and sees
// requests our tracker never records (bots it filters, visitors with JS off,
// beacons that failed to send).
//
// Each panel is fetched and reported independently. One failing surface -
// most likely Web Analytics, which is only enabled per-project - must not
// blank the whole section, so failures are returned per panel rather than
// thrown.
//
// Requires VERCEL_API_TOKEN (a Vercel account/team token, read scope is
// enough). Without it the endpoint returns configured:false and the UI shows
// setup instructions instead of an error.
import { requireKey } from './_auth.js';

const API = 'https://api.vercel.com';

const cfg = () => ({
  token: process.env.VERCEL_API_TOKEN || '',
  teamId: process.env.VERCEL_TEAM_ID || 'jayti',
  projectId: process.env.VERCEL_ANALYTICS_PROJECT_ID || process.env.VERCEL_PROJECT_ID || '',
});

async function vfetch(path, { token, teamId }) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${API}${path}${sep}teamId=${encodeURIComponent(teamId)}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await r.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (e) {
    body = { raw: text.slice(0, 400) };
  }
  if (!r.ok) {
    const err = new Error(
      (body && body.error && body.error.message) || `HTTP ${r.status}`
    );
    err.status = r.status;
    err.path = path;
    throw err;
  }
  return body;
}

// Runs each panel independently so one failure is contained to its own card.
async function settle(name, fn) {
  try {
    return [name, { ok: true, data: await fn() }];
  } catch (e) {
    return [name, { ok: false, error: e.message, status: e.status || null, path: e.path || null }];
  }
}

// Web Analytics lives under /v1/query/web-analytics/, documented at
// vercel.com/docs/analytics/web-analytics-api. Three earlier guesses
// (/v1/web-analytics/overview, /v1/web/insights/overview, /web-analytics/
// overview) all 404'd — there is no "overview" route; totals come from
// visits/count and breakdowns from visits/aggregate.
async function webAnalytics(c, since, until) {
  const base = `projectId=${encodeURIComponent(c.projectId)}&since=${since}&until=${until}`;
  const totals = await vfetch(`/v1/query/web-analytics/visits/count?${base}`, c);

  // The breakdowns are what make this more than a two-number panel. Each is
  // fetched independently: an unsupported dimension returns 400, and one bad
  // dimension must not take the working ones down with it.
  // Names come from the API's own 400: "should be equal to one of the allowed
  // values hour, day, week, month, year, country, deviceType, environment,
  // requestPath, referrerHostname, osName, browserName, route, utmSource,
  // utmMedium, utmCampaign, utmContent, utmTerm, flags". `browser`, `os` and
  // `referrer` were guesses and all three 400'd.
  const DIMENSIONS = ['requestPath', 'route', 'country', 'deviceType',
                      'referrerHostname', 'browserName', 'osName', 'utmSource'];
  const breakdowns = {};
  await Promise.all(DIMENSIONS.map(async (by) => {
    try {
      const r = await vfetch(`/v1/query/web-analytics/visits/aggregate?${base}&by=${by}&limit=10`, c);
      breakdowns[by] = r.data || [];
    } catch (e) {
      breakdowns[by] = { error: `${e.status || '?'} ${e.message}` };
    }
  }));

  return { endpoint: '/v1/query/web-analytics/visits/count', data: totals, breakdowns };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Traffic figures plus this project's own Vercel identifiers, so it is
  // gated before the config is even read.
  if (!requireKey(req, res)) return;

  const c = cfg();

  if (!c.token) {
    return res.status(200).json({
      configured: false,
      reason: 'VERCEL_API_TOKEN is not set on this project.',
      howTo: [
        'Create a token at vercel.com/account/settings/tokens (read scope, scoped to the jayti team).',
        'vercel env add VERCEL_API_TOKEN production',
        'Optionally set VERCEL_ANALYTICS_PROJECT_ID to the project you want reported.',
      ],
    });
  }

  const days = Math.min(90, Math.max(1, parseInt(req.query?.days, 10) || 14));
  const untilMs = Date.now();
  const sinceMs = untilMs - days * 86400000;

  const projectId = c.projectId;
  const panels = Object.fromEntries(
    await Promise.all([
      settle('project', () =>
        projectId
          ? vfetch(`/v9/projects/${encodeURIComponent(projectId)}`, c)
          : Promise.reject(Object.assign(new Error('no project id configured'), { status: 400 }))
      ),
      settle('analytics', () => webAnalytics(c, sinceMs, untilMs)),
      settle('deployments', async () => {
        const d = await vfetch(
          `/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=10`,
          c
        );
        return (d.deployments || []).map((x) => ({
          uid: x.uid,
          url: x.url,
          state: x.state || x.readyState,
          target: x.target,
          created: x.created || x.createdAt,
          branch: x.meta && x.meta.githubCommitRef,
          sha: x.meta && x.meta.githubCommitSha,
          message: (x.meta && x.meta.githubCommitMessage || '').split('\n')[0],
          creator: x.creator && x.creator.username,
        }));
      }),
      // Runtime logs are per-deployment. Resolve the current production
      // deployment first, then pull its events.
      settle('logs', async () => {
        const d = await vfetch(
          `/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=1&target=production&state=READY`,
          c
        );
        const dep = (d.deployments || [])[0];
        if (!dep) throw new Error('no READY production deployment found');
        const events = await vfetch(
          `/v3/deployments/${encodeURIComponent(dep.uid)}/events?limit=100&direction=backward`,
          c
        );
        const list = Array.isArray(events) ? events : (events.events || []);
        return {
          deployment: { uid: dep.uid, url: dep.url },
          events: list.map((e) => ({
            created: e.created || e.date,
            type: e.type,
            level: e.level || (e.payload && e.payload.level) || null,
            statusCode: e.statusCode || (e.payload && e.payload.statusCode) || null,
            method: e.requestMethod || (e.payload && e.payload.method) || null,
            path: e.requestPath || (e.payload && e.payload.path) || null,
            // Vercel masks/omits the client IP on most plans; surface whatever
            // is actually present rather than implying it is always there.
            clientIp: (e.payload && (e.payload.clientIp || e.payload.ip)) || null,
            region: e.payload && e.payload.region,
            text: (e.text || (e.payload && e.payload.text) || '').slice(0, 500),
          })),
        };
      }),
    ])
  );

  return res.status(200).json({
    configured: true,
    projectId,
    teamId: c.teamId,
    window: { days, since: new Date(sinceMs).toISOString(), until: new Date(untilMs).toISOString() },
    // What Vercel deliberately does not expose, stated explicitly so the UI
    // can say so rather than rendering a silently empty field.
    masked: {
      webAnalytics:
        'Vercel Web Analytics is aggregate-only by design: no visitor id, no IP, no per-person path. ' +
        'Per-visitor detail on this dashboard comes from our own tracker, not from here.',
      runtimeLogs:
        'Runtime log payloads expose client IP only on plans where it is retained; the field is null otherwise. ' +
        'Log retention is limited, so this shows the current production deployment only.',
    },
    panels,
  });
}
