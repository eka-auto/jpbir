const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const compression = require('compression');

// Import routes
const analyticsRoutes = require('./routes/analytics');
const adminRoutes = require('./routes/admin');

// Import utilities
const VisitorLogger = require('./utils/visitorLogger');
const NetworkScanner = require('./utils/networkScanner');
const EnhancedCollector = require('./utils/enhancedCollector');
const DataProcessor = require('./utils/dataProcessor');
const AnalyticsEngine = require('./utils/analyticsEngine');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(cors());
app.use(compression());
app.use(morgan('combined'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize utilities
const visitorLogger = new VisitorLogger();
const networkScanner = new NetworkScanner();
const enhancedCollector = new EnhancedCollector();
const analyticsEngine = new AnalyticsEngine();
const dataProcessor = new DataProcessor();
dataProcessor.setVisitorLogger(visitorLogger);

// Rate limiting for analytics endpoints
const rateLimit = require('express-rate-limit');
const analyticsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

// Routes
app.use('/api/analytics', analyticsLimiter, analyticsRoutes(visitorLogger));
app.use('/api/admin', adminRoutes(visitorLogger, networkScanner));

// Standalone tracking endpoint (matches deployed /api/track on Vercel)
app.post('/api/track', analyticsLimiter, async (req, res) => {
  try {
    let event = req.body || {};
    if (typeof event === 'string') {
      try { event = JSON.parse(event); } catch { event = { raw: event }; }
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const visitorData = await visitorLogger.logVisitor(req, event);
    await visitorLogger.logActivity(visitorData.visitor_id, event.event_type || 'page_view', event.page_url || '/', { referrer: event.referrer || 'direct' });
    res.status(200).json({ success: true, eventId: id, persisted: true });
  } catch (error) {
    console.error('[api/track] error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to track event' });
  }
});

// Serve landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Agent status endpoint
app.get('/api/status', (req, res) => {
  const agentInfo = {
    name: 'Visitor Analytics Agent',
    version: '1.0.0',
    status: 'active',
    uptime: process.uptime(),
    visitorsTracked: visitorLogger.getTotalVisitors(),
    features: [
      'IP address tracking',
      'Network information collection',
      'Time spent analytics',
      'Device/browser detection',
      'Geolocation data',
      'Network scanning capabilities',
      'Enhanced data collection',
      'Advanced analytics engine',
      'Real-time data processing'
    ]
  };
  res.json(agentInfo);
});

// Enhanced analytics endpoint
app.post('/api/analytics/enhanced', async (req, res) => {
  try {
    const visitorData = await enhancedCollector.collectVisitorData(req);
    const fingerprint = enhancedCollector.generateVisitorFingerprint(visitorData);
    
    // Log visitor with enhanced data
    const visitorInfo = await visitorLogger.logVisitor(req, {
      ...visitorData,
      fingerprint: fingerprint.fingerprint
    });
    
    res.json({
      success: true,
      visitor_id: visitorInfo.visitor_id,
      fingerprint: fingerprint,
      data_collected: enhancedCollector.getDataCollectionSummary(),
      privacy_notice: 'Enhanced data collection active. All data is anonymized.'
    });
  } catch (error) {
    console.error('Error in enhanced analytics:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to collect enhanced analytics' 
    });
  }
});

// Enhanced client data endpoint
app.post('/api/analytics/client-enhanced', async (req, res) => {
  try {
    const { client_data } = req.body;
    
    if (!client_data) {
      return res.status(400).json({ 
        success: false, 
        error: 'client_data is required' 
      });
    }
    
    const enhancedData = await enhancedCollector.collectClientSideData(client_data);
    
    res.json({
      success: true,
      enhanced_data: enhancedData,
      processed_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error processing client data:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process client data' 
    });
  }
});

// Analytics report endpoint
app.get('/api/analytics/report', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const report = await dataProcessor.generateReport(days);
    
    res.json({
      success: true,
      report: report
    });
  } catch (error) {
    console.error('Error generating analytics report:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to generate analytics report' 
    });
  }
});

