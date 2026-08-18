# Visitor Analytics Agent Troubleshooting Guide

## Quick Diagnosis

### Agent Status Check

```bash
# Check if agent is running
curl -f http://localhost:3000/api/status

# Check health endpoint
curl http://localhost:3000/health

# Check logs
tail -f logs/agent.log
```

### Common Symptoms & Solutions

| Symptom | Possible Cause | Solution |
|---------|---------------|----------|
| Agent won't start | Port 3000 in use | Change port or free port |
| Database errors | Corrupted database file | Repair or recreate database |
| Network scanning fails | Missing network utilities | Install ping and arp |
| High memory usage | Memory leak or large database | Increase memory limit or optimize |
| API endpoints not responding | Service crashed | Restart service |

## Detailed Troubleshooting

### 1. Agent Won't Start

#### Error: "Port already in use"

**Symptoms:**
- `Error: listen EADDRINUSE: address already in use :::3000`
- Agent fails to start

**Solutions:**

```bash
# Find process using port 3000
sudo lsof -i :3000
# or
sudo netstat -tulpn | grep :3000

# Kill the process
sudo kill -9 <PID>

# Or change the port
export PORT=3001
npm start
```

**Prevention:**
```bash
# Use port checking script
PORT=3000
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null ; then
    echo "Port $PORT is in use"
    # Handle accordingly
fi
```

#### Error: "Cannot find module"

**Symptoms:**
- `Error: Cannot find module 'express'`
- Missing dependencies

