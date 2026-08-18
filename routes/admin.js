const express = require('express');
const router = express.Router();

// Simple authentication middleware (for demo purposes)
const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  // For demo, accept any authorization header
  // In production, use proper authentication
  if (authHeader) {
    next();
  } else {
    res.status(401).json({ 
      success: false, 
      error: 'Unauthorized. Admin access required.' 
    });
  }
};

module.exports = (visitorLogger, networkScanner) => {
  // Apply authentication to all admin routes
  router.use(authenticateAdmin);

  // Get all visitors with pagination
  router.get('/visitors', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const page = parseInt(req.query.page) || 1;
      const offset = (page - 1) * limit;
      
      const visitors = await visitorLogger.getAllVisitors(limit);
      
      res.json({
        success: true,
        page: page,
        limit: limit,
        total: await visitorLogger.getTotalVisitors(),
        visitors: visitors
      });
    } catch (error) {
      console.error('Error getting visitors:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to retrieve visitors' 
      });
    }
  });

  // Get detailed analytics summary
  router.get('/analytics/summary', async (req, res) => {
    try {
      const summary = await visitorLogger.getAnalyticsSummary();
      
      res.json({
        success: true,
        summary: summary,
        generated_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting analytics summary:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to retrieve analytics summary' 
      });
    }
  });

  // Get specific visitor details
  router.get('/visitors/:visitor_id', async (req, res) => {
    try {
      const { visitor_id } = req.params;
      
      const [visitorStats, networkInfo, activityLog] = await Promise.all([
        visitorLogger.getVisitorStats(visitor_id),
        visitorLogger.getNetworkInfo(visitor_id),
        visitorLogger.getActivityLog(visitor_id, 100)
      ]);

      if (!visitorStats) {
        return res.status(404).json({ 
          success: false, 
          error: 'Visitor not found' 
        });
      }

      res.json({
        success: true,
        visitor: visitorStats,
        network_info: networkInfo,
        activity_log: activityLog
      });
    } catch (error) {
      console.error('Error getting visitor details:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to retrieve visitor details' 
      });
    }
  });

  // Get network scan results
  router.get('/network/scan', async (req, res) => {
    try {
      const devices = await networkScanner.scanLocalNetwork();
      const localNetwork = networkScanner.getLocalNetworkDetails();
      const publicIP = await networkScanner.getPublicIP();
      const networkSpeed = await networkScanner.getNetworkSpeed();

      res.json({
        success: true,
        scan_timestamp: new Date().toISOString(),
        total_devices: devices.length,
        local_network: localNetwork,
        public_ip: publicIP,
        network_speed: networkSpeed,
        discovered_devices: devices
      });
    } catch (error) {
      console.error('Error scanning network:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to scan network' 
      });
    }
  });

  // Get current network status
  router.get('/network/status', async (req, res) => {
    try {
      const devices = networkScanner.getDiscoveredDevices();
      const localNetwork = networkScanner.getLocalNetworkDetails();
      const publicIP = await networkScanner.getPublicIP();

      res.json({
        success: true,
        status_timestamp: new Date().toISOString(),
        network_status: 'online',
        local_network: localNetwork,
        public_ip: publicIP,
        discovered_devices_count: devices.length,
        recently_discovered: devices.slice(0, 10)
      });
    } catch (error) {
      console.error('Error getting network status:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to get network status' 
      });
    }
  });

  // Search for specific devices by IP or hostname
  router.get('/network/search', async (req, res) => {
    try {
      const { query, search_type = 'ip' } = req.query;
      
      if (!query) {
        return res.status(400).json({ 
          success: false, 
          error: 'Search query is required' 
        });
      }

      const devices = networkScanner.getDiscoveredDevices();
      let results = [];

      if (search_type === 'ip') {
        results = devices.filter(device => 
          device.ip.includes(query) || 
          device.ip === query
        );
      } else if (search_type === 'hostname') {
        results = devices.filter(device => 
          device.hostname.toLowerCase().includes(query.toLowerCase())
        );
      } else if (search_type === 'mac') {
        results = devices.filter(device => 
          device.mac_address.toLowerCase().includes(query.toLowerCase())
        );
      } else if (search_type === 'port') {
        const port = parseInt(query);
        results = devices.filter(device => 
          device.open_ports.some(p => p.port === port)
        );
      }

      res.json({
        success: true,
        query: query,
        search_type: search_type,
        results_found: results.length,
        results: results
      });
    } catch (error) {
      console.error('Error searching devices:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to search devices' 
      });
    }
  });

  // Get device connection help/suggestions
  router.post('/network/connect-help', async (req, res) => {
    try {
      const { target_ip, target_port, device_type } = req.body;
      
      if (!target_ip) {
        return res.status(400).json({ 
          success: false, 
          error: 'Target IP is required' 
        });
      }

      const suggestions = [];
      const commonProtocols = {
        22: { name: 'SSH', command: `ssh user@${target_ip}`, description: 'Secure Shell for remote access' },
        80: { name: 'HTTP', url: `http://${target_ip}`, description: 'Web interface' },
        443: { name: 'HTTPS', url: `https://${target_ip}`, description: 'Secure web interface' },
        3389: { name: 'RDP', command: `mstsc /v:${target_ip}`, description: 'Windows Remote Desktop' },
        21: { name: 'FTP', command: `ftp ${target_ip}`, description: 'File Transfer Protocol' },
        23: { name: 'Telnet', command: `telnet ${target_ip}`, description: 'Telnet remote access' }
      };

      // Check if target is online
      const isOnline = await networkScanner.pingDevice(target_ip);
      
      if (!isOnline) {
        suggestions.push({
          type: 'warning',
          message: `Device at ${target_ip} appears to be offline`,
          action: 'Check device power and network connection'
        });
      }

      // If port is specified, provide specific connection help
      if (target_port) {
        const protocol = commonProtocols[target_port];
        if (protocol) {
          suggestions.push({
            type: 'connection',
            protocol: protocol.name,
            description: protocol.description,
            connection_method: protocol.command || protocol.url,
            port: target_port
          });
        } else {
          suggestions.push({
            type: 'generic',
            message: `Port ${target_port} is open on ${target_ip}`,
            action: `Try connecting with appropriate client software on port ${target_port}`
          });
        }
      }

      // Device type specific suggestions
      if (device_type) {
        const deviceSuggestions = {
          'router': [
            'Try accessing the web interface at http://192.168.1.1 or http://192.168.0.1',
            'Default credentials are often admin/admin or admin/password',
            'Check the physical label on the router for default login information'
          ],
          'printer': [
            'Try accessing the web interface at http://[printer-ip]',
            'Install printer drivers from manufacturer website',
            'Use Add Printer wizard in Windows or System Preferences on Mac'
          ],
          'nas': [
            'Access web interface for configuration',
            'Use SMB/AFP/NFS protocols for file sharing',
            'Check manufacturer documentation for specific access methods'
          ],
          'smart_tv': [
            'Ensure TV is on same network',
            'Use manufacturer\'s app for control',
            'Check for DLNA/UPnP services'
          ]
        };

        if (deviceSuggestions[device_type]) {
          suggestions.push({
            type: 'device_specific',
            device_type: device_type,
            suggestions: deviceSuggestions[device_type]
          });
        }
      }

      // General network connectivity suggestions
      suggestions.push({
        type: 'general',
        message: 'General network troubleshooting',
        suggestions: [
          'Ensure both devices are on the same network',
          'Check firewall settings on both devices',
          'Verify IP address configuration',
          'Try pinging the device to confirm connectivity'
        ]
      });

      res.json({
        success: true,
        target_ip: target_ip,
        is_online: isOnline,
        connection_suggestions: suggestions,
        scan_recommended: !isOnline
      });
    } catch (error) {
      console.error('Error generating connection help:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to generate connection help' 
      });
    }
  });

  // Export visitor data (CSV format)
  router.get('/export/visitors', async (req, res) => {
    try {
      const visitors = await visitorLogger.getAllVisitors(1000);
      
      // Convert to CSV
      const headers = ['visitor_id', 'ip_address', 'browser_name', 'os_name', 'device_type', 
                      'country', 'city', 'initial_timestamp', 'last_activity', 
                      'total_time_spent', 'page_views'];
      
      let csv = headers.join(',') + '\n';
      
      visitors.forEach(visitor => {
        const row = headers.map(header => {
          const value = visitor[header];
          // Escape commas and quotes in CSV
          return `"${(value || '').toString().replace(/"/g, '""')}"`;
        }).join(',');
        csv += row + '\n';
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=visitors_export.csv');
      res.send(csv);
    } catch (error) {
      console.error('Error exporting visitor data:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to export visitor data' 
      });
    }
  });

  // Clear old data (for maintenance)
  router.delete('/data/cleanup', async (req, res) => {
    try {
      const { days_old = 30 } = req.query;
      
      // For demo purposes - in production, this would actually delete old data
      res.json({
        success: true,
        message: `Would delete data older than ${days_old} days`,
        note: 'This is a demo endpoint. In production, this would perform actual data cleanup.'
      });
    } catch (error) {
      console.error('Error during data cleanup:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to perform data cleanup' 
      });
    }
  });

  // Agent configuration endpoint
  router.get('/config', (req, res) => {
    const config = {
      agent_name: 'Visitor Analytics Agent',
      version: '1.0.0',
      features: {
        visitor_tracking: true,
        network_scanning: true,
        device_discovery: true,
        analytics_dashboard: true,
        data_export: true
      },
      settings: {
        data_retention_days: 30,
        network_scan_interval_minutes: 5,
        max_visitors_per_page: 100,
        rate_limiting_enabled: true
      },
      endpoints: {
        public: ['/api/analytics/track', '/api/analytics/activity', '/api/analytics/client-info'],
        admin: ['/api/admin/*'],
        status: ['/api/status', '/api/analytics/health']
      }
    };

    res.json({
      success: true,
      config: config
    });
  });

  return router;
};