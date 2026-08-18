/**
 * Main entry point for jaytibirthday.in Analytics Email Notifications
 * Sends daily reports to ekaaiurgaa@gmail.com
 */

const scheduler = require('./scheduler');
const emailSender = require('./email_sender');
const fs = require('fs');
const path = require('path');

console.log(`
==========================================
📧 jaytibirthday.in Analytics Email System
==========================================

Website: https://jaytibirthday.in
Recipient: ekaaiurgaa@gmail.com
Schedule: Daily at 6:00 PM IST
`);

// Create necessary directories
const directories = ['logs'];
directories.forEach(dir => {
    const dirPath = path.join(__dirname, dir);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        console.log(`Created directory: ${dir}`);
    }
});

// Main function
async function main() {
    console.log('\n🚀 Starting email notification system...');
    
    try {
        // Test email configuration first
        console.log('\n🔧 Testing email configuration...');
        const testResult = await emailSender.testConnection();
        
        if (testResult.success) {
            console.log('✅ Email configuration test PASSED');
            console.log(`   Test email sent to: ekaaiurgaa@gmail.com`);
            console.log(`   Message ID: ${testResult.messageId}`);
        } else {
            console.log('❌ Email configuration test FAILED');
            console.log(`   Error: ${testResult.error}`);
            console.log(`   Hint: ${testResult.hint || 'Check email_config.js'}`);
            console.log('\n⚠️ Please configure email credentials:');
            console.log('   1. Open email_config.js');
            console.log('   2. Set your Gmail in auth.user');
            console.log('   3. Generate app password at: https://myaccount.google.com/apppasswords');
            console.log('   4. Set app password in auth.pass');
            return;
        }
        
        // Send initial test report
        console.log('\n📤 Sending initial test report...');
        const reportResult = await scheduler.sendTestReport();
        
        if (reportResult.success) {
            console.log('✅ Test report sent successfully');
            console.log(`   Message ID: ${reportResult.messageId}`);
        } else {
            console.log('⚠️ Test report failed (continuing anyway)');
            console.log(`   Error: ${reportResult.error}`);
        }
        
        // Start the scheduler
        console.log('\n⏰ Starting scheduled email service...');
        scheduler.start();
        
        console.log('\n✅ Email notification system is now RUNNING');
        console.log('\n📋 System Status:');
        console.log('   ✓ Daily reports scheduled: 6:00 PM IST');
        console.log('   ✓ Recipient: ekaaiurgaa@gmail.com');
        console.log('   ✓ Email service: Active');
        console.log('   ✓ Logging: Enabled (logs/ directory)');
        
        console.log('\n🔧 Management Commands:');
        console.log('   • Stop system: Ctrl+C');
        console.log('   • View logs: Check logs/ directory');
        console.log('   • Test email: npm test');
        
        console.log('\n📧 Next email will be sent at 6:00 PM IST today');
        
        // Handle shutdown
        process.on('SIGINT', () => {
            console.log('\n\n🛑 Shutting down email notification system...');
            scheduler.stop();
            console.log('✅ System stopped gracefully');
            process.exit(0);
        });
        
    } catch (error) {
        console.error('\n❌ Error starting email system:', error.message);
        process.exit(1);
    }
}

// Run the system
if (require.main === module) {
    main();
}

module.exports = {
    scheduler,
    emailSender,
    start: main
};