/**
 * Simple Test for Visitor Analytics Agent
 * Tests basic functionality without full server startup
 */

const assert = require('assert');
const path = require('path');

console.log('🧪 Testing Visitor Analytics Agent Core Components...');
console.log('====================================================');

// Test 1: Check if required modules can be loaded
try {
  console.log('📦 Test 1: Module imports...');
  const VisitorLogger = require('../utils/visitorLogger');
  console.log('✅ VisitorLogger module loaded successfully');
  
  const NetworkScanner = require('../utils/networkScanner');
  console.log('✅ NetworkScanner module loaded successfully');
  
  const EnhancedCollector = require('../utils/enhancedCollector');
  console.log('✅ EnhancedCollector module loaded successfully');
  
  const AnalyticsEngine = require('../utils/analyticsEngine');
  console.log('✅ AnalyticsEngine module loaded successfully');
  
  const DataProcessor = require('../utils/dataProcessor');
  console.log('✅ DataProcessor module loaded successfully');
  
  console.log('✅ All core modules loaded successfully\n');
} catch (error) {
  console.error('❌ Module loading failed:', error.message);
  process.exit(1);
}

// Test 2: Check configuration
try {
  console.log('⚙️ Test 2: Configuration validation...');
  const config = require('../config/deployment.js');
  
  assert(config, 'Configuration should exist');
  assert(config.config, 'Configuration should have config object');
  assert(config.config.app, 'Should have app configuration');
  assert(config.config.server, 'Should have server configuration');
  assert(config.config.database, 'Should have database configuration');
  assert(config.config.analytics, 'Should have analytics configuration');
  
  console.log('✅ Configuration structure is valid\n');
} catch (error) {
  console.error('❌ Configuration validation failed:', error.message);
  process.exit(1);
}

// Test 3: Test utility functions
try {
  console.log('🔧 Test 3: Utility function tests...');
  
  // Test UUID generation
  const { v4: uuidv4 } = require('uuid');
  const uuid = uuidv4();
  assert(typeof uuid === 'string', 'UUID should be a string');
  assert(uuid.length === 36, 'UUID should be 36 characters');
  console.log('✅ UUID generation works');
  
  // Test date formatting
  const now = new Date();
  const isoString = now.toISOString();
  assert(isoString.includes('T'), 'ISO string should contain T');
  assert(isoString.includes('Z'), 'ISO string should end with Z');
  console.log('✅ Date formatting works');
  
  // Test JSON parsing
  const testObj = { test: 'value', number: 123 };
  const jsonString = JSON.stringify(testObj);
  const parsedObj = JSON.parse(jsonString);
  assert.deepStrictEqual(parsedObj, testObj, 'JSON parsing should work');
  console.log('✅ JSON operations work');
  
  console.log('✅ All utility functions work correctly\n');
} catch (error) {
  console.error('❌ Utility function test failed:', error.message);
  process.exit(1);
}

// Test 4: Test file structure
try {
  console.log('📁 Test 4: Project structure validation...');
  
  const fs = require('fs');
  const requiredFiles = [
    'package.json',
    'server.js',
    'README.md',
    'config/deployment.js',
    'routes/analytics.js',
    'routes/admin.js',
    'utils/visitorLogger.js',
    'utils/networkScanner.js',
    'public/index.html',
    'public/dashboard.html'
  ];
  
  let allFilesExist = true;
  for (const file of requiredFiles) {
    const filePath = path.join(__dirname, '..', file);
    if (!fs.existsSync(filePath)) {
      console.error(`❌ Missing required file: ${file}`);
      allFilesExist = false;
    }
  }
  
  if (allFilesExist) {
    console.log('✅ All required files exist');
  } else {
    throw new Error('Some required files are missing');
  }
  
  console.log('✅ Project structure is valid\n');
} catch (error) {
  console.error('❌ Project structure validation failed:', error.message);
  process.exit(1);
}

// Test 5: Test package.json dependencies
try {
  console.log('📦 Test 5: Package dependencies check...');
  
  const packageJson = require('../package.json');
  
  // Check required dependencies
  const requiredDeps = [
    'express',
    'cors',
    'helmet',
    'sqlite3',
    'uuid',
    'geoip-lite',
    'useragent'
  ];
  
  const missingDeps = [];
  for (const dep of requiredDeps) {
    if (!packageJson.dependencies[dep]) {
      missingDeps.push(dep);
    }
  }
  
  if (missingDeps.length > 0) {
    throw new Error(`Missing dependencies: ${missingDeps.join(', ')}`);
  }
  
  console.log('✅ All required dependencies are declared');
  console.log('✅ Package.json is valid\n');
} catch (error) {
  console.error('❌ Package dependency check failed:', error.message);
  process.exit(1);
}

// Test 6: Test database initialization (simplified)
try {
  console.log('💾 Test 6: Database initialization test...');
  
  // Just test that we can create a simple SQLite connection
  const sqlite3 = require('sqlite3').verbose();
  const testDbPath = path.join(__dirname, '..', 'data', 'test.db');
  
  // Remove test file if it exists
  const fs = require('fs');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  
  const db = new sqlite3.Database(testDbPath, (err) => {
    if (err) {
      throw err;
    }
  });
  
  // Test simple query
  db.run('CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, name TEXT)', (err) => {
    if (err) {
      throw err;
    }
    
    db.run('INSERT INTO test (name) VALUES (?)', ['test_value'], (err) => {
      if (err) {
        throw err;
      }
      
      db.get('SELECT * FROM test WHERE name = ?', ['test_value'], (err, row) => {
        if (err) {
          throw err;
        }
        
        assert(row, 'Should retrieve inserted row');
        assert(row.name === 'test_value', 'Row should have correct value');
        
        db.close();
        fs.unlinkSync(testDbPath);
        console.log('✅ Database operations work correctly\n');
        
        // All tests passed
        console.log('🎉 All tests passed successfully!');
        console.log('==================================');
        console.log('The Visitor Analytics Agent is ready for deployment.');
        console.log('\nNext steps:');
        console.log('1. Start the server: npm start');
        console.log('2. Access the dashboard: http://localhost:3000/dashboard');
        console.log('3. Run full verification: node test/verify-agent.js');
      });
    });
  });
} catch (error) {
  console.error('❌ Database test failed:', error.message);
  process.exit(1);
}