/**
 * Simple Email Scheduler for jaytibirthday.in Analytics
 * Sends daily reports automatically at 6:00 PM IST
 */

const config = require('./email_config');
const emailSender = require('./email_sender');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

class EmailScheduler {
    constructor() {
        this.jobs = [];
        this.analyticsData = null;
        this.logFile = path.join(__dirname, 'logs', 'scheduler.log');
        
        // Ensure log directory exists
        if (!fs.existsSync(path.join(__dirname, 'logs'))) {
            fs.mkdirSync(path.join(__dirname, 'logs'), { recursive: true });
        }
    }
    
    // Start the scheduler
    start() {
        this.log('Starting email scheduler...');
        
        // Schedule daily report at 6:00 PM IST (18:00)
        // Note: Cron format is in UTC, so 18:00 IST = 12:30 UTC
        const dailyJob = cron.schedule('30 12 * * *', async () => {
            await this.sendScheduledDailyReport();
        }, {
            scheduled: true,
            timezone: "UTC"
        });
        
        this.jobs.push({ name: 'daily_report', job: dailyJob });
        this.log('Daily report scheduled for 6:00 PM IST (12:30 UTC)');
        
        // Initialize email sender
        emailSender.initialize().then(initialized => {
            if (initialized) {
                this.log('Email sender initialized successfully');
            } else {
                this.log('Email sender initialization failed', 'warn');
            }
        });
        
        this.log('Email scheduler started successfully');
        return true;
    }
    
    // Stop the scheduler
    stop() {
        this.log('Stopping email scheduler...');
        
        this.jobs.forEach(job => {
            job.job.stop();
            this.log(`Stopped job: ${job.name}`);
        });
        
        this.jobs = [];
        this.log('Email scheduler stopped');
    }
    
    // Send scheduled daily report
    async sendScheduledDailyReport() {
        this.log('Executing scheduled daily report...');
        
        try {
            // Get analytics data (simulated for now)
            const analyticsData = await this.collectAnalyticsData();
            
            // Send email
            const result = await emailSender.sendDailyReport(analyticsData);
            
            if (result.success) {
                this.log(`Daily report sent successfully to ${result.recipients.length} recipients`);
            } else {
                this.log(`Failed to send daily report: ${result.error}`, 'error');
                
                // Send alert about failed report
                await emailSender.sendAlert('report_failed', {
                    message: 'Failed to send daily analytics report',
                    error: result.error,
                    actionRequired: 'Check email configuration'
                });
            }
            
        } catch (error) {
            this.log(`Error in scheduled report: ${error.message}`, 'error');
        }
    }
    
    // Send immediate test report
    async sendTestReport() {
        this.log('Sending test report...');
        
        try {
            const testData = {
                totalVisitors: 42,
                newVisitors: 25,
                returningVisitors: 17,
                locations: [
                    { country: 'India', count: 35 },
                    { country: 'United States', count: 5 },
                    { country: 'United Kingdom', count: 2 }
                ],
                devices: {
                    desktop: 20,
                    mobile: 18,
                    tablet: 4
                },
                peakHours: [
                    { hour: 14, count: 15 },
                    { hour: 20, count: 12 },
                    { hour: 10, count: 8 }
                ],
                topPages: [
                    { url: '/', views: 42 },
                    { url: '/about', views: 18 },
                    { url: '/contact', views: 9 }
                ],
                summary: 'Test data for email notification system'
            };
            
            const result = await emailSender.sendDailyReport(testData);
            
            if (result.success) {
                this.log(`Test report sent successfully. Message ID: ${result.messageId}`);
                return { success: true, messageId: result.messageId };
            } else {
                this.log(`Test report failed: ${result.error}`, 'error');
                return { success: false, error: result.error };
            }
            
        } catch (error) {
            this.log(`Error sending test report: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }
    
    // Collect analytics data (placeholder - integrate with your analytics system)
    async collectAnalyticsData() {
        // This is a placeholder - integrate with your actual analytics system
        // For now, return simulated data
        
        const now = new Date();
        const dateStr = now.toLocaleDateString('en-IN', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        
        return {
            date: dateStr,
            totalVisitors: Math.floor(Math.random() * 100) + 10,
            newVisitors: Math.floor(Math.random() * 50) + 5,
            returningVisitors: Math.floor(Math.random() * 50) + 5,
            locations: [
                { country: 'India', count: Math.floor(Math.random() * 80) + 20 },
                { country: 'United States', count: Math.floor(Math.random() * 20) + 5 },
                { country: 'United Kingdom', count: Math.floor(Math.random() * 10) + 2 }
            ],
            devices: {
                desktop: Math.floor(Math.random() * 40) + 10,
                mobile: Math.floor(Math.random() * 50) + 15,
                tablet: Math.floor(Math.random() * 10) + 2
            },
            topPages: [
                { url: '/', views: Math.floor(Math.random() * 100) + 30 },
                { url: '/about', views: Math.floor(Math.random() * 50) + 10 },
                { url: '/contact', views: Math.floor(Math.random() * 30) + 5 }
            ],
            summary: 'Normal traffic patterns observed on your website.'
        };
    }
    
    // Logging
    log(message, level = 'info') {
        const timestamp = new Date().toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour12: false
        });
        const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
        
        // Write to log file
        fs.appendFileSync(this.logFile, logEntry, 'utf8');
        
        // Also log to console
        console.log(logEntry.trim());
    }
}

// Export singleton instance
const scheduler = new EmailScheduler();
module.exports = scheduler;