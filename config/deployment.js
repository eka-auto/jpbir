/**
 * Deployment Configuration for Visitor Analytics Agent
 * This file contains all deployment settings and environment configurations
 */

const deploymentConfig = {
  // Application Settings
  app: {
    name: 'Visitor Analytics Agent',
    version: '2.0.0',
    description: 'Kiro-powered agent for visitor analytics and network device discovery',
    author: 'Kiro Agent Team',
    license: 'MIT'
  },

  // Server Configuration
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0',
    environment: process.env.NODE_ENV || 'development',
    
    // Security settings
    security: {
      corsOrigin: process.env.CORS_ORIGIN || '*',
      rateLimitWindow: 15 * 60 * 1000, // 15 minutes
      rateLimitMax: 100,
      helmetEnabled: true,
      compressionEnabled: true
    },
    
    // Performance settings
    performance: {
      maxRequestBodySize: '10mb',
      trustProxy: process.env.TRUST_PROXY || false,
      keepAliveTimeout: 65000,
      headersTimeout: 66000
    }
  },

  // Database Configuration
  database: {
    // SQLite settings
    sqlite: {
      visitorsDb: './data/visitors.db',
      analyticsDb: './data/analytics.db',
      journalMode: 'WAL',
      synchronous: 'NORMAL',
      busyTimeout: 5000
    },
    
    // Data retention policies
    retention: {
      visitorsData: 90, // days
      analyticsData: 180, // days
      activityLogs: 30, // days
      networkScans: 7 // days
    },
    
    // Backup settings
    backup: {
      enabled: process.env.DB_BACKUP_ENABLED === 'true',
      interval: '24h', // daily backups
      retention: 7, // keep 7 backups
      location: './backups/'
    }
  },

  // Analytics Configuration
  analytics: {
    // Data collection settings
    collection: {
      enhancedTracking: true,
      fingerprinting: true,
      geolocation: true,
      networkInfo: true,
      performanceMetrics: true,
      
      // Privacy controls
      anonymizeIp: true,
      respectDoNotTrack: true,
      cookieConsentRequired: false,
      dataMinimization: true
    },
    
    // Processing intervals
    processing: {
      hourlyStats: '5m', // every 5 minutes
      dailyStats: '1h', // every hour
      deviceStats: '30m', // every 30 minutes
      cleanup: '24h' // daily cleanup
    },
    
    // Real-time analytics
    realtime: {
      enabled: true,
      updateInterval: '30s',
      maxConcurrentSessions: 1000
    }
  },

  // Network Scanner Configuration
  network: {
    scanner: {
      enabled: true,
      scanInterval: '5m', // every 5 minutes
      maxConcurrentScans: 10,
      timeout: 1000, // ms
      
      // Scan ranges
      ipRanges: [
        '192.168.0.0/24',
        '192.168.1.0/24',
        '10.0.0.0/24',
        '172.16.0.0/24'
      ],
      
      // Ports to scan
      commonPorts: [22, 80, 443, 8080, 3000, 3389, 21, 25, 53]
    },
    
    // Connection assistance
    connectionHelp: {
      enabled: true,
      suggestedProtocols: ['HTTP', 'HTTPS', 'SSH', 'RDP', 'FTP', 'Telnet']
    }
  },

  // API Configuration
  api: {
    // Versioning
    version: 'v1',
    basePath: '/api',
    
    // Endpoint groups
    endpoints: {
      analytics: '/analytics',
      admin: '/admin',
      status: '/status',
      enhanced: '/analytics/enhanced'
    },
    
    // Rate limiting per endpoint group
    rateLimits: {
      analytics: { window: '15m', max: 100 },
      admin: { window: '15m', max: 50 },
      public: { window: '15m', max: 200 }
    }
  },

  // Monitoring & Logging
  monitoring: {
    // Logging levels
    logging: {
      level: process.env.LOG_LEVEL || 'info',
      format: process.env.LOG_FORMAT || 'combined',
      directory: './logs/',
      maxFiles: '30d',
      maxSize: '100m'
    },
    
    // Health checks
    healthChecks: {
      enabled: true,
      endpoint: '/health',
      checkInterval: '30s',
      timeout: 5000
    },
    
    // Metrics collection
    metrics: {
      enabled: true,
      endpoint: '/metrics',
      collectDefaultMetrics: true,
      timeout: 10000
    }
  },

  // Deployment Environments
  environments: {
    development: {
      debug: true,
      verboseLogging: true,
      mockExternalApis: true,
      dataCleanupDisabled: true
    },
    
    staging: {
      debug: false,
      verboseLogging: false,
      mockExternalApis: false,
      dataCleanupEnabled: true
    },
    
    production: {
      debug: false,
      verboseLogging: false,
      mockExternalApis: false,
      dataCleanupEnabled: true,
      security: {
        corsOrigin: process.env.CORS_ORIGIN || 'https://yourdomain.com',
        rateLimitMax: 50,
        helmetStrict: true
      }
    }
  },

  // Domain Deployment Settings
  domain: {
    // DNS Settings
    dns: {
      ttl: 3600,
      recordTypes: ['A', 'AAAA', 'CNAME'],
      cloudflareEnabled: process.env.CLOUDFLARE_ENABLED === 'true'
    },
    
    // SSL/TLS Settings
    ssl: {
      enabled: process.env.SSL_ENABLED !== 'false',
      autoRenew: true,
      certificateType: 'letsencrypt',
      redirectHttpToHttps: true
    },
    
    // Load Balancer Settings
    loadBalancer: {
      enabled: process.env.LOAD_BALANCER_ENABLED === 'true',
      healthCheckPath: '/health',
      healthCheckInterval: 30,
      stickySessions: true
    }
  },

  // Integration Settings
  integrations: {
    // External APIs
    externalApis: {
      ipGeolocation: {
        provider: 'ipapi',
        endpoint: 'https://ipapi.co/{ip}/json/',
        fallbackProvider: 'ipgeolocation',
        cacheTtl: 3600 // 1 hour
      },
      
      publicIp: {
        provider: 'ipify',
        endpoint: 'https://api.ipify.org?format=json',
        fallbackEndpoint: 'https://api64.ipify.org?format=json'
      }
    },
    
    // Webhook notifications
    webhooks: {
      enabled: process.env.WEBHOOKS_ENABLED === 'true',
      endpoints: {
        newVisitor: process.env.WEBHOOK_NEW_VISITOR,
        networkScanComplete: process.env.WEBHOOK_NETWORK_SCAN,
        analyticsReport: process.env.WEBHOOK_ANALYTICS_REPORT
      },
      retryAttempts: 3,
      timeout: 5000
    }
  },

  // Feature Flags
  features: {
    // Core features
    visitorTracking: true,
    networkScanning: true,
    analyticsReports: true,
    realtimeDashboard: true,
    
    // Advanced features
    enhancedDataCollection: process.env.ENHANCED_COLLECTION !== 'false',
    deviceFingerprinting: process.env.FINGERPRINTING !== 'false',
    predictiveAnalytics: process.env.PREDICTIVE_ANALYTICS === 'true',
    aiInsights: process.env.AI_INSIGHTS === 'true',
    
    // Experimental features
    experimental: {
      behavioralAnalysis: false,
      threatDetection: false,
      automatedRemediation: false
    }
  },

  // Compliance & Privacy
  compliance: {
    gdpr: {
      enabled: process.env.GDPR_COMPLIANCE === 'true',
      dataPortability: true,
      rightToErasure: true,
      dataProcessingAgreement: true
    },
    
    ccpa: {
      enabled: process.env.CCPA_COMPLIANCE === 'true',
      doNotSell: true,
      consumerRights: true
    },
    
    privacy: {
      dataEncryption: process.env.DATA_ENCRYPTION !== 'false',
      anonymization: true,
      consentManagement: process.env.CONSENT_MANAGEMENT === 'true',
      privacyPolicyUrl: process.env.PRIVACY_POLICY_URL
    }
  }
};

// Helper function to get environment-specific config
function getConfig() {
  const env = process.env.NODE_ENV || 'development';
  const envConfig = deploymentConfig.environments[env] || {};
  
  return {
    ...deploymentConfig,
    ...envConfig,
    currentEnvironment: env
  };
}

// Export configuration
module.exports = {
  config: deploymentConfig,
  getConfig,
  // Environment-specific exports
  isDevelopment: process.env.NODE_ENV === 'development',
  isStaging: process.env.NODE_ENV === 'staging',
  isProduction: process.env.NODE_ENV === 'production'
};