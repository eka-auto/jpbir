// The legacy property endpoint now uses the same indexed Neon queries as
// /api/stats. Keeping this small compatibility wrapper avoids a second
// analytics implementation and keeps existing callers on the one property the
// warehouse tracks.
import stats from './stats.js';
import { TRACKED_PROPERTY } from './lib/warehouse.js';

const DEFAULT_SITE = process.env.JP_STATS_SITE || TRACKED_PROPERTY;

export default function handler(req, res) {
  const site = String(req.query?.site || '').trim() || DEFAULT_SITE;
  return stats({ ...req, query: { ...(req.query || {}), site } }, res);
}