**Solutions:**
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Or install missing module
npm install express
```

### 2. Database Issues

#### Error: "SQLITE_CANTOPEN"

**Symptoms:**
- `SQLITE_CANTOPEN: unable to open database file`
- Database file permissions issue

**Solutions:**
```bash
# Check permissions
ls -la data/*.db

# Fix permissions
chmod 644 data/*.db
chown -R $(whoami):$(whoami) data/

# Ensure directory exists
mkdir -p data
```

#### Error: "Database is locked"

**Symptoms:**
- `SQLITE_BUSY: database is locked`
- Multiple processes accessing database

**Solutions:**
```bash
# Check for other processes
fuser data/visitors.db

# Kill other processes
pkill -f "node.*visitor-analytics-agent"

# Use WAL mode for better concurrency
sqlite3 data/visitors.db "PRAGMA journal_mode=WAL;"
```

#### Database Corruption

**Symptoms:**
- Unexpected errors
- Missing data
- `SQLITE_CORRUPT` errors

**Solutions:**
```bash
# Backup first
cp data/visitors.db data/visitors.db.backup

# Repair database
sqlite3 data/visitors.db ".dump" | sqlite3 data/visitors.db.new
mv data/visitors.db.new data/visitors.db

# Reindex
sqlite3 data/visitors.db "REINDEX;"
```

### 3. Network Scanning Problems

#### Network Utilities Missing

**Symptoms:**
- Network scanning fails silently
- "Command not found" errors

**Solutions:**
```bash
# Install required utilities (Ubuntu/Debian)
sudo apt update
sudo apt install -y iputils-ping net-tools

# Install required utilities (CentOS/RHEL)
sudo yum install -y iputils net-tools

# Install required utilities (macOS)
# Already installed by default
```

#### Firewall Blocking

**Symptoms:**
- Can't ping local devices
- Network scanning returns empty results

**Solutions:**
```bash
# Check firewall status
sudo ufw status
# or
sudo firewall-cmd --state

# Allow ICMP (ping)
sudo ufw allow proto icmp
# or
sudo firewall-cmd --permanent --add-icmp-block-inversion
sudo firewall-cmd --reload
```

#### Permission Issues

**Symptoms:**
- "Operation not permitted" when running ping
- Raw socket permission denied

**Solutions:**
```bash
# Run with sudo (not recommended for production)
sudo npm start

# Or set capabilities
sudo setcap cap_net_raw+ep $(which node)
```

### 4. Performance Issues

#### High Memory Usage

**Symptoms:**
- Slow response times
- Process using excessive memory
- Out of memory errors

**Solutions:**
```bash
# Check memory usage
ps aux | grep node
top -p $(pgrep -f "node server.js")

# Increase memory limit
NODE_OPTIONS="--max-old-space-size=1024" npm start

# Optimize database
sqlite3 data/visitors.db "PRAGMA optimize;"

# Implement data cleanup
# Clean old data automatically
```

#### Slow Database Queries

**Symptoms:**
- Slow API responses
- High database CPU usage

**Solutions:**
```bash
# Create indexes
sqlite3 data/visitors.db "
CREATE INDEX IF NOT EXISTS idx_visitors_last_activity ON visitors(last_activity);
CREATE INDEX IF NOT EXISTS idx_visitors_ip ON visitors(ip_address);
CREATE INDEX IF NOT EXISTS idx_activity_log_visitor_id ON activity_log(visitor_id);
"

# Analyze query performance
sqlite3 data/visitors.db "EXPLAIN QUERY PLAN SELECT * FROM visitors WHERE last_activity > date('now', '-7 days');"

# Vacuum database
sqlite3 data/visitors.db "VACUUM;"
```

### 5. Security Issues

#### API Rate Limiting

**Symptoms:**
- `429 Too Many Requests` errors
- Legitimate users blocked

**Solutions:**
```bash
# Adjust rate limits in config/deployment.js
# Increase limits temporarily
rateLimits: {
  analytics: { window: '15m', max: 500 },
  admin: { window: '15m', max: 100 }
}

# Check rate limit status
curl -I http://localhost:3000/api/analytics/track
# Look for X-RateLimit-* headers
```

#### Authentication Issues

**Symptoms:**
- `401 Unauthorized` errors
- Can't access admin dashboard

**Solutions:**
```bash
# Check authentication configuration
# For basic auth in nginx:
sudo htpasswd -c /etc/nginx/.htpasswd admin

# Verify nginx configuration
sudo nginx -t
sudo systemctl reload nginx
```

### 6. Logging Issues

#### No Logs Being Written

**Symptoms:**
- Empty log files
- Missing log entries

**Solutions:**
```bash
# Check log directory permissions
ls -la logs/
chmod 755 logs/
chown -R $(whoami):$(whoami) logs/

# Check log configuration
cat config/deployment.js | grep -A5 "logging"

# Enable debug logging
export LOG_LEVEL=debug
npm start
```

#### Log Files Too Large

**Symptoms:**
- Disk space running out
- Very large log files

**Solutions:**
```bash
# Implement log rotation
# Add to /etc/logrotate.d/visitor-analytics-agent
/opt/visitor-analytics-agent/logs/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 www-data www-data
}

# Clean old logs
find logs/ -name "*.log" -mtime +7 -delete
```

### 7. Deployment Issues

#### Docker Container Won't Start

**Symptoms:**
- Container exits immediately
- `docker logs` shows errors

**Solutions:**
```bash
# Check container logs
docker logs visitor-analytics-agent

# Run with interactive mode to see errors
docker run -it --rm visitor-analytics-agent

# Check Dockerfile syntax
docker build -t test-image .

# Check resource constraints
docker inspect visitor-analytics-agent | grep -A5 Memory
```

#### Nginx Reverse Proxy Issues

**Symptoms:**
- 502 Bad Gateway errors
- Timeouts

**Solutions:**
```bash
# Check nginx error logs
sudo tail -f /var/log/nginx/error.log

# Test nginx configuration
sudo nginx -t

# Check if agent is running
curl http://localhost:3000/api/status

# Adjust proxy timeouts in nginx config
proxy_connect_timeout 60s;
proxy_send_timeout 60s;
proxy_read_timeout 60s;
```

### 8. Feature-Specific Issues

#### Geolocation Not Working

**Symptoms:**
- All visitors show "Unknown" location
- IP geolocation API failures

**Solutions:**
```bash
# Check external API access
curl https://ipapi.co/8.8.8.8/json

# Use fallback provider
# Configure in config/deployment.js
externalApis: {
  ipGeolocation: {
    provider: 'ipgeolocation',
    endpoint: 'https://api.ipgeolocation.io/ipgeo'
  }
}

# Enable caching
cacheTtl: 3600
```

#### Visitor Fingerprinting Issues

**Symptoms:**
- High number of "unique" visitors
- Fingerprint collisions

**Solutions:**
```bash
# Adjust fingerprinting sensitivity
# In EnhancedCollector.js
calculateUniquenessScore(visitorData) {
  // Adjust scoring weights
}

# Use more identifying features
enhanceVisitorInfo(req, basicInfo) {
  // Add more data points
}
```

#### Real-time Analytics Lag

**Symptoms:**
- Dashboard shows stale data
- Real-time updates delayed

**Solutions:**
```bash
# Adjust processing intervals
# In config/deployment.js
processing: {
  hourlyStats: '1m',  // More frequent updates
  dailyStats: '5m',
  realtime: {
    updateInterval: '10s'
  }
}

# Optimize database queries
# Add appropriate indexes
```

### 9. Monitoring & Alerting

#### Setting Up Alerts

```bash
# Monitor disk space
df -h /opt/visitor-analytics-agent

# Monitor memory usage
watch -n 60 'free -h'

# Monitor process status
sudo systemctl status visitor-analytics-agent

# Set up email alerts
# Add to crontab:
*/5 * * * * /opt/visitor-analytics-agent/check-health.sh
```

#### Health Check Script

Create `check-health.sh`:

```bash
#!/bin/bash

