// Legacy compatibility route.
//
// Some trackers still POST to /api/track. Keep that path on the exact same
// direct-to-warehouse ingestion handler as /api/jp-track so a successful
// collector ACK means the event is in Postgres and immediately visible to the
// dashboard.
import handler from './jp-track.js';

export default handler;
