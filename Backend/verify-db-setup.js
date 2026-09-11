#!/usr/bin/env node
/**
 * Database Verification Script for Production Deployment
 * 
 * Verifies:
 * 1. DynamoDB table exists and is accessible
 * 2. Firestore connection works
 * 3. All required environment variables are set
 * 
 * Usage: node verify-db-setup.js
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { fetch } from 'undici';

const env = process.env;

const config = {
  STATS_KEY: env.STATS_KEY,
  AWS_ACCESS_KEY_ID: env.JP_AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: env.JP_AWS_SECRET_ACCESS_KEY,
  AWS_REGION: env.JP_AWS_REGION || 'us-west-2',
  TABLE: env.JP_TELEMETRY_TABLE || 'jaytipargal_telemetry',
  FIREBASE_SA_JSON: env.FIREBASE_SERVICE_ACCOUNT_JSON,
};

console.log('🔍 Database Verification for Production\n');
console.log('Configuration:');
Object.entries(config).forEach(([key, value]) => {
  const masked = value && value.length > 10 ? value.substring(0, 10) + '...' : value ? '***' : '❌ MISSING';
  console.log(`  ${key}: ${masked}`);
});
console.log('');

async function verifyDynamoDB() {
  console.log('📊 Checking DynamoDB...');
  
  if (!config.AWS_ACCESS_KEY_ID || !config.AWS_SECRET_ACCESS_KEY) {
    console.log('  ❌ AWS credentials not configured\n');
    return false;
  }

  try {
    const client = new DynamoDBClient({
      region: config.AWS_REGION,
      credentials: {
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      },
    });

    const docClient = DynamoDBDocumentClient.from(client);
    const cmd = new ScanCommand({
      TableName: config.TABLE,
      Limit: 5,
    });

    const result = await docClient.send(cmd);
    console.log(`  ✅ DynamoDB connected successfully`);
    console.log(`  Table: ${config.TABLE}`);
    console.log(`  Items scanned: ${result.Count || 0}`);
    console.log(`  Last evaluated key: ${result.LastEvaluatedKey ? 'has more' : 'complete'}\n`);
    return true;
  } catch (error) {
    console.log(`  ❌ DynamoDB error: ${error.message}\n`);
    return false;
  }
}

async function verifyFirestore() {
  console.log('🔥 Checking Firestore...');
  
  if (!config.FIREBASE_SA_JSON) {
    console.log('  ❌ FIREBASE_SERVICE_ACCOUNT_JSON not configured\n');
    return false;
  }

  try {
    const sa = JSON.parse(config.FIREBASE_SA_JSON);
    const projectId = sa.project_id;
    
    // Get OAuth2 token
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
    
    const crypto = await import('crypto');
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
      throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
    }

    // Query Firestore devices
    const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/eka-agent/documents`;
    const devicesRes = await fetch(`${base}/devices`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!devicesRes.ok) {
      throw new Error(`Firestore read failed: ${devicesRes.status} ${devicesRes.statusText}`);
    }

    const devicesData = await devicesRes.json();
    const deviceCount = devicesData.documents?.length || 0;

    console.log(`  ✅ Firestore connected successfully`);
    console.log(`  Project: ${projectId}`);
    console.log(`  Database: eka-agent`);
    console.log(`  Devices found: ${deviceCount}\n`);
    return true;
  } catch (error) {
    console.log(`  ❌ Firestore error: ${error.message}\n`);
    return false;
  }
}

async function main() {
  console.log('=' .repeat(50));
  console.log('');

  const dynamoOk = await verifyDynamoDB();
  const firestoreOk = await verifyFirestore();

  console.log('=' .repeat(50));
  console.log('Summary:');
  console.log(`  DynamoDB: ${dynamoOk ? '✅ OK' : '❌ FAILED'}`);
  console.log(`  Firestore: ${firestoreOk ? '✅ OK' : '❌ FAILED'}`);
  console.log('');

  if (dynamoOk && firestoreOk) {
    console.log('✅ All databases verified successfully!');
    console.log('   Production deployment is ready.\n');
    process.exit(0);
  } else {
    console.log('⚠️  Some databases failed verification.');
    console.log('   Check the errors above and ensure environment variables are set.\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
