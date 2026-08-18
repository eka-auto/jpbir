/**
 * Setup script for jaytibirthday.in Analytics Email Notifications
 * Guides user through configuration
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log(`
==========================================
📧 jaytibirthday.in Email Setup Wizard
==========================================

This will guide you through setting up email notifications
for your website analytics.

Website: https://jaytibirthday.in
Recipient: ekaaiurgaa@gmail.com
`);

async function setup() {
    console.log('\n📝 Configuration Steps:');
    console.log('   1. Use Gmail address: ekaaiurgaa@gmail.com');
    console.log('   2. Generate app password from Google');
    console.log('   3. Configure email settings');
    
    const configPath = path.join(__dirname, 'email_config.js');
    
    // Read current config
    let configContent = fs.readFileSync(configPath, 'utf8');
    
    console.log('\n🔐 Step 1: Gmail App Password Generation');
    console.log('   Visit: https://myaccount.google.com/apppasswords');
    console.log('   • Sign in with ekaaiurgaa@gmail.com');
    console.log('   • Generate app password for "Mail"');
    console.log('   • Copy the 16-character password');
    
    rl.question('\n📋 Step 2: Enter your Gmail app password: ', (appPassword) => {
        // Update config with app password
        configContent = configContent.replace(
            /pass: '' \/\/ Your app password/,
            `pass: '${appPassword}' // Your app password`
        );
        
        // Write updated config
        fs.writeFileSync(configPath, configContent, 'utf8');
        
        console.log('\n✅ Configuration updated successfully!');
        console.log('\n📋 Configuration Summary:');
        console.log('   • Sender: ekaaiurgaa@gmail.com');
        console.log('   • Recipient: ekaaiurgaa@gmail.com');
        console.log('   • Schedule: Daily at 6:00 PM IST');
        console.log('   • Reports: Simple text format');
        
        console.log('\n🚀 Next Steps:');
        console.log('   1. Install dependencies: npm install');
        console.log('   2. Test email: npm test');
        console.log('   3. Start service: npm start');
        
        console.log('\n✅ Setup complete!');
        rl.close();
    });
}

setup();