// Geo-header normalisation, applied on READ.
//
// Vercel percent-encodes its `x-vercel-ip-*` headers, so a city arrives as
// "Son%C4%ABpat". jaytibirthday-site's /api/track now decodes at ingestion,
// but every row written before that fix still holds the encoded form, and
// there is no way to rewrite them from here - the blob store's write token is
// marked sensitive and cannot be pulled out of Vercel.
//
// Decoding on the way out fixes the whole history without a migration, and is
// safe to apply to already-decoded rows: decodeURIComponent on a string with
// no percent sequences returns it unchanged, so this is idempotent and needs
// no per-row flag.

// Only these carry text that can be non-ASCII. Numeric fields (latitude,
// longitude, asn) and the IP are left strictly alone.
const TEXT_FIELDS = ['city', 'country', 'countryRegion', 'timezone', 'asOrganization'];

function decodeOne(value) {
  if (typeof value !== 'string' || value.indexOf('%') === -1) return value;
  try {
    return decodeURIComponent(value);
  } catch (e) {
    // Malformed sequence - a literal '%' in the value. Keep the original
    // rather than dropping the field.
    return value;
  }
}

// Returns a new object; never mutates the caller's row.
export function decodeGeo(loc) {
  if (!loc || typeof loc !== 'object') return loc;
  let changed = false;
  const out = { ...loc };
  for (const f of TEXT_FIELDS) {
    const v = decodeOne(out[f]);
    if (v !== out[f]) {
      out[f] = v;
      changed = true;
    }
  }
  return changed ? out : loc;
}

export { decodeOne };
