const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const useragent = require('useragent');
const geoip = require('geoip-lite');
const { v4: uuidv4 } = require('uuid');

class VisitorLogger {
  constructor() {
    this.dbPath = path.join(__dirname, '..', 'data', 'visitors.db');
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
        console.error('Error opening database:', err);
      } else {
        console.log('Connected to SQLite database');
        this.createTables();
      }
    });
  }

  createTables() {
    const createVisitorsTable = `
      CREATE TABLE IF NOT EXISTS visitors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        visitor_id TEXT UNIQUE,
        ip_address TEXT,
        user_agent TEXT,
        browser_name TEXT,
        browser_version TEXT,
        os_name TEXT,
        os_version TEXT,
        device_type TEXT,
        country TEXT,
        region TEXT,
        city TEXT,
        timezone TEXT,
        latitude REAL,
        longitude REAL,
        network_isp TEXT,
        referrer TEXT,
        initial_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
        total_time_spent INTEGER DEFAULT 0,
        page_views INTEGER DEFAULT 1,
        session_active BOOLEAN DEFAULT 1
      )
    `;

    const createNetworkInfoTable = `
      CREATE TABLE IF NOT EXISTS network_info (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        visitor_id TEXT,
        ip_address TEXT,
        network_type TEXT,
        bandwidth_estimate TEXT,
        connection_type TEXT,
        public_ip TEXT,
        local_ip TEXT,
        collected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (visitor_id) REFERENCES visitors(visitor_id)
      )
    `;

    const createActivityLogTable = `
      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        visitor_id TEXT,
        action_type TEXT,
        page_url TEXT,
        action_data TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (visitor_id) REFERENCES visitors(visitor_id)
      )
    `;

    this.db.serialize(() => {
      this.db.run(createVisitorsTable);
      this.db.run(createNetworkInfoTable);
      this.db.run(createActivityLogTable);
    });
  }

  extractVisitorInfo(req) {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip;
    const userAgent = req.headers['user-agent'] || '';
    const referrer = req.headers['referer'] || req.headers['referrer'] || 'direct';
    
    // Parse user agent
    const agent = useragent.parse(userAgent);
    
    // Get geolocation data
    const geo = geoip.lookup(ip) || {};
    
    // Determine device type
    let deviceType = 'desktop';
    if (userAgent.includes('Mobile')) deviceType = 'mobile';
    if (userAgent.includes('Tablet')) deviceType = 'tablet';
    
    return {
      ip_address: ip,
      user_agent: userAgent,
      browser_name: agent.family,
      browser_version: agent.major,
      os_name: agent.os.family,
      os_version: agent.os.major,
      device_type: deviceType,
      country: geo.country || 'Unknown',
      region: geo.region || 'Unknown',
      city: geo.city || 'Unknown',
      timezone: geo.timezone || 'Unknown',
      latitude: geo.ll ? geo.ll[0] : null,
      longitude: geo.ll ? geo.ll[1] : null,
      referrer: referrer
    };
  }

  logVisitor(req, additionalData = {}) {
    return new Promise((resolve, reject) => {
      const visitorInfo = this.extractVisitorInfo(req);
      const visitorId = uuidv4();
      
      const {
        ip_address, user_agent, browser_name, browser_version,
        os_name, os_version, device_type, country, region, city,
        timezone, latitude, longitude, referrer
      } = visitorInfo;

      const query = `
        INSERT OR REPLACE INTO visitors (
          visitor_id, ip_address, user_agent, browser_name, browser_version,
          os_name, os_version, device_type, country, region, city,
          timezone, latitude, longitude, network_isp, referrer,
          last_activity, session_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(query, [
        visitorId, ip_address, user_agent, browser_name, browser_version,
        os_name, os_version, device_type, country, region, city,
        timezone, latitude, longitude, additionalData.network_isp || 'Unknown', referrer,
        new Date().toISOString(), 1
      ], function(err) {
        if (err) {
          console.error('Error logging visitor:', err);
          reject(err);
        } else {
          resolve({
            visitor_id: visitorId,
            ...visitorInfo,
            ...additionalData
          });
        }
      });
    });
  }

  logNetworkInfo(visitorId, networkData) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO network_info (
          visitor_id, ip_address, network_type, bandwidth_estimate,
          connection_type, public_ip, local_ip
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      this.db.run(query, [
        visitorId,
        networkData.ip_address,
        networkData.network_type || 'unknown',
        networkData.bandwidth_estimate || 'unknown',
        networkData.connection_type || 'unknown',
        networkData.public_ip || networkData.ip_address,
        networkData.local_ip || 'unknown'
      ], function(err) {
        if (err) {
          console.error('Error logging network info:', err);
          reject(err);
        } else {
          resolve({ success: true, network_id: this.lastID });
        }
      });
    });
  }

  updateVisitorActivity(visitorId, timeSpent = 0) {
    return new Promise((resolve, reject) => {
      const query = `
        UPDATE visitors 
        SET last_activity = ?, total_time_spent = total_time_spent + ?, 
            page_views = page_views + 1
        WHERE visitor_id = ?
      `;

      this.db.run(query, [
        new Date().toISOString(),
        timeSpent,
        visitorId
      ], function(err) {
        if (err) {
          console.error('Error updating visitor activity:', err);
          reject(err);
        } else {
          resolve({ success: true, changes: this.changes });
        }
      });
    });
  }

  logActivity(visitorId, actionType, pageUrl, actionData = {}) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO activity_log (visitor_id, action_type, page_url, action_data)
        VALUES (?, ?, ?, ?)
      `;

      this.db.run(query, [
        visitorId,
        actionType,
        pageUrl,
        JSON.stringify(actionData)
      ], function(err) {
        if (err) {
          console.error('Error logging activity:', err);
          reject(err);
        } else {
          resolve({ success: true, log_id: this.lastID });
        }
      });
    });
  }

  getVisitorStats(visitorId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM visitors WHERE visitor_id = ?
      `;

      this.db.get(query, [visitorId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  getAllVisitors(limit = 100) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM visitors 
        ORDER BY last_activity DESC 
        LIMIT ?
      `;

      this.db.all(query, [limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  getTotalVisitors() {
    return new Promise((resolve, reject) => {
      const query = `SELECT COUNT(*) as count FROM visitors`;
      
      this.db.get(query, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row.count);
        }
      });
    });
  }

  getNetworkInfo(visitorId) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM network_info 
        WHERE visitor_id = ? 
        ORDER BY collected_at DESC 
        LIMIT 10
      `;

      this.db.all(query, [visitorId], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  getActivityLog(visitorId, limit = 50) {
    return new Promise((resolve, reject) => {
      const query = `
        SELECT * FROM activity_log 
        WHERE visitor_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
      `;

      this.db.all(query, [visitorId, limit], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  getAnalyticsSummary() {
    return new Promise((resolve, reject) => {
      const queries = [
        `SELECT COUNT(*) as total_visitors FROM visitors`,
        `SELECT COUNT(*) as active_sessions FROM visitors WHERE session_active = 1`,
        `SELECT AVG(total_time_spent) as avg_time_spent FROM visitors`,
        `SELECT browser_name, COUNT(*) as count FROM visitors GROUP BY browser_name ORDER BY count DESC LIMIT 5`,
        `SELECT os_name, COUNT(*) as count FROM visitors GROUP BY os_name ORDER BY count DESC LIMIT 5`,
        `SELECT country, COUNT(*) as count FROM visitors WHERE country != 'Unknown' GROUP BY country ORDER BY count DESC LIMIT 10`,
        `SELECT device_type, COUNT(*) as count FROM visitors GROUP BY device_type ORDER BY count DESC`
      ];

      const results = {};
      let completed = 0;
      const totalQueries = queries.length;

      queries.forEach((query, index) => {
        this.db.get(query, (err, row) => {
          if (err) {
            console.error(`Error executing query ${index}:`, err);
          } else {
            const key = query.split(' ')[2]; // Extract key from query
            results[key] = row;
          }
          
          completed++;
          if (completed === totalQueries) {
            resolve(results);
          }
        });
      });
    });
  }

  close() {
    this.db.close((err) => {
      if (err) {
        console.error('Error closing database:', err);
      } else {
        console.log('Database connection closed');
      }
    });
  }
}

module.exports = VisitorLogger;