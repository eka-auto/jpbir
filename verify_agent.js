// Quick verification script
const http = require('http');
console.log('Testing agent on port 3001...');
const req = http.request({
    hostname: 'localhost',
    port: 3001,
    path: '/api/status',
    timeout: 5000
}, (res) => {
    console.log('Status:', res.statusCode);
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            console.log('Agent:', json.name);
            console.log('Status:', json.status);
            console.log('✅ SUCCESS! Agent is working.');
        } catch (e) {
            console.log('Response:', data);
        }
    });
});
req.on('error', (e) => console.log('Error:', e.message));
req.on('timeout', () => {
    console.log('Timeout - agent not responding yet');
    console.log('Start the agent with: start_analytics.bat');
    req.destroy();
});
req.end();
