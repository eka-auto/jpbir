# Visitor Analytics Agent Deployment Guide

## Overview

This guide provides comprehensive instructions for deploying the Visitor Analytics Agent in various environments, from development to production.

## Prerequisites

### System Requirements

- **Node.js**: 16.x or higher
- **npm**: 8.x or higher
- **SQLite3**: 3.x or higher
- **Network Utilities**: ping, arp (for network scanning)
- **Disk Space**: 1GB minimum, 10GB recommended
- **Memory**: 512MB minimum, 2GB recommended
- **Port**: 3000 (default) available

### Network Requirements

- Outbound HTTP/HTTPS access for geolocation APIs
- Inbound HTTP/HTTPS access for visitor tracking
- Local network access for device scanning (if enabled)

## Quick Start

### Development Environment

```bash
# 1. Clone or download the project
git clone <repository-url>
cd visitor-analytics-agent

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev

# 4. Access the application
# - Main interface: http://localhost:3000
# - Dashboard: http://localhost:3000/dashboard
# - API status: http://localhost:3000/api/status
```

### Using Deployment Script

The project includes an automated deployment script:

```bash
# Make script executable
chmod +x deploy.sh

# Development setup
./deploy.sh quick-start

# Production deployment
./deploy.sh deploy production 3000

# Production with domain
./deploy.sh deploy production 3000 yourdomain.com
```

## Deployment Methods

### Method 1: Direct Node.js (Simplest)

```bash
# 1. Install dependencies
npm ci --only=production

# 2. Set environment variables
export NODE_ENV=production
export PORT=3000
export HOST=0.0.0.0

# 3. Start the agent
npm start

# 4. Set up process manager (PM2 recommended)
npm install -g pm2
pm2 start server.js --name "visitor-analytics-agent"
pm2 save
pm2 startup
```

### Method 2: Docker (Recommended)

```bash
# 1. Build Docker image
docker build -t visitor-analytics-agent .

# 2. Run container
docker run -d \
  --name visitor-analytics-agent \
  -p 3000:3000 \
  -v ./data:/app/data \
  -v ./logs:/app/logs \
  -e NODE_ENV=production \
  visitor-analytics-agent

# 3. Using docker-compose
docker-compose up -d
```

### Method 3: Docker Compose (Full Stack)

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your settings

# 2. Start all services
docker-compose up -d

# 3. Access services
# - Agent: http://localhost:3000
# - Grafana: http://localhost:3001 (admin/admin)
# - Prometheus: http://localhost:9090
```

## Production Deployment

### Step 1: Server Preparation

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y \
  nodejs \
  npm \
  sqlite3 \
  iputils-ping \
  net-tools \
  curl \
  nginx \
  certbot \
  python3-certbot-nginx

# Configure firewall
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

### Step 2: Application Setup

```bash
# Create application directory
sudo mkdir -p /opt/visitor-analytics-agent
sudo chown -R $USER:$USER /opt/visitor-analytics-agent
cd /opt/visitor-analytics-agent

# Clone or copy application files
git clone <repository-url> .
# or copy files from your local machine

# Install dependencies
npm ci --only=production

# Create data directories
mkdir -p data logs backups
chmod 755 data logs backups
```

### Step 3: Environment Configuration

Create `/opt/visitor-analytics-agent/.env.production`:

```env
# Application Settings
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Security Settings
CORS_ORIGIN=https://yourdomain.com
TRUST_PROXY=true

# Database Settings
DB_BACKUP_ENABLED=true

# Feature Flags
ENHANCED_COLLECTION=true
FINGERPRINTING=true
GDPR_COMPLIANCE=true
CCPA_COMPLIANCE=true
DATA_ENCRYPTION=true

# Logging
LOG_LEVEL=info
LOG_FORMAT=combined

# External Services
CLOUDFLARE_ENABLED=false
SSL_ENABLED=true
WEBHOOKS_ENABLED=false

# Webhook URLs (optional)
# WEBHOOK_NEW_VISITOR=https://your-webhook-url/new-visitor
# WEBHOOK_NETWORK_SCAN=https://your-webhook-url/network-scan
# WEBHOOK_ANALYTICS_REPORT=https://your-webhook-url/analytics-report

# Privacy Policy URL
PRIVACY_POLICY_URL=https://yourdomain.com/privacy
```

### Step 4: Systemd Service

Create `/etc/systemd/system/visitor-analytics-agent.service`:

```ini
[Unit]
Description=Visitor Analytics Agent
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/visitor-analytics-agent
Environment=NODE_ENV=production
EnvironmentFile=/opt/visitor-analytics-agent/.env.production
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=visitor-analytics-agent

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=/opt/visitor-analytics-agent/data /opt/visitor-analytics-agent/logs

