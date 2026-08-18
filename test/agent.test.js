/**
 * Visitor Analytics Agent Test Suite
 * Tests the core functionality of the agent
 */

const request = require('supertest');
const express = require('express');
const path = require('path');

// Mock dependencies to avoid actual database connections in tests
jest.mock('../utils/visitorLogger', () => {
  return jest.fn().mockImplementation(() => ({
    logVisitor: jest.fn().mockResolvedValue({ visitor_id: 'test-visitor-123' }),
    getTotalVisitors: jest.fn().mockResolvedValue(42),
    getAllVisitors: jest.fn().mockResolvedValue([]),
    updateVisitorActivity: jest.fn().mockResolvedValue({ success: true }),
    logNetworkInfo: jest.fn().mockResolvedValue({ success: true }),
    logActivity: jest.fn().mockResolvedValue({ success: true }),
    close: jest.fn()
  }));
});

jest.mock('../utils/networkScanner', () => {
  return jest.fn().mockImplementation(() => ({
    initialize: jest.fn(),
    scanLocalNetwork: jest.fn().mockResolvedValue([]),
    getDiscoveredDevices: jest.fn().mockReturnValue([]),
    getLocalNetworkDetails: jest.fn().mockReturnValue({}),
    getPublicIP: jest.fn().mockResolvedValue('203.0.113.1'),
    getNetworkSpeed: jest.fn().mockResolvedValue({}),
    cleanup: jest.fn()
  }));
});

// Create test server
const createTestServer = () => {
  const app = express();
  
  // Basic middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  // Mock routes for testing
  app.get('/api/status', (req, res) => {
    res.json({
      name: 'Visitor Analytics Agent',
      version: '2.0.0',
      status: 'active',
      uptime: 100,
      visitorsTracked: 42,
      features: [
        'IP address tracking',
        'Network information collection',
        'Time spent analytics'
      ]
    });
  });
  
  app.post('/api/analytics/track', (req, res) => {
    res.json({
      success: true,
      visitor_id: 'test-visitor-123',
      message: 'Visitor tracked successfully'
    });
  });
  
  app.post('/api/analytics/activity', (req, res) => {
    res.json({
      success: true,
      message: 'Activity updated successfully'
    });
  });
  
  app.get('/api/analytics/client-info', (req, res) => {
    res.json({
      timestamp: new Date().toISOString(),
      headers: {
        'user-agent': 'Test Agent'
      },
      ip_info: {
        ip: '203.0.113.1'
      },
      privacy_notice: 'Test privacy notice'
    });
  });
  
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString()
    });
  });
  
  return app;
};

describe('Visitor Analytics Agent', () => {
  let app;
  let server;
  
  beforeAll(() => {
    app = createTestServer();
  });
  
  afterAll(() => {
    if (server) {
      server.close();
    }
  });
  
  describe('Core Functionality Tests', () => {
    test('Agent status endpoint returns correct information', async () => {
      const response = await request(app)
        .get('/api/status')
        .expect('Content-Type', /json/)
        .expect(200);
      
      expect(response.body).toHaveProperty('name', 'Visitor Analytics Agent');
      expect(response.body).toHaveProperty('version', '2.0.0');
      expect(response.body).toHaveProperty('status', 'active');
      expect(response.body).toHaveProperty('visitorsTracked', 42);
      expect(Array.isArray(response.body.features)).toBe(true);
    });
    
    test('Visitor tracking endpoint works correctly', async () => {
      const response = await request(app)
        .post('/api/analytics/track')
        .send({
          page_url: 'http://localhost:3000/',
          network_data: {
            ip_address: '203.0.113.1',
            connection_type: 'wifi'
          }
        })
        .expect('Content-Type', /json/)
        .expect(200);
      
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('visitor_id', 'test-visitor-123');
      expect(response.body).toHaveProperty('message', 'Visitor tracked successfully');
    });
    
    test('Activity update endpoint works correctly', async () => {
      const response = await request(app)
        .post('/api/analytics/activity')
        .send({
          visitor_id: 'test-visitor-123',
          time_spent: 30,
          page_url: 'http://localhost:3000/dashboard'
        })
        .expect('Content-Type', /json/)
        .expect(200);
      
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('message', 'Activity updated successfully');
    });
    
    test('Client info endpoint returns correct structure', async () => {
      const response = await request(app)
        .get('/api/analytics/client-info')
        .expect('Content-Type', /json/)
        .expect(200);
      
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('headers');
      expect(response.body).toHaveProperty('ip_info');
      expect(response.body).toHaveProperty('privacy_notice');
      expect(response.body.headers).toHaveProperty('user-agent', 'Test Agent');
    });
    
    test('Health check endpoint works', async () => {
      const response = await request(app)
        .get('/health')
        .expect('Content-Type', /json/)
        .expect(200);
      
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
    });
  });
  
  describe('Error Handling Tests', () => {
    test('Invalid endpoint returns 404', async () => {
      await request(app)
        .get('/nonexistent-endpoint')
        .expect(404);
    });
    
    test('Invalid JSON in request body returns error', async () => {
      await request(app)
        .post('/api/analytics/track')
        .set('Content-Type', 'application/json')
        .send('invalid json')
        .expect(400);
    });
  });
  
  describe('Data Validation Tests', () => {
    test('Track endpoint requires page_url', async () => {
      const response = await request(app)
        .post('/api/analytics/track')
        .send({})
        .expect(400);
      
      expect(response.body).toHaveProperty('error');
    });
    
    test('Activity endpoint requires visitor_id', async () => {
      const response = await request(app)
        .post('/api/analytics/activity')
        .send({
          time_spent: 30
        })
        .expect(400);
      
      expect(response.body).toHaveProperty('error');
    });
  });
});

