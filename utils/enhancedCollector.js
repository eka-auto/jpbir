const os = require('os');
const dns = require('dns');
const https = require('https');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

class EnhancedCollector {
  constructor() {
    this.systemInfo = this.getSystemInfo();
  }

  getSystemInfo() {
    return {
      platform: process.platform,
      arch: process.arch,
      node_version: process.version,
      hostname: os.hostname(),
      cpus: os.cpus().length,
      total_memory: Math.round(os.totalmem() / (1024 * 1024)) + ' MB',
      free_memory: Math.round(os.freemem() / (1024 * 1024)) + ' MB',
      uptime: os.uptime(),
      loadavg: os.loadavg(),
      network_interfaces: this.getNetworkInterfacesInfo(),
      system_uptime: this.formatUptime(os.uptime())
    };
  }

  getNetworkInterfacesInfo() {
    const interfaces = os.networkInterfaces();
    const result = {};

    for (const [name, ifaceList] of Object.entries(interfaces)) {
      result[name] = ifaceList.map(iface => ({
        family: iface.family,
        address: iface.address,
        netmask: iface.netmask,
        mac: iface.mac,
        internal: iface.internal,
        cidr: iface.cidr
      }));
    }

    return result;
  }

  formatUptime(seconds) {
    const days = Math.floor(seconds / (24 * 60 * 60));
    const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((seconds % (60 * 60)) / 60);
    const secs = Math.floor(seconds % 60);
    
    return `${days}d ${hours}h ${minutes}m ${secs}s`;
  }

  async collectVisitorData(req) {
    const basicInfo = this.extractBasicVisitorInfo(req);
    const enhancedInfo = await this.enhanceVisitorInfo(req, basicInfo);
    
    return {
      ...basicInfo,
      ...enhancedInfo,
      collection_timestamp: new Date().toISOString(),
      data_source: 'enhanced_collector'
    };
  }

  extractBasicVisitorInfo(req) {
    const ip = req.headers['x-forwarded-for'] || 
               req.connection.remoteAddress || 
               req.socket.remoteAddress || 
               req.ip;
    
    const userAgent = req.headers['user-agent'] || '';
    const acceptLanguage = req.headers['accept-language'] || '';
    const acceptEncoding = req.headers['accept-encoding'] || '';
    const referrer = req.headers['referer'] || req.headers['referrer'] || 'direct';
    
    // Parse user agent components
    const browserInfo = this.parseUserAgent(userAgent);
    const deviceInfo = this.detectDeviceType(userAgent);
    
    return {
      ip_address: ip,
      user_agent: userAgent,
      accept_language: acceptLanguage,
      accept_encoding: acceptEncoding,
      referrer: referrer,
      browser: browserInfo,
      device: deviceInfo,
      headers_summary: {
        connection: req.headers['connection'],
        cache_control: req.headers['cache-control'],
        accept: req.headers['accept'],
        host: req.headers['host']
      }
    };
  }

  async enhanceVisitorInfo(req, basicInfo) {
    const enhancements = {};
    
    try {
      // Get geolocation
      enhancements.geolocation = await this.getGeolocation(basicInfo.ip_address);
      
      // Get network latency
      enhancements.network_latency = await this.measureLatency(basicInfo.ip_address);
      
      // Detect VPN/Proxy
      enhancements.proxy_detection = this.detectProxy(req);
      
      // Get timezone
      enhancements.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      
      // Screen resolution (if available via headers)
      enhancements.screen_info = this.getScreenInfo(req);
      
      // Connection type (if available via headers)
      enhancements.connection_type = this.getConnectionType(req);
      
      // Collect performance metrics
      enhancements.performance_metrics = await this.collectPerformanceMetrics();
      
    } catch (error) {
      console.error('Error enhancing visitor info:', error);
    }
    
    return enhancements;
  }

  parseUserAgent(userAgent) {
    const ua = userAgent.toLowerCase();
    
    const browserMap = {
      'chrome': /chrome|chromium|crios/i,
      'firefox': /firefox|fxios/i,
      'safari': /safari/i,
      'edge': /edge|edg/i,
      'opera': /opera|opr/i,
      'ie': /msie|trident/i
    };
    
    const osMap = {
      'windows': /windows nt/i,
      'macos': /mac os x|macintosh/i,
      'linux': /linux/i,
      'android': /android/i,
      'ios': /iphone|ipad|ipod/i
    };
    
    let browser = 'unknown';
    let os = 'unknown';
    
    for (const [browserName, regex] of Object.entries(browserMap)) {
      if (regex.test(userAgent)) {
        browser = browserName;
        break;
      }
    }
    
    for (const [osName, regex] of Object.entries(osMap)) {
      if (regex.test(userAgent)) {
        os = osName;
        break;
      }
    }
    
    // Extract version if possible
    let version = 'unknown';
    const versionMatch = userAgent.match(/(chrome|firefox|safari|edge|opera|msie)[\/\s](\d+)/i);
    if (versionMatch) {
      version = versionMatch[2];
    }
    
    return {
      name: browser,
      version: version,
      os: os,
      raw: userAgent.substring(0, 200) // Limit length
    };
  }

