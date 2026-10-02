import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { requireKey } from './_auth.js';
import { documentClient, telemetryTable } from './lib/ddb.js';

const TABLE = telemetryTable();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  // Returns raw telemetry rows — user agents, page URLs, device details — so
  // it is gated like every other read here rather than left open to the world.
  if (!requireKey(req, res)) return;
  try {
    const client = documentClient('read');
    const cmd = new ScanCommand({ TableName: TABLE, Limit: 2 });
    const r = await client.send(cmd);
    return res.status(200).json({
      success: true,
      count: (r.Items || []).length,
      items: (r.Items || []).map(i => ({ keys: Object.keys(i), sample: i })),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
