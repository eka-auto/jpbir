const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class AnalyticsEngine {
  constructor() {
    this.dbPath = path.join(__dirname, '..', 'data', 'analytics.db');
    this.initializeDatabase();
  }

  initializeDatabase() {
    // Ensure data directory exists
    const fs = require('fs');
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new sqlite3.Database(this.dbPath, (err) => {
      if (err) {
        console.error('Error opening analytics database:', err);
      } else {
        console.log('Connected to Analytics SQLite database');
        this.createAnalyticsTables();
      }
    });
  }

  createAnalyticsTables() {
    const createHourlyStatsTable = `
      CREATE TABLE IF NOT EXISTS hourly_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE,
        hour INTEGER,
        total_visitors INTEGER DEFAULT 0,
        new_visitors INTEGER DEFAULT 0,
        returning_visitors INTEGER DEFAULT 0,
        total_page_views INTEGER DEFAULT 0,
        avg_time_spent INTEGER DEFAULT 0,
        bounce_rate REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(date, hour)
      )
    `;

    const createDailyStatsTable = `
      CREATE TABLE IF NOT EXISTS daily_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date DATE UNIQUE,
        total_visitors INTEGER DEFAULT 0,
        new_visitors INTEGER DEFAULT 0,
        returning_visitors INTEGER DEFAULT 0,
        total_page_views INTEGER DEFAULT 0,
        unique_page_views INTEGER DEFAULT 0,
        avg_session_duration INTEGER DEFAULT 0,
        bounce_rate REAL DEFAULT 0,
        conversion_rate REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createDeviceStatsTable = `
      CREATE TABLE IF NOT EXISTS device_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_type TEXT,
        date DATE,
        visitors INTEGER DEFAULT 0,
        page_views INTEGER DEFAULT 0,
        avg_time_spent INTEGER DEFAULT 0,
        bounce_rate REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(device_type, date)
      )
    `;

    const createBrowserStatsTable = `
      CREATE TABLE IF NOT EXISTS browser_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        browser_name TEXT,
        date DATE,
        visitors INTEGER DEFAULT 0,
        page_views INTEGER DEFAULT 0,
        avg_time_spent INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(browser_name, date)
      )
    `;

    const createLocationStatsTable = `
      CREATE TABLE IF NOT EXISTS location_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        country TEXT,
        region TEXT,
        city TEXT,
        date DATE,
        visitors INTEGER DEFAULT 0,
        page_views INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(country, region, city, date)
      )
    `;

    const createNetworkStatsTable = `
      CREATE TABLE IF NOT EXISTS network_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        network_type TEXT,
        connection_type TEXT,
        date DATE,
        visitors INTEGER DEFAULT 0,
        avg_latency INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(network_type, connection_type, date)
      )
    `;

    const createReferrerStatsTable = `
      CREATE TABLE IF NOT EXISTS referrer_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referrer_domain TEXT,
        referrer_type TEXT,
        date DATE,
        visitors INTEGER DEFAULT 0,
        conversions INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(referrer_domain, date)
      )
    `;

    this.db.serialize(() => {
      this.db.run(createHourlyStatsTable);
      this.db.run(createDailyStatsTable);
      this.db.run(createDeviceStatsTable);
      this.db.run(createBrowserStatsTable);
      this.db.run(createLocationStatsTable);
      this.db.run(createNetworkStatsTable);
      this.db.run(createReferrerStatsTable);
    });
  }

  async updateHourlyStats() {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    const hour = now.getHours();

    try {
      // Get stats for the current hour
      const stats = await this.calculateHourlyStats(date, hour);
      
      const query = `
        INSERT OR REPLACE INTO hourly_stats 
        (date, hour, total_visitors, new_visitors, returning_visitors, 
         total_page_views, avg_time_spent, bounce_rate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await this.dbRun(query, [
        date, hour,
        stats.total_visitors,
        stats.new_visitors,
        stats.returning_visitors,
        stats.total_page_views,
        stats.avg_time_spent,
        stats.bounce_rate
      ]);

      return stats;
    } catch (error) {
      console.error('Error updating hourly stats:', error);
      throw error;
    }
  }

  async updateDailyStats() {
    const today = new Date().toISOString().split('T')[0];

    try {
      const stats = await this.calculateDailyStats(today);
      
      const query = `
        INSERT OR REPLACE INTO daily_stats 
        (date, total_visitors, new_visitors, returning_visitors, 
         total_page_views, unique_page_views, avg_session_duration, 
         bounce_rate, conversion_rate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await this.dbRun(query, [
        today,
        stats.total_visitors,
        stats.new_visitors,
        stats.returning_visitors,
        stats.total_page_views,
        stats.unique_page_views,
        stats.avg_session_duration,
        stats.bounce_rate,
        stats.conversion_rate
      ]);

      return stats;
    } catch (error) {
      console.error('Error updating daily stats:', error);
      throw error;
    }
  }

  async calculateHourlyStats(date, hour) {
    return new Promise((resolve, reject) => {
      const startTime = `${date} ${hour.toString().padStart(2, '0')}:00:00`;
      const endTime = `${date} ${hour.toString().padStart(2, '0')}:59:59`;

      const queries = [
        // Total visitors
        `SELECT COUNT(DISTINCT visitor_id) as count FROM visitors 
         WHERE DATE(last_activity) = ? AND strftime('%H', last_activity) = ?`,
        
        // New visitors (first visit in this hour)
        `SELECT COUNT(*) as count FROM visitors 
         WHERE DATE(initial_timestamp) = ? AND strftime('%H', initial_timestamp) = ?`,
        
        // Total page views
        `SELECT SUM(page_views) as total FROM visitors 
         WHERE DATE(last_activity) = ? AND strftime('%H', last_activity) = ?`,
        
        // Average time spent
        `SELECT AVG(total_time_spent) as avg FROM visitors 
         WHERE DATE(last_activity) = ? AND strftime('%H', last_activity) = ?`,
        
        // Bounce rate (visitors with only 1 page view and < 30 seconds)
        `SELECT COUNT(*) as bounce_count FROM visitors 
         WHERE DATE(last_activity) = ? AND strftime('%H', last_activity) = ? 
         AND page_views = 1 AND total_time_spent < 30`
      ];

      const results = {};
      let completed = 0;

      queries.forEach((query, index) => {
        this.db.get(query, [date, hour], (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          switch(index) {
            case 0: results.total_visitors = row.count; break;
            case 1: results.new_visitors = row.count; break;
            case 2: results.total_page_views = row.total || 0; break;
            case 3: results.avg_time_spent = Math.round(row.avg || 0); break;
            case 4: 
              results.bounce_count = row.bounce_count;
              results.bounce_rate = results.total_visitors > 0 
                ? (row.bounce_count / results.total_visitors * 100).toFixed(2)
                : 0;
              break;
          }

          completed++;
          if (completed === queries.length) {
            results.returning_visitors = results.total_visitors - results.new_visitors;
            resolve(results);
          }
        });
      });
    });
  }

  async calculateDailyStats(date) {
    return new Promise((resolve, reject) => {
      const queries = [
        // Total visitors
        `SELECT COUNT(DISTINCT visitor_id) as count FROM visitors 
         WHERE DATE(last_activity) = ?`,
        
        // New visitors
        `SELECT COUNT(*) as count FROM visitors 
         WHERE DATE(initial_timestamp) = ?`,
        
        // Total page views
        `SELECT SUM(page_views) as total FROM visitors 
         WHERE DATE(last_activity) = ?`,
        
        // Unique page views (visitors with more than 1 page view)
        `SELECT COUNT(DISTINCT visitor_id) as count FROM visitors 
         WHERE DATE(last_activity) = ? AND page_views > 1`,
        
        // Average session duration
        `SELECT AVG(total_time_spent) as avg FROM visitors 
         WHERE DATE(last_activity) = ?`,
        
        // Bounce rate
        `SELECT COUNT(*) as bounce_count FROM visitors 
         WHERE DATE(last_activity) = ? AND page_views = 1 AND total_time_spent < 30`,
        
        // Conversion rate (placeholder - would track specific conversions)
        `SELECT COUNT(*) as conversion_count FROM visitors 
         WHERE DATE(last_activity) = ? AND total_time_spent > 300`
      ];

      const results = {};
      let completed = 0;

      queries.forEach((query, index) => {
        this.db.get(query, [date], (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          switch(index) {
            case 0: results.total_visitors = row.count; break;
            case 1: results.new_visitors = row.count; break;
            case 2: results.total_page_views = row.total || 0; break;
            case 3: results.unique_page_views = row.count; break;
            case 4: results.avg_session_duration = Math.round(row.avg || 0); break;
            case 5: results.bounce_count = row.bounce_count; break;
            case 6: results.conversion_count = row.conversion_count; break;
          }

          completed++;
          if (completed === queries.length) {
            results.returning_visitors = results.total_visitors - results.new_visitors;
            results.bounce_rate = results.total_visitors > 0 
              ? (results.bounce_count / results.total_visitors * 100).toFixed(2)
              : 0;
            results.conversion_rate = results.total_visitors > 0
              ? (results.conversion_count / results.total_visitors * 100).toFixed(2)
              : 0;
            resolve(results);
          }
        });
      });
    });
  }

  async getTrendingData(days = 7) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          date,
          total_visitors,
          new_visitors,
          returning_visitors,
          total_page_views,
          avg_session_duration,
          bounce_rate
        FROM daily_stats
        WHERE date >= date('now', ?)
        ORDER BY date ASC
      `;

      this.db.all(query, [`-${days} days`], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getDeviceAnalytics(days = 30) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          device_type,
          SUM(visitors) as total_visitors,
          SUM(page_views) as total_page_views,
          AVG(avg_time_spent) as avg_time_spent,
          AVG(bounce_rate) as avg_bounce_rate
        FROM device_stats
        WHERE date >= date('now', ?)
        GROUP BY device_type
        ORDER BY total_visitors DESC
      `;

      this.db.all(query, [`-${days} days`], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getBrowserAnalytics(days = 30) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          browser_name,
          SUM(visitors) as total_visitors,
          SUM(page_views) as total_page_views,
          AVG(avg_time_spent) as avg_time_spent
        FROM browser_stats
        WHERE date >= date('now', ?) AND browser_name IS NOT NULL
        GROUP BY browser_name
        ORDER BY total_visitors DESC
        LIMIT 10
      `;

      this.db.all(query, [`-${days} days`], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getGeographicAnalytics(days = 30) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          country,
          region,
          city,
          SUM(visitors) as total_visitors,
          SUM(page_views) as total_page_views
        FROM location_stats
        WHERE date >= date('now', ?) AND country != 'Unknown'
        GROUP BY country, region, city
        ORDER BY total_visitors DESC
        LIMIT 20
      `;

      this.db.all(query, [`-${days} days`], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getNetworkAnalytics(days = 30) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          network_type,
          connection_type,
          SUM(visitors) as total_visitors,
          AVG(avg_latency) as avg_latency
        FROM network_stats
        WHERE date >= date('now', ?) AND network_type IS NOT NULL
        GROUP BY network_type, connection_type
        ORDER BY total_visitors DESC
      `;

      this.db.all(query, [`-${days} days`], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getReferrerAnalytics(days = 30) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          referrer_domain,
          referrer_type,
          SUM(visitors) as total_visitors,
          SUM(conversions) as total_conversions,
          CASE 
            WHEN SUM(visitors) > 0 
            THEN ROUND(SUM(conversions) * 100.0 / SUM(visitors), 2)
            ELSE 0 
          END as conversion_rate
        FROM referrer_stats
        WHERE date >= date('now', ?) AND referrer_domain IS NOT NULL
        GROUP BY referrer_domain, referrer_type
        ORDER BY total_visitors DESC
        LIMIT 15
      `;

      this.db.all(query, [`-${days} days`], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getHourlyTrend(date) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          hour,
          total_visitors,
          new_visitors,
          returning_visitors,
          total_page_views,
          avg_time_spent,
          bounce_rate
        FROM hourly_stats
        WHERE date = ?
        ORDER BY hour ASC
      `;

      this.db.all(query, [date], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getPerformanceMetrics() {
    return new Promise((resolve, reject) => {
      const queries = [
        // Overall performance
        `SELECT 
          AVG(avg_session_duration) as avg_session_duration,
          AVG(bounce_rate) as avg_bounce_rate,
          AVG(conversion_rate) as avg_conversion_rate
         FROM daily_stats 
         WHERE date >= date('now', '-30 days')`,
        
        // Growth metrics
        `SELECT 
          COUNT(DISTINCT date) as days_tracked,
          SUM(total_visitors) as total_visitors_30d,
          SUM(total_page_views) as total_page_views_30d
         FROM daily_stats 
         WHERE date >= date('now', '-30 days')`,
        
        // Peak hour
        `SELECT 
          hour,
          MAX(total_visitors) as max_visitors
         FROM hourly_stats 
         WHERE date >= date('now', '-7 days')
         GROUP BY hour
         ORDER BY max_visitors DESC
         LIMIT 1`
      ];

      const results = {};
      let completed = 0;

      queries.forEach((query, index) => {
        this.db.get(query, [], (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          switch(index) {
            case 0: 
              results.performance = row;
              break;
            case 1:
              results.growth = row;
              break;
            case 2:
              results.peak_hour = row;
              break;
          }

          completed++;
          if (completed === queries.length) {
            resolve(results);
          }
        });
      });
    });
  }

  async getRealTimeStats() {
    const now = new Date();
    const currentHour = now.getHours();
    const today = now.toISOString().split('T')[0];

    return new Promise((resolve, reject) => {
      const queries = [
        // Visitors in current hour
        `SELECT COUNT(DISTINCT visitor_id) as current_hour_visitors 
         FROM visitors 
         WHERE DATE(last_activity) = ? AND strftime('%H', last_activity) = ?`,
        
        // Active sessions (last 5 minutes)
        `SELECT COUNT(DISTINCT visitor_id) as active_sessions 
         FROM visitors 
         WHERE datetime(last_activity) >= datetime('now', '-5 minutes')`,
        
        // Today's total
        `SELECT COUNT(DISTINCT visitor_id) as today_total 
         FROM visitors 
         WHERE DATE(last_activity) = ?`
      ];

      const results = {};
      let completed = 0;

      queries.forEach((query, index) => {
        const params = index === 0 ? [today, currentHour.toString().padStart(2, '0')] : 
                      index === 2 ? [today] : [];

        this.db.get(query, params, (err, row) => {
          if (err) {
            reject(err);
            return;
          }

          switch(index) {
            case 0: results.current_hour_visitors = row.current_hour_visitors; break;
            case 1: results.active_sessions = row.active_sessions; break;
            case 2: results.today_total = row.today_total; break;
          }

          completed++;
          if (completed === queries.length) {
            resolve(results);
          }
        });
      });
    });
  }

  async generateAnalyticsReport(days = 7) {
    const [
      trendingData,
      deviceAnalytics,
      browserAnalytics,
      geographicAnalytics,
      networkAnalytics,
      referrerAnalytics,
      performanceMetrics,
      realTimeStats
    ] = await Promise.all([
      this.getTrendingData(days),
      this.getDeviceAnalytics(days),
      this.getBrowserAnalytics(days),
      this.getGeographicAnalytics(days),
      this.getNetworkAnalytics(days),
      this.getReferrerAnalytics(days),
      this.getPerformanceMetrics(),
      this.getRealTimeStats()
    ]);

    return {
      report_date: new Date().toISOString(),
      period_days: days,
      summary: {
        total_days: trendingData.length,
        total_visitors: trendingData.reduce((sum, day) => sum + day.total_visitors, 0),
        total_page_views: trendingData.reduce((sum, day) => sum + day.total_page_views, 0),
        avg_session_duration: performanceMetrics.performance?.avg_session_duration || 0,
        avg_bounce_rate: performanceMetrics.performance?.avg_bounce_rate || 0
      },
      trending: trendingData,
      devices: deviceAnalytics,
      browsers: browserAnalytics,
      geography: geographicAnalytics,
      networks: networkAnalytics,
      referrers: referrerAnalytics,
      performance: performanceMetrics,
      realtime: realTimeStats,
      insights: this.generateInsights(
        trendingData,
        deviceAnalytics,
        browserAnalytics,
        geographicAnalytics,
        performanceMetrics
      )
    };
  }

  generateInsights(trending, devices, browsers, geography, performance) {
    const insights = [];

    // Traffic trend insight
    if (trending.length >= 2) {
      const lastDay = trending[trending.length - 1];
      const prevDay = trending[trending.length - 2];
      
      const growth = lastDay.total_visitors - prevDay.total_visitors;
      const growthPercent = prevDay.total_visitors > 0 
        ? (growth / prevDay.total_visitors * 100).toFixed(1)
        : 100;

      if (Math.abs(growthPercent) > 10) {
        insights.push({
          type: 'traffic_trend',
          message: `Traffic ${growth > 0 ? 'increased' : 'decreased'} by ${Math.abs(growthPercent)}% compared to previous day`,
          direction: growth > 0 ? 'up' : 'down',
          value: Math.abs(growthPercent)
        });
      }
    }

    // Device insight
    if (devices.length > 0) {
      const topDevice = devices[0];
      const mobileDevices = devices.filter(d => d.device_type.toLowerCase().includes('mobile'));
      const mobilePercentage = mobileDevices.length > 0
        ? (mobileDevices.reduce((sum, d) => sum + d.total_visitors, 0) / 
           devices.reduce((sum, d) => sum + d.total_visitors, 0) * 100).toFixed(1)
        : 0;

      if (mobilePercentage > 50) {
        insights.push({
          type: 'device_distribution',
          message: `Mobile traffic dominates (${mobilePercentage}% of all visits)`,
          recommendation: 'Ensure mobile-optimized experience'
        });
      }
    }

    // Bounce rate insight
    const avgBounceRate = performance.performance?.avg_bounce_rate || 0;
    if (avgBounceRate > 70) {
      insights.push({
        type: 'engagement_alert',
        message: `High bounce rate detected (${avgBounceRate.toFixed(1)}%)`,
        severity: 'high',
        recommendation: 'Review landing page content and load times'
      });
    }

    // Geographic insight
    if (geography.length > 0) {
      const topCountry = geography[0];
      if (topCountry.total_visitors > 100) {
        insights.push({
          type: 'geographic_concentration',
          message: `Majority of traffic from ${topCountry.country} (${topCountry.total_visitors} visitors)`,
          country: topCountry.country
        });
      }
    }

    // Session duration insight
    const avgSessionDuration = performance.performance?.avg_session_duration || 0;
    if (avgSessionDuration < 60) {
      insights.push({
        type: 'engagement_opportunity',
        message: `Average session duration is ${avgSessionDuration}s`,
        recommendation: 'Consider adding more engaging content'
      });
    }

    return insights;
  }

  async cleanupOldData(daysToKeep = 90) {
    return new Promise((resolve, reject) => {
      const query = `
        DELETE FROM hourly_stats 
        WHERE date < date('now', ?)
      `;

      this.db.run(query, [`-${daysToKeep} days`], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve({ deleted_rows: this.changes });
        }
      });
    });
  }

  dbRun(query, params) {
    return new Promise((resolve, reject) => {
      this.db.run(query, params, function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this);
        }
      });
    });
  }

  close() {
    this.db.close((err) => {
      if (err) {
        console.error('Error closing analytics database:', err);
      } else {
        console.log('Analytics database connection closed');
      }
    });
  }
}

module.exports = AnalyticsEngine;