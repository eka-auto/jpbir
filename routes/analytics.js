const express = require('express');
const router = express.Router();

module.exports = (visitorLogger) => {
  // Track visitor on initial visit
  router.post('/track', async (req, res) => {
    try {
      const visitorData = await visitorLogger.logVisitor(req, req.body);
      
      // Log initial activity
      await visitorLogger.logActivity(
        visitorData.visitor_id,
        'page_visit',
        req.body.page_url || '/',
        { referrer: visitorData.referrer }
      );

      res.json({
        success: true,
        visitor_id: visitorData.visitor_id,
        message: 'Visitor tracked successfully'
      });
    } catch (error) {
      console.error('Error tracking visitor:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to track visitor' 
      });
    }
  });

  // Update visitor activity (time spent, page views, etc.)
  router.post('/activity', async (req, res) => {
    try {
      const { visitor_id, time_spent, page_url, action_type = 'page_view' } = req.body;
      
      if (!visitor_id) {
        return res.status(400).json({ 
          success: false, 
          error: 'visitor_id is required' 
        });
      }

      // Update visitor activity
      await visitorLogger.updateVisitorActivity(visitor_id, time_spent || 0);
      
      // Log specific activity
      await visitorLogger.logActivity(
        visitor_id,
        action_type,
        page_url || '/',
        { time_spent: time_spent || 0 }
      );

      res.json({
        success: true,
        message: 'Activity updated successfully'
      });
    } catch (error) {
      console.error('Error updating activity:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to update activity' 
      });
    }
  });

  // Log network information from client
  router.post('/network', async (req, res) => {
    try {
      const { visitor_id, network_data } = req.body;
      
      if (!visitor_id || !network_data) {
        return res.status(400).json({ 
          success: false, 
          error: 'visitor_id and network_data are required' 
        });
      }

      await visitorLogger.logNetworkInfo(visitor_id, network_data);

      res.json({
        success: true,
        message: 'Network information logged successfully'
      });
    } catch (error) {
      console.error('Error logging network info:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to log network information' 
      });
    }
  });

  // Get visitor's own data (for privacy/transparency)
  router.get('/my-data/:visitor_id', async (req, res) => {
    try {
      const { visitor_id } = req.params;
      
      const [visitorStats, networkInfo, activityLog] = await Promise.all([
        visitorLogger.getVisitorStats(visitor_id),
        visitorLogger.getNetworkInfo(visitor_id),
        visitorLogger.getActivityLog(visitor_id, 20)
      ]);

      if (!visitorStats) {
        return res.status(404).json({ 
          success: false, 
          error: 'Visitor not found' 
        });
      }

      // Return limited information for privacy
      res.json({
        success: true,
        data: {
          visitor_id: visitorStats.visitor_id,
          device_info: {
            browser: visitorStats.browser_name,
            os: visitorStats.os_name,
            device_type: visitorStats.device_type
          },
          location: {
            country: visitorStats.country,
            region: visitorStats.region,
            city: visitorStats.city
          },
          activity_summary: {
            total_time_spent: visitorStats.total_time_spent,
            page_views: visitorStats.page_views,
            first_visit: visitorStats.initial_timestamp,
            last_activity: visitorStats.last_activity
          },
          network_info: networkInfo,
          recent_activity: activityLog
        }
      });
    } catch (error) {
      console.error('Error getting visitor data:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to retrieve visitor data' 
      });
    }
  });

  // Get client-side information endpoint
  router.get('/client-info', (req, res) => {
    const clientInfo = {
      timestamp: new Date().toISOString(),
      headers: {
        'user-agent': req.headers['user-agent'],
        'accept-language': req.headers['accept-language'],
        'accept-encoding': req.headers['accept-encoding']
      },
      ip_info: {
        ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip,
        forwarded_for: req.headers['x-forwarded-for']
      },
      available_data_points: [
        'ip_address',
        'user_agent',
        'browser_info',
        'os_info',
        'device_type',
        'geolocation',
        'network_info',
        'time_spent',
        'page_views'
      ],
      privacy_notice: 'This agent collects anonymous analytics data to help improve network connectivity and device discovery.'
    };

    res.json(clientInfo);
  });

  // Health check endpoint
  router.get('/health', async (req, res) => {
    try {
      const totalVisitors = await visitorLogger.getTotalVisitors();
      
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'connected',
        total_visitors: totalVisitors,
        uptime: process.uptime()
      });
    } catch (error) {
      res.status(500).json({
        status: 'unhealthy',
        error: 'Database connection issue',
        details: error.message
      });
    }
  });

  return router;
};