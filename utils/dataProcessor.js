const AnalyticsEngine = require('./analyticsEngine');
const VisitorLogger = require('./visitorLogger');

class DataProcessor {
  constructor() {
    this.analyticsEngine = new AnalyticsEngine();
    this.visitorLogger = null; // Will be set after VisitorLogger is initialized
    this.processingInterval = null;
    this.isProcessing = false;
  }

  setVisitorLogger(visitorLogger) {
    this.visitorLogger = visitorLogger;
  }

  startProcessing(intervalMinutes = 5) {
    console.log(`Starting data processing service (interval: ${intervalMinutes} minutes)`);
    
    // Run initial processing
    this.processAllData();
    
    // Set up periodic processing
    this.processingInterval = setInterval(() => {
      this.processAllData();
    }, intervalMinutes * 60 * 1000);
  }

  stopProcessing() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      console.log('Data processing service stopped');
    }
  }

  async processAllData() {
    if (this.isProcessing) {
      console.log('Data processing already in progress, skipping...');
      return;
    }

    this.isProcessing = true;
    const startTime = Date.now();

    try {
      console.log('Starting data processing cycle...');
      
      await Promise.all([
        this.processHourlyStats(),
        this.processDailyStats(),
        this.processDeviceStats(),
        this.processBrowserStats(),
        this.processLocationStats(),
        this.processNetworkStats(),
        this.processReferrerStats()
      ]);

      const processingTime = Date.now() - startTime;
      console.log(`Data processing completed in ${processingTime}ms`);
      
    } catch (error) {
      console.error('Error during data processing:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  async processHourlyStats() {
    try {
      await this.analyticsEngine.updateHourlyStats();
      console.log('Hourly stats processed');
    } catch (error) {
      console.error('Error processing hourly stats:', error);
    }
  }

  async processDailyStats() {
    try {
      await this.analyticsEngine.updateDailyStats();
      console.log('Daily stats processed');
    } catch (error) {
      console.error('Error processing daily stats:', error);
    }
  }

  async processDeviceStats() {
    if (!this.visitorLogger) {
      console.warn('VisitorLogger not available for device stats processing');
      return;
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const visitors = await this.visitorLogger.getAllVisitors(1000);
      
      // Group by device type
      const deviceStats = {};
      
      visitors.forEach(visitor => {
        const deviceType = visitor.device_type || 'unknown';
        
        if (!deviceStats[deviceType]) {
          deviceStats[deviceType] = {
            visitors: 0,
            page_views: 0,
            total_time: 0,
            bounce_count: 0
          };
        }
        
        deviceStats[deviceType].visitors++;
        deviceStats[deviceType].page_views += visitor.page_views || 1;
        deviceStats[deviceType].total_time += visitor.total_time_spent || 0;
        
        // Count bounces (1 page view and < 30 seconds)
        if ((visitor.page_views || 1) === 1 && (visitor.total_time_spent || 0) < 30) {
          deviceStats[deviceType].bounce_count++;
        }
      });

      // Update device stats table
      for (const [deviceType, stats] of Object.entries(deviceStats)) {
        const avgTimeSpent = stats.visitors > 0 ? Math.round(stats.total_time / stats.visitors) : 0;
        const bounceRate = stats.visitors > 0 ? (stats.bounce_count / stats.visitors * 100).toFixed(2) : 0;

        await this.analyticsEngine.dbRun(`
          INSERT OR REPLACE INTO device_stats 
          (device_type, date, visitors, page_views, avg_time_spent, bounce_rate)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [deviceType, today, stats.visitors, stats.page_views, avgTimeSpent, bounceRate]);
      }

      console.log(`Device stats processed for ${Object.keys(deviceStats).length} device types`);
    } catch (error) {
      console.error('Error processing device stats:', error);
    }
  }

  async processBrowserStats() {
    if (!this.visitorLogger) {
      console.warn('VisitorLogger not available for browser stats processing');
      return;
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const visitors = await this.visitorLogger.getAllVisitors(1000);
      
      // Group by browser
      const browserStats = {};
      
      visitors.forEach(visitor => {
        const browserName = visitor.browser_name || 'unknown';
        
        if (!browserStats[browserName]) {
          browserStats[browserName] = {
            visitors: 0,
            page_views: 0,
            total_time: 0
          };
        }
        
        browserStats[browserName].visitors++;
        browserStats[browserName].page_views += visitor.page_views || 1;
        browserStats[browserName].total_time += visitor.total_time_spent || 0;
      });

      // Update browser stats table
      for (const [browserName, stats] of Object.entries(browserStats)) {
        const avgTimeSpent = stats.visitors > 0 ? Math.round(stats.total_time / stats.visitors) : 0;

        await this.analyticsEngine.dbRun(`
          INSERT OR REPLACE INTO browser_stats 
          (browser_name, date, visitors, page_views, avg_time_spent)
          VALUES (?, ?, ?, ?, ?)
        `, [browserName, today, stats.visitors, stats.page_views, avgTimeSpent]);
      }

      console.log(`Browser stats processed for ${Object.keys(browserStats).length} browsers`);
    } catch (error) {
      console.error('Error processing browser stats:', error);
    }
  }

  async processLocationStats() {
    if (!this.visitorLogger) {
      console.warn('VisitorLogger not available for location stats processing');
      return;
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const visitors = await this.visitorLogger.getAllVisitors(1000);
      
      // Group by location
      const locationStats = {};
      
      visitors.forEach(visitor => {
        const key = `${visitor.country || 'Unknown'}|${visitor.region || 'Unknown'}|${visitor.city || 'Unknown'}`;
        
        if (!locationStats[key]) {
          locationStats[key] = {
            country: visitor.country || 'Unknown',
            region: visitor.region || 'Unknown',
            city: visitor.city || 'Unknown',
            visitors: 0,
            page_views: 0
          };
        }
        
        locationStats[key].visitors++;
        locationStats[key].page_views += visitor.page_views || 1;
      });

      // Update location stats table
      for (const [key, stats] of Object.entries(locationStats)) {
        await this.analyticsEngine.dbRun(`
          INSERT OR REPLACE INTO location_stats 
          (country, region, city, date, visitors, page_views)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [stats.country, stats.region, stats.city, today, stats.visitors, stats.page_views]);
      }

      console.log(`Location stats processed for ${Object.keys(locationStats).length} locations`);
    } catch (error) {
      console.error('Error processing location stats:', error);
    }
  }

  async processNetworkStats() {
    if (!this.visitorLogger) {
      console.warn('VisitorLogger not available for network stats processing');
      return;
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const visitors = await this.visitorLogger.getAllVisitors(1000);
      
      // Group by network info (simplified)
      const networkStats = {};
      
      visitors.forEach(visitor => {
        const networkType = visitor.network_isp || 'unknown';
        const connectionType = 'unknown'; // Would come from enhanced data
        
        const key = `${networkType}|${connectionType}`;
        
        if (!networkStats[key]) {
          networkStats[key] = {
            network_type: networkType,
            connection_type: connectionType,
            visitors: 0,
            total_latency: 0
          };
        }
        
        networkStats[key].visitors++;
        // Latency would come from enhanced data collection
      });

      // Update network stats table
      for (const [key, stats] of Object.entries(networkStats)) {
        const avgLatency = stats.visitors > 0 ? Math.round(stats.total_latency / stats.visitors) : 0;

        await this.analyticsEngine.dbRun(`
          INSERT OR REPLACE INTO network_stats 
          (network_type, connection_type, date, visitors, avg_latency)
          VALUES (?, ?, ?, ?, ?)
        `, [stats.network_type, stats.connection_type, today, stats.visitors, avgLatency]);
      }

      console.log(`Network stats processed for ${Object.keys(networkStats).length} network types`);
    } catch (error) {
      console.error('Error processing network stats:', error);
    }
  }

  async processReferrerStats() {
    if (!this.visitorLogger) {
      console.warn('VisitorLogger not available for referrer stats processing');
      return;
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const visitors = await this.visitorLogger.getAllVisitors(1000);
      
      // Group by referrer
      const referrerStats = {};
      
      visitors.forEach(visitor => {
        let referrerDomain = 'direct';
        let referrerType = 'direct';
        
        if (visitor.referrer && visitor.referrer !== 'direct') {
          try {
            const url = new URL(visitor.referrer);
            referrerDomain = url.hostname;
            
            // Categorize referrer type
            if (referrerDomain.includes('google')) {
              referrerType = 'search';
            } else if (referrerDomain.includes('facebook') || 
                      referrerDomain.includes('twitter') || 
                      referrerDomain.includes('linkedin')) {
              referrerType = 'social';
            } else {
              referrerType = 'referral';
            }
          } catch (error) {
            referrerDomain = 'invalid_url';
            referrerType = 'unknown';
          }
        }
        
        const key = `${referrerDomain}|${referrerType}`;
        
        if (!referrerStats[key]) {
          referrerStats[key] = {
            referrer_domain: referrerDomain,
            referrer_type: referrerType,
            visitors: 0,
            conversions: 0
          };
        }
        
        referrerStats[key].visitors++;
        // Conversions would be tracked separately
      });

      // Update referrer stats table
      for (const [key, stats] of Object.entries(referrerStats)) {
        await this.analyticsEngine.dbRun(`
          INSERT OR REPLACE INTO referrer_stats 
          (referrer_domain, referrer_type, date, visitors, conversions)
          VALUES (?, ?, ?, ?, ?)
        `, [stats.referrer_domain, stats.referrer_type, today, stats.visitors, stats.conversions]);
      }

      console.log(`Referrer stats processed for ${Object.keys(referrerStats).length} referrers`);
    } catch (error) {
      console.error('Error processing referrer stats:', error);
    }
  }

  async generateReport(days = 7) {
    try {
      const report = await this.analyticsEngine.generateAnalyticsReport(days);
      return report;
    } catch (error) {
      console.error('Error generating report:', error);
      throw error;
    }
  }

  async getRealTimeAnalytics() {
    try {
      const [realTimeStats, performanceMetrics] = await Promise.all([
        this.analyticsEngine.getRealTimeStats(),
        this.analyticsEngine.getPerformanceMetrics()
      ]);

      return {
        realtime: realTimeStats,
        performance: performanceMetrics,
        generated_at: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting real-time analytics:', error);
      throw error;
    }
  }

  async cleanupData(daysToKeep = 90) {
    try {
      const result = await this.analyticsEngine.cleanupOldData(daysToKeep);
      console.log(`Cleaned up ${result.deleted_rows} rows of old analytics data`);
      return result;
    } catch (error) {
      console.error('Error cleaning up data:', error);
      throw error;
    }
  }

  getStatus() {
    return {
      is_processing: this.isProcessing,
      processing_interval: this.processingInterval ? 'active' : 'inactive',
      analytics_engine: 'connected',
      visitor_logger: this.visitorLogger ? 'connected' : 'disconnected',
      last_processing: this.isProcessing ? 'in_progress' : 'idle'
    };
  }

  shutdown() {
    this.stopProcessing();
    this.analyticsEngine.close();
    console.log('Data processor shutdown complete');
  }
}

module.exports = DataProcessor;