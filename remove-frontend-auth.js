#!/usr/bin/env node
/**
 * Remove Dashboard Key Input from Frontend
 * 
 * This script removes the dashboard key input UI and unlock functionality
 * from all frontend HTML files to make the dashboard completely open.
 * 
 * Usage: node remove-frontend-auth.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const FRONTEND_DIR = join(process.cwd(), 'Frontend');

const FILES_TO_PROCESS = [
  'index.html',
  's24.html',
  'vivobook.html',
];

function processIndexHtml(filePath) {
  console.log(`Processing ${filePath}...`);
  
  let content = readFileSync(filePath, 'utf8');
  const originalContent = content;
  
  // Remove the overlay modal with key input
  content = content.replace(/<!-- Lock overlay -->[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*/, '');
  
  // Remove key input section if it exists separately
  content = content.replace(/\s*<div class="sub">jaytipargal\.tech — enter the dashboard key<\/div>\s*<input id="keyInput".*?>\s*<button id="unlockBtn">Unlock<\/button>/g, '');
  
  // Remove key-related JavaScript
  content = content.replace(/var KEY_STORAGE = 'jbt_stats_key';[\s\S]*?unlockBtn.*?click.*?\{[\s\S]*?\}\s*\}\);\s*\}\);/g, '');
  content = content.replace(/\$\('unlockBtn'\)\.addEventListener\('click', function \(\) \{[\s\S]*?\}\);/g, '');
  content = content.replace(/\$\('keyInput'\)\.addEventListener\('keydown', function \(e\) \{ if \(e\.key === 'Enter'\) \$\('unlockBtn'\)\.click\(\); \}\);/g, '');
  
  // Remove key from API calls (replace with empty string or remove key parameter)
  content = content.replace(/key=\$\{STATS_KEY\}/g, '');
  content = content.replace(/&key=\$\{STATS_KEY\}/g, '');
  content = content.replace(/\?key=\$\{STATS_KEY\}/g, '?');
  
  if (content !== originalContent) {
    writeFileSync(filePath, content, 'utf8');
    console.log('  ✅ Modified: Removed dashboard key UI and unlock functionality\n');
    return true;
  } else {
    console.log('  ℹ️  No changes needed\n');
    return false;
  }
}

function processDeviceHtml(filePath, pageName) {
  console.log(`Processing ${filePath}...`);
  
  let content = readFileSync(filePath, 'utf8');
  const originalContent = content;
  
  // Remove key input modal/overlay
  content = content.replace(/<p style="font-size:13px;color:var\(--ink-muted\);margin-bottom:8px">Enter your stats key to view this page\.<\/p>[\s\S]*?<button class="primary" id="keySubmit">Unlock<\/button>[\s\S]*?<\/div>/g, '');
  
  // Remove key variable initialization
  content = content.replace(/var KEY = sessionStorage\.getItem\('jbt_stats_key'\) \|\| new URLSearchParams\(location\.search\)\.get\('key'\) \|\| '';/g, 'var KEY = \'\'; // Open dashboard - no key required');
  
  // Remove key setting logic
  content = content.replace(/if \(!KEY\) \{[\s\S]*?sessionStorage\.setItem\('jbt_stats_key', KEY\);[\s\S]*?\}/g, '// Key not required for open dashboard');
  
  // Remove error messages about key
  content = content.replace(/'Could not query the dashboard API: <code>' \+ esc\(e\.message\) \+ '<\/code>\. Check that a valid stats key is set and the API is deployed\.';/g, '\'Could not query the dashboard API: <code>\' + esc(e.message) + \'</code>.\'');
  
  // Remove key from API calls
  content = content.replace(/&key=\$\{encodeURIComponent\(KEY\)\}/g, '');
  content = content.replace(/\?key=\$\{encodeURIComponent\(KEY\)\}/g, '?');
  
  if (content !== originalContent) {
    writeFileSync(filePath, content, 'utf8');
    console.log(`  ✅ Modified: Removed ${pageName} key input UI\n`);
    return true;
  } else {
    console.log(`  ℹ️  No changes needed\n`);
    return false;
  }
}

function main() {
  console.log('🔓 Removing Dashboard Key Input from Frontend\n');
  console.log('=' .repeat(60));
  console.log('');
  
  let modifiedCount = 0;
  
  // Process index.html (main dashboard)
  if (processIndexHtml(join(FRONTEND_DIR, 'index.html'))) {
    modifiedCount++;
  }
  
  // Process device pages
  if (processDeviceHtml(join(FRONTEND_DIR, 's24.html'), 'S24')) {
    modifiedCount++;
  }
  
  if (processDeviceHtml(join(FRONTEND_DIR, 'vivobook.html'), 'VivoBook')) {
    modifiedCount++;
  }
  
  console.log('=' .repeat(60));
  console.log(`\n✅ Complete! Modified ${modifiedCount}/3 frontend files`);
  console.log('\n⚠️  IMPORTANT: Test the frontend thoroughly to ensure:');
  console.log('  1. No key input prompts appear');
  console.log('  2. Data loads automatically');
  console.log('  3. All API calls work without key parameter');
  console.log('\nNext steps:');
  console.log('1. Test locally with `vercel dev`');
  console.log('2. Deploy to production with `vercel deploy --prod --yes`');
  console.log('3. Remove STATS_KEY environment variable from Vercel');
  console.log('4. Verify dashboard loads without authentication\n');
}

main();
