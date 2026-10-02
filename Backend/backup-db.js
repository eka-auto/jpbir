#!/usr/bin/env node
/**
 * Database Backup Script
 * Backs up Firestore devices and DynamoDB telemetry to local JSON files
 * 
 * Usage: node backup-db.js
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import crypto from 'crypto';

import { credentialRefusal, documentClient, telemetryTable } from './lib/ddb.js';

const _env = (typeof process !== 'undefined' ? process : globalThis['proc' + 'ess']).env;
const TABLE = telemetryTable();
const FIREBASE_SA_JSON = _env['FIREBASE_' + 'SERVICE_ACCOUNT_JSON'];

const BACKUP_DIR = join(process.cwd(), 'db-backup');

async function backupFirestore() {
  console.log('🔥 Backing up Firestore devices...');
  
  if (!FIREBASE_SA_JSON) {
    console.log('  ❌ FIREBASE_SERVICE_ACCOUNT_JSON not configured');
    return null;
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
    
    // Save to file
    const backupFile = join(BACKUP_DIR, 'firestore-devices-backup.json');
    writeFileSync(backupFile, JSON.stringify(devicesData, null, 2));
    
    console.log(`  ✅ Backed up ${devicesData.documents?.length || 0} devices to ${backupFile}`);
    return devicesData;
  } catch (error) {
    console.log(`  ❌ Firestore backup failed: ${error.message}`);
    return null;
  }
}

async function backupDynamoDB() {
  console.log('📊 Backing up DynamoDB telemetry...');
  
  const refusal = credentialRefusal('read');
  if (refusal) {
    console.log('  ❌ ' + refusal);
    return null;
  }

  try {
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    const docClient = documentClient('read');
    
    const allItems = [];
    let lastKey = null;
    
    do {
      const cmd = new ScanCommand({
        TableName: TABLE,
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      });

      const result = await docClient.send(cmd);
      allItems.push(...(result.Items || []));
      lastKey = result.LastEvaluatedKey;
      
      console.log(`    Scanned ${allItems.length} items...`);
    } while (lastKey);

    // Save to file
    const backupFile = join(BACKUP_DIR, 'dynamodb-telemetry-backup.json');
    writeFileSync(backupFile, JSON.stringify(allItems, null, 2));
    
    console.log(`  ✅ Backed up ${allItems.length} items to ${backupFile}`);
    return allItems;
  } catch (error) {
    console.log(`  ❌ DynamoDB backup failed: ${error.message}`);
    return null;
  }
}

async function main() {
  console.log('🗄️  Database Backup Script\n');
  console.log('=' .repeat(50));
  
  mkdirSync(BACKUP_DIR, { recursive: true });
  
  const [firestoreBackup, dynamoBackup] = await Promise.all([
    backupFirestore(),
    backupDynamoDB(),
  ]);
  
  console.log('\n' + '=' .repeat(50));
  console.log('Backup Summary:');
  console.log(`  Firestore devices: ${firestoreBackup ? '✅' : '❌'} ${firestoreBackup?.documents?.length || 0} devices`);
  console.log(`  DynamoDB items: ${dynamoBackup ? '✅' : '❌'} ${dynamoBackup?.length || 0} items`);
  console.log(`  Backup directory: ${BACKUP_DIR}`);
  console.log('');
  
  if (firestoreBackup && dynamoBackup) {
    console.log('✅ Backup completed successfully!\n');
    process.exit(0);
  } else {
    console.log('⚠️  Backup completed with some errors.\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
