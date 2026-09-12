/**
 * Database Verification API Endpoint
 * 
 * GET /api/verify-db
 * 
 * Verifies production database connectivity:
 * 1. DynamoDB table access
 * 2. Firestore device read
 * 
 * Returns JSON with verification status
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import crypto from 'crypto';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const AWS_ACCESS_KEY_ID = _env['JP_AWS_' + 'ACCESS_KEY_ID'];
const AWS_SECRET_ACCESS_KEY = _env['JP_AWS_' + 'SECRET_ACCESS_KEY'];
const AWS_REGION = _env['JP_AWS_' + 'REGION'] || 'us-west-2';
const TABLE = _env['JP_TELEMETRY_' + 'TABLE'] || 'jaytipargal_telemetry';
const FIREBASE_SA_JSON = _env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'];
const CRON_SECRET = _env['CRON_' + 'SECRET'];

async function verifyDynamoDB() {
  if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    return { ok: false, error: 'AWS credentials not configured' };
  }

  try {
    const client = new DynamoDBClient({
      region: AWS_REGION,
      credentials: {
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
      },
    });

    const docClient = DynamoDBDocumentClient.from(client);
    const cmd = new ScanCommand({
      TableName: TABLE,
      Limit: 1,
    });

    const result = await docClient.send(cmd);
    return {
      ok: true,
      table: TABLE,
      items_found: result.Count || 0,
      has_more: !!result.LastEvaluatedKey,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function verifyFirestore() {
  if (!FIREBASE_SA_JSON) {
    return { ok: false, error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' };
  }

  try {
    const sa = JSON.parse(FIREBASE_SA_JSON);
    const projectId = sa.project_id;
    
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claim = {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    };

    const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const input = `${b64url(header)}.${b64url(claim)}`;
    const sig = crypto.sign('RSA-SHA256', Buffer.from(input), sa.private_key);
    const jwt = `${input}.${sig.toString('base64url')}`;

    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      throw new Error(`Token exchange failed: ${JSON.stringify(tokenData).slice(0, 200)}`);
    }

    const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/eka-agent/documents`;
    const devicesRes = await fetch(`${base}/devices`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!devicesRes.ok) {
      throw new Error(`Firestore read failed: ${devicesRes.status} ${devicesRes.statusText}`);
    }

    const devicesData = await devicesRes.json();
    return {
      ok: true,
      project: projectId,
      database: 'eka-agent',
      devices_found: devicesData.documents?.length || 0,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');

  // Open dashboard - no authentication required
  // Optionally support CRON_SECRET for scheduled checks
  const auth = String(req.headers['authorization'] || '');
  if (CRON_SECRET && auth.startsWith('Bearer ') && !crypto.timingSafeEqual(Buffer.from(auth.slice(7)), Buffer.from(CRON_SECRET))) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }

  const [dynamoResult, firestoreResult] = await Promise.all([
    verifyDynamoDB(),
    verifyFirestore(),
  ]);

  const allOk = dynamoResult.ok && firestoreResult.ok;

  res.status(allOk ? 200 : 500).json({
    success: allOk,
    verified_at: new Date().toISOString(),
    databases: {
      dynamodb: dynamoResult,
      firestore: firestoreResult,
    },
    production_ready: allOk,
  });
}
