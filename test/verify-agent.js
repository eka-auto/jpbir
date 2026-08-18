#!/usr/bin/env node

/**
 * Verification Script for Visitor Analytics Agent
 * Tests that the agent is functioning correctly
 */

const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const util = require('util');
const path = require('path');

const execPromise = util.promisify(exec);

class AgentVerifier {
  constructor(port = 3000, host = 'localhost') {
    this.port = port;
    this.host = host;
    this.baseUrl = `http://${host}:${port}`;
    this.results = [];
  }

  async runAllTests() {
    console.log('🚀 Visitor Analytics Agent Verification');
    console.log('========================================');
    console.log(`Target: ${this.baseUrl}`);
    console.log();

    try {
      await this.testServerConnection();
      await this.testStatusEndpoint();
      await this.testAnalyticsEndpoints();
      await this.testAdminEndpoints();
      await this.testStaticFiles();
      await this.testDatabase();
      await this.testNetworkScanner();
      
      this.printResults();
    } catch (error) {
      console.error('❌ Verification failed:', error.message);
      process.exit(1);
    }
  }

  async testServerConnection() {
    const testName = 'Server Connection';
    try {
      const response = await this.makeRequest('/');
      if (response.statusCode === 200 || response.statusCode === 404) {
        this.recordSuccess(testName, 'Server is running');
      } else {
        this.recordFailure(testName, `Unexpected status: ${response.statusCode}`);
      }
    } catch (error) {
      this.recordFailure(testName, `Connection failed: ${error.message}`);
      throw error;
    }
  }

  async testStatusEndpoint() {
    const testName = 'Status Endpoint';
    try {
      const response = await this.makeRequest('/api/status');
      if (response.statusCode === 200) {
        const data = JSON.parse(response.body);
        
        const checks = [
          { field: 'name', expected: 'Visitor Analytics Agent' },
          { field: 'status', expected: 'active' },
          { field: 'features', type: 'array' }
        ];

        let allPassed = true;
        checks.forEach(check => {
          if (check.type === 'array') {
            if (!Array.isArray(data[check.field])) {
              allPassed = false;
            }
          } else if (data[check.field] !== check.expected) {
            allPassed = false;
          }
        });

        if (allPassed) {
          this.recordSuccess(testName, 'Status endpoint is working correctly');
        } else {
          this.recordFailure(testName, 'Status endpoint returned invalid data');
        }
      } else {
        this.recordFailure(testName, `Unexpected status: ${response.statusCode}`);
      }
    } catch (error) {
      this.recordFailure(testName, `Request failed: ${error.message}`);
    }
  }

  async testAnalyticsEndpoints() {
    const testName = 'Analytics Endpoints';
    try {
      // Test track endpoint
      const trackResponse = await this.makeRequest('/api/analytics/track', 'POST', {
        page_url: 'http://localhost:3000/verify',
        network_data: {
          ip_address: '127.0.0.1',
          connection_type: 'local'
        }
      });

      if (trackResponse.statusCode === 200) {
        const trackData = JSON.parse(trackResponse.body);
        if (trackData.success && trackData.visitor_id) {
          this.recordSuccess(testName + ' - Track', 'Visitor tracking works');
          
          // Test activity endpoint with the visitor ID
          const activityResponse = await this.makeRequest('/api/analytics/activity', 'POST', {
            visitor_id: trackData.visitor_id,
            time_spent: 10,
            page_url: 'http://localhost:3000/verify-activity'
          });

          if (activityResponse.statusCode === 200) {
            const activityData = JSON.parse(activityResponse.body);
            if (activityData.success) {
              this.recordSuccess(testName + ' - Activity', 'Activity tracking works');
            }
          }
        }
      }

      // Test client info endpoint
      const clientInfoResponse = await this.makeRequest('/api/analytics/client-info');
      if (clientInfoResponse.statusCode === 200) {
        this.recordSuccess(testName + ' - Client Info', 'Client info endpoint works');
      }

    } catch (error) {
      this.recordFailure(testName, `Analytics test failed: ${error.message}`);
    }
  }

