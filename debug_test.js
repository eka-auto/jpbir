const http = require('http');
const fs = require('fs');
const path = require('path');

console.log('🔧 DEBUGGING & RECHECK - jaytibirthday.in Analytics');
console.log('=====================================================');

// Run all tests
async function runTests() {
    console.log('\n🔗 Test 1: Agent Connectivity');
    const agentResult = await testAgent();
    
    console.log('\n👤 Test 2: Visitor Tracking');
    const trackingResult = await testTracking();
    
    console.log('\n📁 Test 3: File System Check');
    const filesResult = await testFiles();
    
    console.log('\n💾 Test 4: Database Check');
    const dbResult = await testDatabase();
    
    // Summary
    console.log('\n================================');
    console.log('📋 DEBUGGING SUMMARY');
    console.log('================================');
    
    const results = [agentResult, trackingResult, filesResult, dbResult];
    const testNames = ['Agent Connectivity', 'Visitor Tracking', 'File System', 'Database'];
    
    let passed = 0;
    results.forEach((result, index) => {
        const status = result.success ? '✅' : '❌';
        console.log(\\ \\);
        if (result.success) passed++;
    });
    
    console.log(\\n📈 Results: \/\ tests passed\);
    
    if (passed === results.length) {
        console.log('\n🎉 EXCELLENT! All systems are operational.');
    } else if (passed >= results.length - 1) {
        console.log('\n⚠️ GOOD! Most systems are working.');
    } else {
        console.log('\n❌ ATTENTION NEEDED! Several tests failed.');
    }
    
    console.log('\n✅ Debugging complete!');
}

// Test functions
async function testAgent() {
    return new Promise((resolve) => {
        const req = http.request({
            hostname: 'localhost',
            port: 3001,
            path: '/api/status',
            method: 'GET',
            timeout: 5000
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    console.log('  ✅ Agent responding');
                    console.log('     Name:', json.name);
                    console.log('     Status:', json.status);
                    resolve({ success: true });
                } catch (e) {
                    console.log('  ❌ JSON parse error');
                    resolve({ success: false });
                }
            });
        });
        
        req.on('error', (e) => {
            console.log('  ❌ Connection error:', e.message);
            resolve({ success: false });
        });
        
        req.on('timeout', () => {
            console.log('  ❌ Connection timeout');
            req.destroy();
            resolve({ success: false });
        });
        
        req.end();
    });
}

async function testTracking() {
    return new Promise((resolve) => {
        const trackData = JSON.stringify({
            session_id: 'debug_' + Date.now(),
            device_fingerprint: 'debug_fp',
            page_url: 'https://jaytibirthday.in/debug',
            referrer: 'direct'
        });
        
        const req = http.request({
            hostname: 'localhost',
            port: 3001,
            path: '/api/analytics/track',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': trackData.length
            },
            timeout: 5000
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.success) {
                        console.log('  ✅ Visitor tracked');
                        console.log('     Visitor ID:', json.visitor_id);
                        resolve({ success: true });
                    } else {
                        console.log('  ❌ Tracking failed');
                        resolve({ success: false });
                    }
                } catch (e) {
                    console.log('  ❌ JSON parse error');
                    resolve({ success: false });
                }
            });
        });
        
        req.on('error', (e) => {
            console.log('  ❌ Request error:', e.message);
            resolve({ success: false });
        });
        
        req.write(trackData);
        req.end();
    });
}

async function testFiles() {
    const filesToCheck = [
        { path: path.join(__dirname, 'server.js'), desc: 'Main server file' },
        { path: path.join(__dirname, 'integration', 'website_tracker.js'), desc: 'JavaScript tracker' },
        { path: path.join(__dirname, 'email_notifications', 'email_config.js'), desc: 'Email config' },
        { path: path.join(__dirname, 'FINAL_INTEGRATION_GUIDE.md'), desc: 'Integration guide' }
    ];
    
    let found = 0;
    filesToCheck.forEach(file => {
        if (fs.existsSync(file.path)) {
            found++;
            console.log(\  ✅ \: Found\);
        } else {
            console.log(\  ❌ \: Missing\);
        }
    });
    
    const success = found >= filesToCheck.length - 1;
    return { success, found: found, total: filesToCheck.length };
}

async function testDatabase() {
    const dataDir = path.join(__dirname, 'data');
    
    if (fs.existsSync(dataDir)) {
        const files = fs.readdirSync(dataDir);
        const dbFiles = files.filter(f => f.endsWith('.db'));
        
        if (dbFiles.length > 0) {
            console.log('  ✅ Database files found:', dbFiles.length);
            return { success: true, count: dbFiles.length };
        } else {
            console.log('  ⚠️ Data directory exists but no .db files');
            return { success: true, count: 0 };
        }
    } else {
        console.log('  ⚠️ Data directory not found (will be created)');
        return { success: true, count: 0 };
    }
}

// Run the tests
runTests().catch(console.error);
