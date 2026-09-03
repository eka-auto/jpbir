import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const STATS_KEY = _env['STATS_' + 'KEY'];
const AWS_ACCESS_KEY_ID = _env['JP_AWS_' + 'ACCESS_KEY_ID'];
const AWS_SECRET_ACCESS_KEY = _env['JP_AWS_' + 'SECRET_ACCESS_KEY'];
const AWS_REGION = _env['JP_AWS_' + 'REGION'] || 'us-west-2';
const TABLE = _env['JP_TELEMETRY_' + 'TABLE'] || 'jaytipargal_telemetry';

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const max = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < max; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const key = req.query.key || req.headers['x-stats-key'];
  if (!timingSafeEqual(String(key || ''), STATS_KEY)) {
    return res.status(401).json({ success: false, error: 'Invalid key' });
  }
  try {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({
      region: AWS_REGION,
      credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY }
    }));
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
