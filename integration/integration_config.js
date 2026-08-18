/**
 * Integration Configuration for jaytibirthday.in
 * Background analytics integration with existing SEO deployment
 */

module.exports = {
    // Domain configuration
    domain: {
        main: 'jaytibirthday.in',
        analyticsSubdomain: '_analytics.jaytibirthday.in',
        analyticsPath: '/_analytics',
        secure: true,
        sslEnabled: true
    },
    
    // Analytics agent configuration
    analyticsAgent: {
        internalPort: 3001,
        publicPort: 3001,
        endpoint: 'http://localhost:3001',
        healthCheck: 'http://localhost:3001/health',
        apiPrefix: '/api'
    },
    
    // Integration settings
    integration: {
        // JavaScript snippet settings
        scriptName: 'jaytibirthday-analytics.js',
        snippetPath: '/assets/js/analytics.js',
        minified: true,
        async: true,
        defer: true,
        
        // Data collection settings
        heartbeatInterval: 30000, // 30 seconds
        sessionTimeout: 1800000, // 30 minutes
        maxBatchSize: 10,
        
        // Privacy settings
        anonymizeIP: true,
        respectDNT: true,
        cookieConsentRequired: true
    },
    
    // SEO compatibility settings
    seoCompatibility: {
        // Ensure analytics don't affect SEO scores
        noIndexAnalytics: true,
        noFollowAnalytics: true,
        robotsTxtExclusion: true,
        
        // JSON-LD schema enhancement
        enhanceSchema: true,
        schemaIntegration: {
            addAnalyticsProperty: true,
            propertyName: 'analyticsSource',
            propertyValue: 'jaytibirthday-in-analytics'
        }
    },
    
    // Reverse proxy configuration
    reverseProxy: {
        enabled: true,
        type: 'nginx', // or 'apache', 'caddy'
        configPath: '/etc/nginx/sites-available/jaytibirthday-analytics.conf',
        sslCertificate: '/etc/ssl/certs/jaytibirthday.in.crt',
        sslKey: '/etc/ssl/private/jaytibirthday.in.key'
    },
    
    // Monitoring and logging
    monitoring: {
        enabled: true,
        logLevel: 'info',
        logPath: '/var/log/jaytibirthday-analytics.log',
        healthCheckEndpoint: '/_analytics/health',
        metricsEndpoint: '/_analytics/metrics',
        alertThresholds: {
            errorRate: 0.01, // 1%
            responseTime: 500, // 500ms
            uptime: 0.99 // 99%
        }
    },
    
    // Data retention policies
    dataRetention: {
        rawDataDays: 90,
        aggregatedDataDays: 365,
        anonymizedDataDays: 730,
        deleteOldData: true,
        backupEnabled: true,
        backupSchedule: '0 2 * * *' // Daily at 2 AM
    },
    
    // Integration scripts
    scripts: {
        setup: './scripts/setup_integration.sh',
        deploy: './scripts/deploy_integration.sh',
        monitor: './scripts/monitor_integration.sh',
        backup: './scripts/backup_data.sh',
        restore: './scripts/restore_data.sh'
    },
    
    // API endpoints mapping
    apiEndpoints: {
        track: '/_analytics/api/track',
        heartbeat: '/_analytics/api/heartbeat',
        session: '/_analytics/api/session',
        visitor: '/_analytics/api/visitor',
        analytics: '/_analytics/api/analytics',
        dashboard: '/_analytics/dashboard',
        admin: '/_analytics/admin'
    },
    
    // Security settings
    security: {
        rateLimiting: {
            enabled: true,
            requestsPerMinute: 60,
            burstLimit: 120
        },
        cors: {
            enabled: true,
            origins: ['https://jaytibirthday.in'],
            methods: ['GET', 'POST'],
            headers: ['Content-Type']
        },
        authentication: {
            dashboardAuth: true,
            apiKeyAuth: false,
            basicAuth: false
        }
    }
};