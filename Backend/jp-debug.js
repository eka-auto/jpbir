import { requireKey } from './_auth.js';
import { query, isConfigured } from '../Integrations/postgres.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!requireKey(req, res)) return;
  if (!isConfigured()) return res.status(503).json({ success: false, error: 'DATABASE_URL not set on this deployment' });
  try {
    const result = await query(
      `SELECT id, site, event_type, occurred_at, session_id, visitor_id, page_url
         FROM events ORDER BY occurred_at DESC LIMIT 2`
    );
    return res.status(200).json({ success: true, source: 'neon', count: result.rows.length, items: result.rows });
  } catch (err) {
    console.error('[jp-debug] neon read failed:', err);
    return res.status(500).json({ success: false, error: 'debug query failed' });
  }
}