[Install]
WantedBy=multi-user.target
```

Enable and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable visitor-analytics-agent
sudo systemctl start visitor-analytics-agent
sudo systemctl status visitor-analytics-agent
```

### Step 5: Nginx Configuration

Create `/etc/nginx/sites-available/visitor-analytics-agent`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com www.yourdomain.com;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    # SSL configuration (Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    
    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; frame-ancestors 'self';" always;

    # Proxy settings
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health check
    location /health {
        access_log off;
        proxy_pass http://localhost:3000/health;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    # Deny access to sensitive files
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/visitor-analytics-agent /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 6: SSL Certificate (Let's Encrypt)

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Obtain certificate
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Auto-renewal (already configured by certbot)
sudo certbot renew --dry-run
```

### Step 7: Monitoring Setup

```bash
# Install monitoring tools
sudo apt install -y prometheus-node-exporter

# Configure backup cron job
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/visitor-analytics-agent/backup.sh") | crontab -

# Configure log rotation
sudo tee /etc/logrotate.d/visitor-analytics-agent << EOF
/opt/visitor-analytics-agent/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 www-data www-data
    sharedscripts
    postrotate
        systemctl reload visitor-analytics-agent > /dev/null 2>&1 || true
    endscript
}
EOF
```

## Cloud Deployment

### AWS EC2 Deployment

```bash
# Launch EC2 instance (Ubuntu 22.04 LTS)
# Security group: Allow ports 22, 80, 443

# Connect to instance
ssh -i your-key.pem ubuntu@your-ec2-public-ip

# Follow "Production Deployment" steps above
```

### AWS Elastic Beanstalk

1. Create `Dockerrun.aws.json`:
```json
{
  "AWSEBDockerrunVersion": "2",
  "containerDefinitions": [
    {
      "name": "visitor-analytics-agent",
      "image": "your-ecr-repo/visitor-analytics-agent:latest",
      "essential": true,
      "memory": 512,
      "portMappings": [
        {
          "hostPort": 80,
          "containerPort": 3000
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        }
      ],
      "mountPoints": [
        {
          "sourceVolume": "awseb-logs-visitor-analytics-agent",
          "containerPath": "/app/logs"
        }
      ]
    }
  ]
}
```

2. Deploy using EB CLI:
```bash
eb init -p docker visitor-analytics-agent
eb create visitor-analytics-agent-env
```

### Google Cloud Run

```bash
# Build and push image
gcloud builds submit --tag gcr.io/your-project/visitor-analytics-agent

# Deploy to Cloud Run
gcloud run deploy visitor-analytics-agent \
  --image gcr.io/your-project/visitor-analytics-agent \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="NODE_ENV=production" \
  --memory=512Mi
```

### Azure App Service

```bash
# Create resource group
az group create --name VisitorAnalyticsRG --location eastus

# Create App Service plan
az appservice plan create \
  --name VisitorAnalyticsPlan \
  --resource-group VisitorAnalyticsRG \
  --sku B1 \
  --is-linux

# Create web app
az webapp create \
  --name visitor-analytics-agent \
  --resource-group VisitorAnalyticsRG \
  --plan VisitorAnalyticsPlan \
  --runtime "NODE|18-lts"

# Configure environment variables
az webapp config appsettings set \
  --name visitor-analytics-agent \
  --resource-group VisitorAnalyticsRG \
  --settings NODE_ENV=production
```

## Container Orchestration

### Kubernetes Deployment

Create `kubernetes/deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: visitor-analytics-agent
spec:
  replicas: 3
  selector:
    matchLabels:
      app: visitor-analytics-agent
  template:
    metadata:
      labels:
        app: visitor-analytics-agent
    spec:
      containers:
      - name: agent
        image: visitor-analytics-agent:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        volumeMounts:
        - name: data
          mountPath: /app/data
        - name: logs
          mountPath: /app/logs
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: agent-data-pvc
      - name: logs
        emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: visitor-analytics-agent
spec:
  selector:
    app: visitor-analytics-agent
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer
```

### Docker Swarm

```bash
# Initialize swarm
docker swarm init

# Deploy stack
docker stack deploy -c docker-compose.yml visitor-analytics

# Scale services
docker service scale visitor-analytics_analytics-agent=3
```

## Monitoring & Maintenance

### Health Checks

```bash
# Check service status
sudo systemctl status visitor-analytics-agent

# Check logs
sudo journalctl -u visitor-analytics-agent -f
tail -f /opt/visitor-analytics-agent/logs/agent.log

# Check API health
curl -f http://localhost:3000/health
curl http://localhost:3000/api/status
```

### Backup Strategy

1. **Automated Backups** (cron job):
```bash
# Daily backup at 2 AM
0 2 * * * /opt/visitor-analytics-agent/backup.sh
```

2. **Manual Backup**:
```bash
cd /opt/visitor-analytics-agent
./backup.sh
```

3. **Restore Backup**:
```bash
# Extract backup
tar -xzf backups/backup_20240101_020000.tar.gz

# Restore data
cp -r data/backup/* data/
```

### Performance Monitoring

1. **Resource Monitoring**:
```bash
# Check memory usage
free -h

# Check disk usage
df -h

# Check process resources
top -p $(pgrep -f "node server.js")
```

2. **Application Metrics**:
- Real-time analytics: `/api/analytics/realtime`
- Performance metrics: Built-in Node.js metrics
- Custom metrics: Prometheus endpoint (if enabled)

### Security Hardening

1. **Regular Updates**:
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Update Node.js dependencies
cd /opt/visitor-analytics-agent
npm audit
npm update
```

2. **Security Headers** (already configured in nginx):
- HSTS
- CSP
- X-Frame-Options
- X-Content-Type-Options

3. **Access Control**:
```bash
# Restrict file permissions
sudo chown -R www-data:www-data /opt/visitor-analytics-agent
sudo chmod 750 /opt/visitor-analytics-agent
sudo chmod 640 /opt/visitor-analytics-agent/.env.production
```

## Troubleshooting

### Common Issues

1. **Port already in use**:
```bash
# Find process using port 3000
sudo lsof -i :3000

# Kill process
sudo kill -9 <PID>

# Or change port in .env.production
PORT=3001
```

2. **Database issues**:
```bash
# Check database file
ls -la data/*.db

# Repair SQLite database
sqlite3 data/visitors.db ".dump" | sqlite3 data/visitors.db.new
mv data/visitors.db.new data/visitors.db
```

3. **Network scanning not working**:
```bash
# Check network utilities
which ping
which arp

# Test network access
ping -c 1 192.168.1.1
```

4. **High memory usage**:
```bash
# Increase memory limit
NODE_OPTIONS="--max-old-space-size=1024" npm start
```

### Log Analysis

Check different log files:

```bash
# Application logs
tail -f logs/agent.log

# Access logs
tail -f logs/access.log

# Error logs
tail -f logs/error.log

# System logs
sudo journalctl -u visitor-analytics-agent -f
```

### Performance Optimization

1. **Database optimization**:
```bash
# Regular vacuum
sqlite3 data/visitors.db "VACUUM;"

# Reindex
sqlite3 data/visitors.db "REINDEX;"
```

2. **Cache configuration**:
- Enable Redis caching (if using docker-compose setup)
- Configure CDN for static assets

3. **Load balancing**:
- Deploy multiple instances behind load balancer
- Use sticky sessions if needed

## Scaling Strategies

### Vertical Scaling
- Increase server resources (CPU, RAM, disk)
- Upgrade to higher-tier instance

### Horizontal Scaling
- Deploy multiple instances
- Use load balancer
- Implement database clustering

### Geographic Scaling
- Deploy in multiple regions
- Use CDN for static assets
- Implement geo-DNS routing

## Disaster Recovery

### Backup Strategy
1. **Daily**: Full application backup
2. **Weekly**: Database export
3. **Monthly**: Full system snapshot

### Recovery Procedures
1. **Data Loss**:
   - Restore from latest backup
   - Rebuild indexes
   - Verify data integrity

2. **Server Failure**:
   - Spin up new instance
   - Restore from backup
   - Update DNS records

3. **Security Breach**:
   - Isolate affected systems
   - Rotate credentials
   - Restore from clean backup

## Compliance & Legal

### Data Protection
- Configure GDPR/CCPA compliance
- Implement data retention policies
- Provide privacy policy URL

### Logging & Auditing
- Enable audit logging
- Store logs securely
- Regular log review

### Security Compliance
- Regular security audits
- Vulnerability scanning
- Penetration testing

## Support & Resources

### Documentation
- [API Documentation](API.md)
- [Configuration Guide](config/deployment.js)
- [Troubleshooting Guide](docs/TROUBLESHOOTING.md)

### Community Support
- GitHub Issues
- Discord Community
- Stack Overflow

### Professional Support
- Enterprise support plans
- Custom development
- Security audits

## Conclusion

The Visitor Analytics Agent is designed for reliable, scalable deployment across various environments. Follow this guide for a successful deployment, and refer to the troubleshooting section for common issues.

For additional assistance, consult the documentation or contact support.