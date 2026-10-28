// VivoBook group - the index over this machine's sections.
//
// The section under this folder is a complete endpoint of its own: its own key
// gate, its own connection pool, its own SQL, no import from any other section.
// This file only names it and forwards a request to it.
//
//   GET /api/vivobook-group                -> the index (no key needed)
//   GET /api/vivobook-group?section=vivobook&key=<STATS_KEY>
//
// or straight at the section:
//
//   GET /api/vivobook?key=<STATS_KEY>

import vivobook, { meta as vivobookMeta } from './VivoBook/section.js';

const REGISTRY = [[vivobookMeta, vivobook]];

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
    return res.status(200).json({ ok: true, group: 'VivoBook', sections: INDEX });
  }

  const found = REGISTRY.find(([meta]) => meta.slug === slug);
  if (!found) {
    return res.status(400).json({ ok: false, error: `section must be one of ${SECTIONS.join(', ')}`, sections: INDEX });
  }
  return found[1](req, res);
}