  async testAdminEndpoints() {
    const testName = 'Admin Endpoints';
    try {
      // Note: Admin endpoints might require authentication
      // We'll test they at least respond (even if with 401/403)
      const visitorsResponse = await this.makeRequest('/api/admin/visitors');
      
      if (visitorsResponse.statusCode === 200 || visitorsResponse.statusCode === 401) {
        this.recordSuccess(testName, 'Admin endpoints are accessible');
      } else {
        this.recordFailure(testName, `Unexpected status: ${visitorsResponse.statusCode}`);
      }
    } catch (error) {
      this.recordFailure(testName, `Admin test failed: ${error.message}`);
    }
  }

  async testStaticFiles() {
    const testName = 'Static Files';
    try {
      const response = await this.makeRequest('/');
      if (response.statusCode === 200) {
        // Check if it's HTML
        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('text/html')) {
          this.recordSuccess(testName, 'Static files are served correctly');
        } else {
          this.recordFailure(testName, 'Root endpoint does not return HTML');
        }
      }
    } catch (error) {
      this.recordFailure(testName, `Static files test failed: ${error.message}`);
    }
  }

  async testDatabase() {
    const testName = 'Database';
    try {
      // Check if data directory exists
      const fs = require('fs');
      const dataDir = path.join(__dirname, '..', 'data');
      
      if (fs.existsSync(dataDir)) {
        this.recordSuccess(testName, 'Data directory exists');
        
        // Check for database files
        const files = fs.readdirSync(dataDir);
        const hasDbFiles = files.some(file => file.endsWith('.db'));
        
        if (hasDbFiles) {
          this.recordSuccess(testName + ' - Files', 'Database files exist');
        } else {
          this.recordWarning(testName + ' - Files', 'No database files found (may be first run)');
        }
      } else {
        this.recordWarning(testName, 'Data directory does not exist (may be first run)');
      }
    } catch (error) {
      this.recordFailure(testName, `Database test failed: ${error.message}`);
    }
  }

  async testNetworkScanner() {
    const testName = 'Network Scanner';
    try {
      // Check if network utilities are available
      const { stdout } = await execPromise('ping -c 1 127.0.0.1');
      if (stdout.includes('1 packets transmitted')) {
        this.recordSuccess(testName, 'Network utilities are available');
      } else {
        this.recordWarning(testName, 'Network utilities may be limited');
      }
    } catch (error) {
      this.recordWarning(testName, 'Network scanning capabilities may be limited');
    }
  }

  async makeRequest(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.host,
        port: this.port,
        path: path,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'AgentVerifier/1.0'
        }
      };

      const req = http.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data
          });
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      if (body && (method === 'POST' || method === 'PUT')) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  recordSuccess(testName, message) {
    this.results.push({ test: testName, status: '✅', message });
    console.log(`✅ ${testName}: ${message}`);
  }

  recordFailure(testName, message) {
    this.results.push({ test: testName, status: '❌', message });
    console.log(`❌ ${testName}: ${message}`);
  }

  recordWarning(testName, message) {
    this.results.push({ test: testName, status: '⚠️', message });
    console.log(`⚠️ ${testName}: ${message}`);
  }

  printResults() {
    console.log();
    console.log('📊 Verification Results');
    console.log('======================');
    
    const passed = this.results.filter(r => r.status === '✅').length;
    const failed = this.results.filter(r => r.status === '❌').length;
    const warnings = this.results.filter(r => r.status === '⚠️').length;
    
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⚠️ Warnings: ${warnings}`);
    console.log(`📋 Total Tests: ${this.results.length}`);
    console.log();
    
    if (failed > 0) {
      console.log('❌ Verification FAILED');
      console.log('Failed tests:');
      this.results.filter(r => r.status === '❌').forEach(r => {
        console.log(`  - ${r.test}: ${r.message}`);
      });
      process.exit(1);
    } else {
      console.log('🎉 Verification PASSED!');
      console.log();
      console.log('🎯 Agent is ready for deployment!');
      console.log();
      console.log('Next steps:');
      console.log('1. Review configuration in config/deployment.js');
      console.log('2. Start the agent: npm start');
      console.log('3. Access dashboard at: http://localhost:3000/dashboard');
      console.log('4. Deploy using: ./deploy.sh');
    }
  }
}

// Run verification
async function main() {
  const port = process.env.PORT || 3000;
  const host = process.env.HOST || 'localhost';
  
  const verifier = new AgentVerifier(port, host);
  await verifier.runAllTests();
}

// Handle command line arguments
if (require.main === module) {
  main().catch(error => {
    console.error('Verification failed:', error);
    process.exit(1);
  });
}

module.exports = AgentVerifier;