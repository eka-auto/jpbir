import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const AWS_ACCESS_KEY_ID = _env['JP_AWS_' + 'ACCESS_KEY_ID'];
const AWS_SECRET_ACCESS_KEY = _env['JP_AWS_' + 'SECRET_ACCESS_KEY'];
const AWS_REGION = _env['JP_AWS_' + 'REGION'] || 'us-west-2';
const TABLE = _env['JP_TELEMETRY_' + 'TABLE'] || 'jaytipargal_telemetry';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
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