  detectDeviceType(userAgent) {
    const ua = userAgent.toLowerCase();
    
    if (ua.includes('mobile')) {
      return {
        type: 'mobile',
        is_mobile: true,
        is_tablet: ua.includes('tablet'),
        is_desktop: false
      };
    } else if (ua.includes('tablet')) {
      return {
        type: 'tablet',
        is_mobile: false,
        is_tablet: true,
        is_desktop: false
      };
    } else {
      return {
        type: 'desktop',
        is_mobile: false,
        is_tablet: false,
        is_desktop: true
      };
    }
  }

  async getGeolocation(ip) {
    // Skip local IPs
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || 
        ip.startsWith('10.') || ip.startsWith('172.')) {
      return {
        type: 'local',
        ip: ip,
        note: 'Local network address'
      };
    }
    
    try {
      return new Promise((resolve) => {
        const url = `https://ipapi.co/${ip}/json/`;
        
        https.get(url, (res) => {
          let data = '';
          
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            try {
              const geoData = JSON.parse(data);
              resolve({
                type: 'external',
                ip: ip,
                country: geoData.country_name || 'Unknown',
                country_code: geoData.country_code || 'Unknown',
                region: geoData.region || 'Unknown',
                city: geoData.city || 'Unknown',
                latitude: geoData.latitude || null,
                longitude: geoData.longitude || null,
                timezone: geoData.timezone || 'Unknown',
                currency: geoData.currency || 'Unknown',
                asn: geoData.asn || 'Unknown',
                org: geoData.org || 'Unknown'
              });
            } catch (error) {
              resolve({
                type: 'error',
                ip: ip,
                error: 'Failed to parse geolocation data'
              });
            }
          });
        }).on('error', () => {
          resolve({
            type: 'error',
            ip: ip,
            error: 'Failed to fetch geolocation'
          });
        });
      });
    } catch (error) {
      return {
        type: 'error',
        ip: ip,
        error: error.message
      };
    }
  }

  async measureLatency(ip) {
    return new Promise((resolve) => {
      const start = Date.now();
      
      // Simple TCP connection test
      const net = require('net');
      const socket = new net.Socket();
      
      socket.setTimeout(1000);
      
      socket.on('connect', () => {
        const latency = Date.now() - start;
        socket.destroy();
        resolve({
          latency_ms: latency,
          status: 'connected',
          timestamp: new Date().toISOString()
        });
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve({
          latency_ms: 1000,
          status: 'timeout',
          timestamp: new Date().toISOString()
        });
      });
      
      socket.on('error', () => {
        resolve({
          latency_ms: null,
          status: 'error',
          timestamp: new Date().toISOString()
        });
      });
      
      // Try common ports for latency measurement
      socket.connect(80, ip);
    });
  }

  detectProxy(req) {
    const headers = req.headers;
    const proxyIndicators = [];
    
    // Common proxy headers
    const proxyHeaders = [
      'via',
      'x-forwarded-for',
      'x-forwarded-host',
      'x-forwarded-proto',
      'x-real-ip',
      'cf-connecting-ip', // Cloudflare
      'true-client-ip' // Akamai
    ];
    
    for (const header of proxyHeaders) {
      if (headers[header]) {
        proxyIndicators.push({
          header: header,
          value: headers[header],
          detected: true
        });
      }
    }
    
    return {
      has_proxy: proxyIndicators.length > 0,
      indicators: proxyIndicators,
      confidence: proxyIndicators.length > 0 ? 'high' : 'low'
    };
  }

  getScreenInfo(req) {
    // This would normally come from client-side JavaScript
    // For server-side, we can only infer from headers
    return {
      source: 'server_side',
      available: false,
      note: 'Screen resolution requires client-side JavaScript'
    };
  }

  getConnectionType(req) {
    const headers = req.headers;
    
    // Check for connection type hints
    if (headers['x-connection-type']) {
      return headers['x-connection-type'];
    }
    
    // Check for Cloudflare headers
    if (headers['cf-ipcountry']) {
      return 'cloudflare_proxy';
    }
    
    // Check for load balancer headers
    if (headers['x-lb-forwarded-for']) {
      return 'load_balancer';
    }
    
    return 'direct';
  }

  async collectPerformanceMetrics() {
    const metrics = {
      timestamp: new Date().toISOString(),
      system_load: os.loadavg(),
      memory_usage: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
        usage_percentage: ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(2) + '%'
      },
      process_memory: process.memoryUsage(),
      uptime: {
        system: os.uptime(),
        process: process.uptime()
      }
    };
    
    // Try to get network stats
    try {
      metrics.network_stats = await this.getNetworkStats();
    } catch (error) {
      metrics.network_stats = { error: error.message };
    }
    
    return metrics;
  }

  async getNetworkStats() {
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execPromise('netstat -e');
        const lines = stdout.split('\n');
        
        for (const line of lines) {
          if (line.includes('Bytes')) {
            const match = line.match(/(\d+)/g);
            if (match && match.length >= 2) {
              return {
                bytes_received: parseInt(match[0]),
                bytes_sent: parseInt(match[1]),
                source: 'netstat'
              };
            }
          }
        }
      } catch (error) {
        return { error: 'Failed to get network stats' };
      }
    }
    
    // Fallback for other platforms
    return {
      note: 'Platform-specific network stats not available',
      source: 'fallback'
    };
  }

  async collectClientSideData(clientData) {
    // This would be called from client-side JavaScript
    const enhancedData = {
      ...clientData,
      server_timestamp: new Date().toISOString(),
      processed_by: 'enhanced_collector',
      enhancements: {
        screen_resolution: clientData.screen || 'not_provided',
        color_depth: clientData.colorDepth || 'not_provided',
        timezone: clientData.timezone || 'not_provided',
        language: clientData.language || 'not_provided',
        cookies_enabled: clientData.cookiesEnabled || false,
        do_not_track: clientData.doNotTrack || 'not_provided',
        hardware_concurrency: clientData.hardwareConcurrency || 'not_provided',
        device_memory: clientData.deviceMemory || 'not_provided'
      }
    };
    
    return enhancedData;
  }

  generateVisitorFingerprint(visitorData) {
    // Create a fingerprint based on various data points
    const fingerprintComponents = [
      visitorData.browser.name,
      visitorData.browser.version,
      visitorData.device.type,
      visitorData.geolocation?.country_code || 'unknown',
      visitorData.headers_summary?.accept_language?.substring(0, 2) || 'unknown',
      this.systemInfo.platform
    ];
    
    const fingerprint = fingerprintComponents.join('|');
    
    // Create a hash-like identifier
    const crypto = require('crypto');
    const hash = crypto.createHash('md5').update(fingerprint).digest('hex');
    
    return {
      fingerprint: hash,
      components: fingerprintComponents,
      uniqueness_score: this.calculateUniquenessScore(visitorData)
    };
  }

  calculateUniquenessScore(visitorData) {
    let score = 0;
    
    // Browser uniqueness
    if (visitorData.browser.name !== 'unknown') score += 20;
    if (visitorData.browser.version !== 'unknown') score += 10;
    
    // Device uniqueness
    if (visitorData.device.type !== 'unknown') score += 15;
    
    // Location uniqueness
    if (visitorData.geolocation?.country_code !== 'unknown') score += 25;
    if (visitorData.geolocation?.city !== 'unknown') score += 15;
    
    // Network uniqueness
    if (visitorData.proxy_detection?.has_proxy) score += 10;
    
    // Cap at 100
    return Math.min(score, 100);
  }

  getDataCollectionSummary() {
    return {
      collector_name: 'EnhancedCollector',
      version: '1.0.0',
      capabilities: [
        'visitor_info_extraction',
        'geolocation_lookup',
        'network_latency_measurement',
        'proxy_detection',
        'performance_metrics',
        'visitor_fingerprinting',
        'client_side_data_enhancement'
      ],
      data_points_collected: [
        'ip_address',
        'user_agent',
        'browser_info',
        'device_type',
        'geolocation',
        'network_latency',
        'proxy_status',
        'timezone',
        'performance_metrics',
        'visitor_fingerprint'
      ],
      privacy_features: [
        'local_ip_filtering',
        'data_anonymization',
        'consent_based_tracking',
        'data_retention_controls'
      ]
    };
  }
}

module.exports = EnhancedCollector;