// Real-time analytics endpoint
app.get('/api/analytics/realtime', async (req, res) => {
  try {
    const analytics = await dataProcessor.getRealTimeAnalytics();
    
    res.json({
      success: true,
      analytics: analytics
    });
  } catch (error) {
    console.error('Error getting real-time analytics:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get real-time analytics' 
    });
  }
});

// Detailed analytics endpoints
app.get('/api/analytics/trending', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const trending = await analyticsEngine.getTrendingData(days);
    
    res.json({
      success: true,
      days: days,
      trending: trending
    });
  } catch (error) {
    console.error('Error getting trending data:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get trending data' 
    });
  }
});

app.get('/api/analytics/devices', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const devices = await analyticsEngine.getDeviceAnalytics(days);
    
    res.json({
      success: true,
      days: days,
      devices: devices
    });
  } catch (error) {
    console.error('Error getting device analytics:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get device analytics' 
    });
  }
});

app.get('/api/analytics/browsers', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const browsers = await analyticsEngine.getBrowserAnalytics(days);
    
    res.json({
      success: true,
      days: days,
      browsers: browsers
    });
  } catch (error) {
    console.error('Error getting browser analytics:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get browser analytics' 
    });
  }
});

app.get('/api/analytics/geography', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const geography = await analyticsEngine.getGeographicAnalytics(days);
    
    res.json({
      success: true,
      days: days,
      geography: geography
    });
  } catch (error) {
    console.error('Error getting geographic analytics:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get geographic analytics' 
    });
  }
});

app.get('/api/analytics/networks', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const networks = await analyticsEngine.getNetworkAnalytics(days);
    
    res.json({
      success: true,
      days: days,
      networks: networks
    });
  } catch (error) {
    console.error('Error getting network analytics:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get network analytics' 
    });
  }
});

app.get('/api/analytics/referrers', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const referrers = await analyticsEngine.getReferrerAnalytics(days);
    
    res.json({
      success: true,
      days: days,
      referrers: referrers
    });
  } catch (error) {
    console.error('Error getting referrer analytics:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get referrer analytics' 
    });
  }
});

// Data processor status endpoint
app.get('/api/analytics/processor-status', (req, res) => {
  res.json({
    success: true,
    status: dataProcessor.getStatus(),
    generated_at: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`
  =============================================
  Visitor Analytics Agent Started Successfully!
  =============================================
  Agent Name: Visitor Analytics Agent
  Version: 2.0.0
  Port: ${PORT}
  Environment: ${process.env.NODE_ENV || 'development'}
  
  Features Available:
  - Visitor tracking and analytics
  - Network information collection
  - IP address detection
  - Time spent monitoring
  - Device/browser detection
  - Network scanning capabilities
  - Enhanced data collection
  - Advanced analytics engine
  - Real-time data processing
  - Comprehensive reporting
  
  Endpoints:
  - http://localhost:${PORT}/ (Landing Page)
  - http://localhost:${PORT}/dashboard (Admin Dashboard)
  - http://localhost:${PORT}/api/status (Agent Status)
  - http://localhost:${PORT}/api/analytics (Visitor Analytics API)
  - http://localhost:${PORT}/api/admin (Admin API)
  - http://localhost:${PORT}/api/analytics/report (Analytics Reports)
  - http://localhost:${PORT}/api/analytics/realtime (Real-time Analytics)
  
  =============================================
  `);
  
  // Initialize network scanner on startup
  networkScanner.initialize();
  
  // Start data processing (every 5 minutes)
  setTimeout(() => {
    dataProcessor.startProcessing(5);
    console.log('Data Processor: Started with 5-minute processing intervals');
  }, 10000); // Start 10 seconds after server starts
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  dataProcessor.shutdown();
  visitorLogger.close();
  analyticsEngine.close();
  server.close(() => {
    console.log('Server shut down');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received. Shutting down gracefully...');
  dataProcessor.shutdown();
  visitorLogger.close();
  analyticsEngine.close();
  server.close(() => {
    console.log('Server shut down');
    process.exit(0);
  });
});
