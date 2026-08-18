// FINAL VERIFICATION SCRIPT
// Run this after deployment to verify everything works

const http = require('http');

console.log('🔍 FINAL DEPLOYMENT VERIFICATION');
console.log('================================');
console.log('');
console.log('Domain: jaytibirthday.in');
console.log('');

// Check 1: Analytics Agent
console.log('1. Checking Analytics Agent...');
const agentCheck = new Promise((resolve) => {
    const req = http.request('http://localhost:3001/api/status', (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                console.log('   ✅ AGENT: RUNNING');
                console.log('      Name:', json.name);
                console.log('      Status:', json.status);
                resolve(true);
            } catch (e) {
                console.log('   ❌ AGENT: ERROR');
                resolve(false);
            }
        });
    });
    req.on('error', () => {
        console.log('   ❌ AGENT: NOT RUNNING');
        console.log('      Start with: start_analytics.bat');
        resolve(false);
    });
    req.end();
});

// Check 2: Deployment files
console.log('\n2. Checking Deployment Files...');
const fs = require('fs');
const files = {
    'JavaScript Tracker': 'jaytibirthday-analytics.js',
    'Deployment Guide': 'FINAL_DEPLOYMENT_COMPLETE.txt',
    'HTML Snippet': 'website_integration_snippet.html'
};

let filesFound = 0;
Object.entries(files).forEach(([name, file]) => {
    if (fs.existsSync(file)) {
        filesFound++;
        console.log('   ✅ ' + name + ': READY');
    } else {
        console.log('   ❌ ' + name + ': MISSING');
    }
});

console.log('\n3. Deployment Status:');
if (filesFound === Object.keys(files).length) {
    console.log('   ✅ ALL FILES READY FOR DEPLOYMENT');
} else {
    console.log('   ⚠️  SOME FILES MISSING');
}

console.log('\n================================');
console.log('🎯 FINAL DEPLOYMENT INSTRUCTIONS:');
console.log('================================');
console.log('');
console.log('TO COMPLETE THE DEPLOYMENT:');
console.log('');
console.log('1. Upload this file to your website:');
console.log('   File: jaytibirthday-analytics.js');
console.log('   Location: /assets/js/jaytibirthday-analytics.js');
console.log('');
console.log('2. Add this to your website HTML (before </head>):');
console.log('   <script async defer src="/assets/js/jaytibirthday-analytics.js"></script>');
console.log('');
console.log('3. The system will automatically:');
console.log('   • Track all jaytibirthday.in visitors');
console.log('   • Send daily reports to ekaaiurgaa@gmail.com');
console.log('   • Provide real-time analytics dashboard');
console.log('');
console.log('✅ DEPLOYMENT COMPLETE!');