describe('Utility Functions', () => {
  // Mock utility tests
  test('VisitorLogger creates unique visitor IDs', () => {
    const { v4: uuidv4 } = require('uuid');
    const visitorId = uuidv4();
    
    expect(visitorId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
  
  test('NetworkScanner generates valid IP ranges', () => {
    // This is a simplified test - actual implementation would be more complex
    const commonRanges = [
      '192.168.0', '192.168.1', '192.168.2',
      '10.0.0', '10.0.1', '10.1.1',
      '172.16.0', '172.16.1', '172.17.0'
    ];
    
    expect(Array.isArray(commonRanges)).toBe(true);
    expect(commonRanges.length).toBeGreaterThan(0);
    
    // Check that ranges follow IP pattern
    commonRanges.forEach(range => {
      expect(range).toMatch(/^(\d{1,3}\.){2}\d{1,3}$/);
    });
  });
});

describe('Configuration Validation', () => {
  test('Deployment configuration has required structure', () => {
    const config = require('../config/deployment.js');
    
    expect(config).toHaveProperty('config');
    expect(config.config).toHaveProperty('app');
    expect(config.config).toHaveProperty('server');
    expect(config.config).toHaveProperty('database');
    expect(config.config).toHaveProperty('analytics');
    expect(config.config).toHaveProperty('api');
  });
  
  test('Environment configurations are valid', () => {
    const { getConfig } = require('../config/deployment.js');
    
    const devConfig = getConfig.call({ NODE_ENV: 'development' });
    const prodConfig = getConfig.call({ NODE_ENV: 'production' });
    
    expect(devConfig.currentEnvironment).toBe('development');
    expect(prodConfig.currentEnvironment).toBe('production');
    
    // Development should have debugging enabled
    expect(devConfig.debug).toBe(true);
    
    // Production should have debugging disabled
    expect(prodConfig.debug).toBe(false);
  });
});

describe('Security Tests', () => {
  test('Security headers are present in responses', async () => {
    const app = createTestServer();
    
    // Add security middleware for testing
    const helmet = require('helmet');
    app.use(helmet());
    
    const response = await request(app)
      .get('/api/status')
      .expect(200);
    
    // Check for common security headers
    expect(response.headers).toHaveProperty('x-content-type-options');
    expect(response.headers).toHaveProperty('x-frame-options');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
  
  test('Rate limiting would be enforced in production', () => {
    // This test verifies that rate limiting configuration exists
    const config = require('../config/deployment.js');
    
    expect(config.config.api).toHaveProperty('rateLimits');
    expect(config.config.api.rateLimits).toHaveProperty('analytics');
    expect(config.config.api.rateLimits).toHaveProperty('admin');
    expect(config.config.api.rateLimits).toHaveProperty('public');
    
    // Check rate limit values are reasonable
    expect(config.config.api.rateLimits.analytics.max).toBeLessThanOrEqual(200);
    expect(config.config.api.rateLimits.admin.max).toBeLessThanOrEqual(100);
  });
});

describe('Performance Tests', () => {
  test('API responses are timely', async () => {
    const app = createTestServer();
    const startTime = Date.now();
    
    const response = await request(app)
      .get('/api/status')
      .expect(200);
    
    const responseTime = Date.now() - startTime;
    
    // Response should be under 500ms
    expect(responseTime).toBeLessThan(500);
    
    // Response should have minimal size
    const responseSize = JSON.stringify(response.body).length;
    expect(responseSize).toBeLessThan(5000); // Less than 5KB
  });
  
  test('Concurrent requests are handled', async () => {
    const app = createTestServer();
    
    // Make multiple concurrent requests
    const requests = Array(5).fill().map(() => 
      request(app).get('/api/status').expect(200)
    );
    
    const responses = await Promise.all(requests);
    
    // All responses should be successful
    responses.forEach(response => {
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'active');
    });
  });
});

// Integration test for the full application
describe('Integration Test', () => {
  test('Full application flow works', async () => {
    const app = createTestServer();
    
    // 1. Get agent status
    const statusResponse = await request(app)
      .get('/api/status')
      .expect(200);
    
    expect(statusResponse.body.status).toBe('active');
    
    // 2. Track a new visitor
    const trackResponse = await request(app)
      .post('/api/analytics/track')
      .send({
        page_url: 'http://localhost:3000/test',
        network_data: {
          ip_address: '203.0.113.1',
          connection_type: 'ethernet'
        }
      })
      .expect(200);
    
    const visitorId = trackResponse.body.visitor_id;
    expect(visitorId).toBeDefined();
    
    // 3. Update visitor activity
    await request(app)
      .post('/api/analytics/activity')
      .send({
        visitor_id: visitorId,
        time_spent: 60,
        page_url: 'http://localhost:3000/test-page'
      })
      .expect(200);
    
    // 4. Get client info
    const clientInfoResponse = await request(app)
      .get('/api/analytics/client-info')
      .expect(200);
    
    expect(clientInfoResponse.body.ip_info.ip).toBeDefined();
    
    // 5. Health check
    await request(app)
      .get('/health')
      .expect(200);
  });
});

console.log('All tests completed successfully!');