# Health check script
HEALTH_URL="http://localhost:3000/health"
STATUS_URL="http://localhost:3000/api/status"

# Check if agent is responding
if ! curl -f $HEALTH_URL > /dev/null 2>&1; then
    echo "Agent health check failed at $(date)" >> /var/log/agent-health.log
    # Restart service
    sudo systemctl restart visitor-analytics-agent
fi

# Check disk space
DISK_USAGE=$(df -h /opt/visitor-analytics-agent | awk 'NR==2 {print $5}' | sed 's/%//')
if [ $DISK_USAGE -gt 90 ]; then
    echo "High disk usage: ${DISK_USAGE}%" >> /var/log/agent-health.log
    # Clean up old logs
    find /opt/visitor-analytics-agent/logs -name "*.log" -mtime +7 -delete
fi
```

### 10. Recovery Procedures

#### Complete System Failure

**Steps to recover:**

1. **Restore from backup:**
```bash
# Extract latest backup
cd /opt/visitor-analytics-agent
tar -xzf backups/backup_latest.tar.gz

# Restore data
cp -r data/backup/* data/
```

2. **Recreate service:**
```bash
# Reinstall dependencies
npm ci --only=production

# Restart service
sudo systemctl restart visitor-analytics-agent
```

3. **Verify recovery:**
```bash
curl http://localhost:3000/api/status
curl http://localhost:3000/health
```

#### Data Corruption Recovery

**Steps:**

1. **Identify corrupted data:**
```bash
sqlite3 data/visitors.db "PRAGMA integrity_check;"
```

2. **Attempt repair:**
```bash
# Backup first
cp data/visitors.db data/visitors.db.corrupted

# Attempt repair
echo '.dump' | sqlite3 data/visitors.db.corrupted | sqlite3 data/visitors.db.repaired

# Verify repair
sqlite3 data/visitors.db.repaired "PRAGMA integrity_check;"
```

3. **Restore if necessary:**
```bash
# If repair fails, restore from backup
./backup.sh --restore latest
```

### 11. Performance Tuning

#### Database Optimization

```bash
# Regular maintenance script
#!/bin/bash
DB_PATH="/opt/visitor-analytics-agent/data/visitors.db"

# Vacuum
sqlite3 $DB_PATH "VACUUM;"

# Reindex
sqlite3 $DB_PATH "REINDEX;"

# Analyze
sqlite3 $DB_PATH "ANALYZE;"

# Optimize
sqlite3 $DB_PATH "PRAGMA optimize;"
```

#### Memory Optimization

```javascript
// In server.js
// Increase garbage collection frequency
if (process.env.NODE_ENV === 'production') {
  global.gc();
}

// Use streaming for large responses
app.get('/api/admin/export/visitors', (req, res) => {
  const stream = db.stream('SELECT * FROM visitors');
  res.setHeader('Content-Type', 'text/csv');
  stream.pipe(res);
});
```

### 12. Common Error Messages

| Error Message | Cause | Solution |
|--------------|-------|----------|
| `ECONNREFUSED` | Service not running | Start the service |
| `ENOENT` | File/directory missing | Create missing files |
| `EACCES` | Permission denied | Fix file permissions |
| `ETIMEDOUT` | Network timeout | Check network/firewall |
| `ENOSPC` | Disk full | Free up disk space |
| `EMFILE` | Too many open files | Increase file descriptor limit |

### 13. Getting Help

#### Diagnostic Information

When asking for help, provide:

```bash
# System information
uname -a
node --version
npm --version

# Agent information
cat package.json | grep version
cat config/deployment.js | head -20

# Logs (last 100 lines)
tail -100 logs/agent.log

# Status
curl -s http://localhost:3000/api/status | jq .
```

#### Support Channels

1. **Documentation:**
   - README.md
   - API.md
   - DEPLOYMENT.md
   - This troubleshooting guide

2. **Community Support:**
   - GitHub Issues
   - Stack Overflow (tag: visitor-analytics-agent)

3. **Professional Support:**
   - Contact for enterprise support
   - Custom development services

### 14. Prevention Best Practices

1. **Regular Maintenance:**
   ```bash
   # Daily checks
   ./monitor.sh
   
   # Weekly optimization
   ./optimize-db.sh
   
   # Monthly backups verification
   ./verify-backups.sh
   ```

2. **Monitoring Setup:**
   - Set up alerting for critical issues
   - Monitor resource usage
   - Track error rates

3. **Security Updates:**
   - Regular dependency updates
   - Security patch application
   - Regular security audits

## Emergency Contact

For critical issues that cannot be resolved using this guide:

1. **Immediate Action:**
   - Stop the service if causing system issues
   - Isolate the affected system
   - Restore from backup

2. **Contact Support:**
   - Provide detailed error information
   - Include logs and configuration
   - Describe steps already taken

Remember: Always have a recent backup before making significant changes!