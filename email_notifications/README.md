# 📧 jaytibirthday.in Analytics Email Notifications

Simple email notification system that sends daily analytics reports to `ekaaiurgaa@gmail.com`.

## 🎯 Overview

This system automatically sends daily visitor analytics reports from your website `jaytibirthday.in` directly to your email. No dashboard needed - just check your inbox!

## ✨ Features

- **Daily Reports**: Sent at 6:00 PM IST every day
- **Simple Format**: Clean, easy-to-read text emails
- **Privacy Focused**: No personal data, anonymized reports
- **Reliable**: Automatic retries and error handling
- **Easy Setup**: Simple configuration wizard

## 📊 What's in the Report

Each daily email includes:
- Total visitors count
- New vs returning visitors
- Geographic distribution
- Device breakdown (desktop/mobile/tablet)
- Top visited pages
- Traffic patterns summary

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd email_notifications
npm install
```

### 2. Configure Email
```bash
npm run setup
```
Follow the setup wizard to configure your Gmail credentials.

### 3. Test the System
```bash
npm test
```
This will send a test email to `ekaaiurgaa@gmail.com`.

### 4. Start the Service
```bash
npm start
```
The system will run in the background and send daily reports.

## 🔧 Configuration

### Email Settings (`email_config.js`)
```javascript
{
    recipients: ['ekaaiurgaa@gmail.com'], // Your email
    email: {
        auth: {
            user: 'ekaaiurgaa@gmail.com', // Your Gmail
            pass: 'your-app-password'     // Gmail app password
        }
    }
}
```

### How to Get Gmail App Password
1. Go to https://myaccount.google.com/apppasswords
2. Sign in with `ekaaiurgaa@gmail.com`
3. Select "Mail" and "Other (Custom name)"
4. Name it "jaytibirthday Analytics"
5. Copy the 16-character password
6. Use it in the configuration

## 📋 Commands

| Command | Description |
|---------|-------------|
| `npm start` | Start the email service |
| `npm test` | Send test email |
| `npm run setup` | Run configuration wizard |

## 📁 File Structure

```
email_notifications/
├── index.js              # Main entry point
├── email_config.js       # Email configuration
├── email_sender.js       # Email sending logic
├── scheduler.js          # Daily scheduler
├── setup.js              # Setup wizard
├── test_email.js         # Test script
├── package.json          # Dependencies
└── logs/                 # System logs
```

## 🔍 Monitoring

Check the log files for system status:
```bash
# View latest logs
tail -f logs/email_sender.log
tail -f logs/scheduler.log
```

## 🛠️ Integration with Analytics Agent

This system works alongside your existing analytics agent. To integrate:

1. **Analytics Agent**: Collects visitor data on `jaytibirthday.in`
2. **Email System**: Sends daily summaries to your email
3. **No Dashboard Needed**: Everything comes to your inbox

## 📧 Email Samples

### Daily Report Email
```
📊 jaytibirthday.in - Daily Visitor Report

Date: Monday, August 16, 2026
Website: https://jaytibirthday.in

📈 Visitor Summary:
- Total Visitors: 127
- New Visitors: 89
- Returning Visitors: 38

📍 Top Locations:
- India: 98 visitors
- United States: 15 visitors
- United Kingdom: 8 visitors

📱 Device Breakdown:
- Desktop: 54 visitors
- Mobile: 62 visitors
- Tablet: 11 visitors

⏰ Peak Hours:
- 14:00: 42 visitors
- 20:00: 38 visitors
- 10:00: 25 visitors

🔗 Top Pages:
- /: 127 views
- /about: 45 views
- /gallery: 32 views
```

## 🔒 Privacy & Security

- No personal identifiable information collected
- All data is anonymized
- Email sent via secure Gmail SMTP
- No data stored beyond daily reports

## 🚨 Alerts

The system also sends alerts for:
- System failures
- Unusual traffic patterns
- Configuration issues

## 📞 Support

If you encounter issues:
1. Check the log files in `logs/` directory
2. Verify Gmail app password is correct
3. Ensure port 587 is not blocked by firewall

## ✅ Status Check

To verify the system is working:
1. Check your email `ekaaiurgaa@gmail.com` for test emails
2. Look for daily reports at 6:00 PM IST
3. Monitor log files for any errors

---

**🎉 Your jaytibirthday.in analytics are now delivered directly to your inbox!**