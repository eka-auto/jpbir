// S24 group - the index over this device's sections.
//
// Each section under this folder is a complete endpoint of its own: its own key
// gate, its own connection pool, its own SQL, no import from any other section.
// This file only names them and forwards a request to the one asked for, so a
// caller that already holds a section slug keeps working.
//
//   GET /api/s24-group                  -> the index (no key needed)
//   GET /api/s24-group?section=whatsapp&key=<STATS_KEY>
//
// or straight at a section:
//
//   GET /api/s24-whatsapp?key=<STATS_KEY>

import ultra, { meta as ultraMeta } from './S24 Ultra/section.js';
import dashboard, { meta as dashboardMeta } from './Device Dashboard/section.js';
import whatsapp, { meta as whatsappMeta } from './WhatsApp/section.js';
import media, { meta as mediaMeta } from './Media/section.js';
import telegram, { meta as telegramMeta } from './Telegram/section.js';
import live, { meta as liveMeta } from './Live feed/section.js';

const REGISTRY = [
  [ultraMeta, ultra],
  [dashboardMeta, dashboard],
  [whatsappMeta, whatsapp],
  [mediaMeta, media],
  [telegramMeta, telegram],
  [liveMeta, live],
];

export const SECTIONS = REGISTRY.map(([meta]) => meta.slug);

export const INDEX = REGISTRY.map(([meta]) => ({
  section: meta.slug,
  title: meta.title,
  endpoint: meta.endpoint,
  tables: meta.tables,
}));

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'GET only' });

  const slug = String((req.query || {}).section || '');
  if (!slug) {
    return res.status(200).json({ ok: true, group: 'S24', sections: INDEX });
  }

  const found = REGISTRY.find(([meta]) => meta.slug === slug);
  if (!found) {
    return res.status(400).json({ ok: false, error: `section must be one of ${SECTIONS.join(', ')}`, sections: INDEX });
  }
  return found[1](req, res);
}
