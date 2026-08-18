/**
 * Test script for jaytibirthday.in Analytics Email System
 * Sends a test email to verify configuration
 */

const emailSender = require('./email_sender');

console.log(`
==========================================
📧 Testing jaytibirthday.in Email System
==========================================

This will send a test email to verify your configuration.
Recipient: ekaaiurgaa@gmail.com
`);

async function testEmailSystem() {
    console.log('\n🔧 Step 1: Testing email connection...');
    
    try {
        // Test connection
        const connectionResult = await emailSender.testConnection();
        
        if (!connectionResult.success) {
            console.log('❌ Connection test FAILED');
            console.log(`   Error: ${connectionResult.error}`);
            console.log(`   Hint: ${connectionResult.hint || 'Check email_config.js'}`);
            
            console.log('\n🔧 Configuration Required:');
            console.log('   1. Open email_config.js');
            console.log('   2. Set auth.user to "ekaaiurgaa@gmail.com"');
            console.log('   3. Generate app password at: https://myaccount.google.com/apppasswords');
            console.log('   4. Set app password in auth.pass');
            
            process.exit(1);
        }
        
        console.log('✅ Connection test PASSED');
        console.log(`   Message ID: ${connectionResult.messageId}`);
        
        console.log('\n📤 Step 2: Sending test analytics report...');
        
        // Send test report
        const testData = {
            totalVisitors: 127,
            newVisitors: 89,
            returningVisitors: 38,
            locations: [
                { country: 'India', count: 98 },
                { country: 'United States', count: 15 },
                { country: 'United Kingdom', count: 8 },
                { country: 'Canada', count: 6 }
            ],
            devices: {
                desktop: 54,
                mobile: 62,
                tablet: 11
            },
            topPages: [
                { url: '/', views: 127 },
                { url: '/about', views: 45 },
                { url: '/gallery', views: 32 },
                { url: '/contact', views: 18 }
            ],
            summary: 'Test report generated successfully! Your email notifications are working.'
        };
        
        const reportResult = await emailSender.sendDailyReport(testData);
        
        if (reportResult.success) {
            console.log('✅ Test report sent SUCCESSFULLY');
            console.log(`   Recipients: ${reportResult.recipients.join(', ')}`);
            console.log(`   Message ID: ${reportResult.messageId}`);
            
            console.log('\n🎉 Email System Status: FULLY OPERATIONAL');
            console.log('\n📋 Next Steps:');
            console.log('   1. Check your email: ekaaiurgaa@gmail.com');
            console.log('   2. Look for subject: "📊 jaytibirthday.in - Daily Visitor Report"');
            console.log('   3. Start scheduled service: npm start');
            
        } else {
            console.log('❌ Test report FAILED');
            console.log(`   Error: ${reportResult.error}`);
            
            console.log('\n🔧 Troubleshooting:');
            console.log('   • Verify app password is correct');
            console.log('   • Check Gmail account security settings');
            console.log('   • Ensure "Less secure app access" is enabled (if using regular password)');
        }
        
    } catch (error) {
        console.error('\n❌ Unexpected error:', error.message);
        console.error(error.stack);
    }
}

// Run test
testEmailSystem().then(() => {
    console.log('\n==========================================');
    console.log('✅ Test completed');
    console.log('==========================================');
    process.exit(0);
}).catch(error => {
    console.error('\n❌ Test failed with error:', error);
    process.exit(1);
});