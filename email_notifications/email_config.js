/**
 * Email Notification Configuration for jaytibirthday.in Analytics
 * Sends notifications to domain registered email: ekaaiurgaa@gmail.com
 */

module.exports = {
    // Primary recipient - domain registered email
    recipients: [
        'ekaaiurgaa@gmail.com'  // Your domain registered email
    ],
    
    // Optional backup recipients (from SEO data)
    backupRecipients: [
        'jaytipargal.jp@gmail.com',
        'pargaljayati.06@gmail.com'
    ],
    
    // Email settings - Using Gmail SMTP
    email: {
        service: 'gmail',
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        requireTLS: true,
        
        // Sender configuration (uses your Gmail)
        auth: {
            user: 'ekaaiurgaa@gmail.com', // Your Gmail address
            pass: '' // Your Gmail app password (generate in Google Account > Security > App passwords)
        },
        
        // Sender info
        from: 'Jayati Analytics <analytics@jaytibirthday.in>',
        replyTo: 'ekaaiurgaa@gmail.com'
    },
    
    // Simple notification settings - Daily reports only
    notifications: {
        dailyReport: {
            enabled: true,
            time: '18:00', // 6:00 PM daily
            timezone: 'Asia/Kolkata',
            simpleFormat: true // Simple text format, not HTML
        },
        
        // Critical alerts only
        alerts: {
            enabled: true,
            types: ['system_down', 'high_traffic', 'unusual_activity']
        },
        
        // No weekly or milestone notifications for simplicity
        weeklyReport: { enabled: false },
        milestones: { enabled: false }
    },
    
    // Simple email templates (text-only)
    templates: {
        dailyReport: {
            subject: '📊 jaytibirthday.in - Daily Visitor Report',
            template: 'simple_daily_report.txt'
        },
        alert: {
            subject: '⚠️ jaytibirthday.in - System Alert',
            template: 'simple_alert.txt'
        }
    },
    
    // Simple content - only essential data
    content: {
        websiteName: 'jaytibirthday.in',
        websiteUrl: 'https://jaytibirthday.in',
        include: ['visitor_count', 'top_pages', 'location_summary'],
        exclude: ['detailed_ips', 'user_agents', 'network_details']
    },
    
    // Simple delivery settings
    delivery: {
        maxRetries: 2,
        retryDelay: 3000
    }
};