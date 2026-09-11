#!/usr/bin/env node
/**
 * Remove Authentication from Backend Endpoints
 * 
 * This script removes all STATS_KEY checks and timingSafeEqual functions
 * from backend API endpoint files to make the dashboard completely open.
 * 
 * Usage: node remove-auth.js
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const BACKEND_DIR = join(process.cwd(), 'Backend');

// Files to process (exclude daemon files and non-API files)
const FILES_TO_PROCESS = [
  'jp-stats.js',
  'jp-devices.js',
  'jp-agent.js',
  'jp-ask.js',
  'jp-live-agent.js',
  'jp-debug.js',
  'jp-visitor.js',
  'stats.js',
  'visitor.js',
  'connect.js',
  'jp-device.js',
  'verify-db.js',
];

// Patterns to remove
const PATTERNS_TO_REMOVE = [
  // Remove STATS_KEY constant declaration
  /const STATS_KEY = _env\['STATS_' \+ 'KEY'\];\s*/g,
  
  // Remove timingSafeEqual function (multi-line)
  /function timingSafeEqual\(a, b\) \{[\s\S]*?return diff === 0;\s*\}\s*/g,
  
  // Remove STATS_KEY check
  /if \(!STATS_KEY\) \{\s*return res\.status\(500\)\.json\(\{ success: false, error: 'STATS_KEY not configured' \}\);\s*\}\s*/g,
  
  // Remove timingSafeEqual check with Invalid key error
  /if \(!timingSafeEqual\(String\(key \|\| ''\), STATS_KEY\)\) \{\s*return res\.status\(401\)\.json\(\{ success: false, error: 'Invalid key' \}\);\s*\}\s*/g,
  
  // Remove key extraction from query/headers
  /const key = req\.query\.key \|\| req\.headers\['x-stats-key'\];\s*/g,
];

function processFile(filePath) {
  console.log(`Processing ${filePath}...`);
  
  let content = readFileSync(filePath, 'utf8');
  const originalContent = content;
  
  let changesCount = 0;
  
  PATTERNS_TO_REMOVE.forEach((pattern, index) => {
    const matches = content.match(pattern);
    if (matches) {
      content = content.replace(pattern, '');
      changesCount += matches.length;
      console.log(`  ✓ Removed pattern ${index + 1} (${matches.length} occurrences)`);
    }
  });
  
  if (content !== originalContent) {
    writeFileSync(filePath, content, 'utf8');
    console.log(`  ✅ Modified: ${changesCount} authentication checks removed\n`);
    return true;
  } else {
    console.log(`  ℹ️  No changes needed\n`);
    return false;
  }
}

function main() {
  console.log('🔓 Removing Authentication from Backend Endpoints\n');
  console.log('=' .repeat(60));
  console.log('');
  
  let modifiedCount = 0;
  
  FILES_TO_PROCESS.forEach(file => {
    const filePath = join(BACKEND_DIR, file);
    try {
      if (processFile(filePath)) {
        modifiedCount++;
      }
    } catch (error) {
      console.log(`  ❌ Error processing ${file}: ${error.message}\n`);
    }
  });
  
  console.log('=' .repeat(60));
  console.log(`\n✅ Complete! Modified ${modifiedCount}/${FILES_TO_PROCESS.length} files`);
  console.log('\n⚠️  IMPORTANT: You must also update the frontend to remove the dashboard key input!');
  console.log('\nNext steps:');
  console.log('1. Update frontend to remove key input and unlock button');
  console.log('2. Test all endpoints work without authentication');
  console.log('3. Deploy to production');
  console.log('4. Remove STATS_KEY environment variable from Vercel\n');
}

main();
