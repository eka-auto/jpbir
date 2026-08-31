#!/bin/bash

# Integration Setup Script for jaytibirthday.in Analytics
# Run this on your server to integrate analytics agent with your domain

set -e

echo "=========================================="
echo "  jaytibirthday.in Analytics Integration"
echo "=========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo "Please run as root (sudo ./setup_integration.sh)"
    exit 1
fi

# Variables
DOMAIN="jaytibirthday.in"
ANALYTICS_PORT="3001"
NGINX_CONFIG="/etc/nginx/sites-available/jaytibirthday-analytics.conf"
NGINX_ENABLED="/etc/nginx/sites-enabled/jaytibirthday-analytics.conf"
WEB_ROOT="/var/www/jaytibirthday.in"
ANALYTICS_ROOT="/var/www/analytics"
SCRIPT_DIR="$(dirname "$0")"

echo "📋 Configuration:"
echo "   Domain: $DOMAIN"
echo "   Analytics Port: $ANALYTICS_PORT"
echo "   Web Root: $WEB_ROOT"
echo ""

# Step 1: Install required packages
echo "🔧 Step 1: Installing required packages..."
apt-get update
apt-get install -y nginx certbot python3-certbot-nginx

# Step 2: Create directory structure
echo "📁 Step 2: Creating directory structure..."
mkdir -p $WEB_ROOT
mkdir -p $ANALYTICS_ROOT
mkdir -p /var/log/jaytibirthday-analytics
mkdir -p /etc/nginx/ssl

# Step 3: Deploy analytics JavaScript
echo "📦 Step 3: Deploying analytics JavaScript..."
if [ -f "$SCRIPT_DIR/website_tracker.js" ]; then
    # Create minified version
    uglifyjs "$SCRIPT_DIR/website_tracker.js" -c -m -o "$ANALYTICS_ROOT/jaytibirthday-analytics.min.js"
    cp "$ANALYTICS_ROOT/jaytibirthday-analytics.min.js" "$WEB_ROOT/assets/js/jaytibirthday-analytics.js"
    echo "   ✅ Analytics JavaScript deployed"
else
    echo "   ⚠️  Analytics JavaScript file not found"
fi

# Step 4: Configure Nginx
echo "🌐 Step 4: Configuring Nginx..."
if [ -f "$SCRIPT_DIR/nginx_config.conf" ]; then
    cp "$SCRIPT_DIR/nginx_config.conf" "$NGINX_CONFIG"
    
    # Enable the site
    if [ ! -f "$NGINX_ENABLED" ]; then
        ln -s "$NGINX_CONFIG" "$NGINX_ENABLED"
    fi
    
    echo "   ✅ Nginx configuration deployed"
else
    echo "   ⚠️  Nginx configuration file not found"
fi

# Step 5: Set up SSL certificates
echo "🔐 Step 5: Setting up SSL certificates..."
read -p "Do you want to obtain SSL certificates from Let's Encrypt? (y/n): " ssl_choice
if [ "$ssl_choice" = "y" ] || [ "$ssl_choice" = "Y" ]; then
    echo "   Obtaining SSL certificates..."
    certbot --nginx -d $DOMAIN -d www.$DOMAIN -d analytics.$DOMAIN
    
    # Auto-renewal setup
    echo "0 0 1 * * certbot renew --quiet" | crontab -
    echo "   ✅ SSL certificates configured with auto-renewal"
else
    echo "   ⚠️  Skipping SSL certificate setup"
    echo "   Please manually configure SSL certificates in $NGINX_CONFIG"
fi

# Step 6: Configure analytics agent
echo "🤖 Step 6: Configuring analytics agent..."
if [ -d "/var/www/jaytibirthday-in-analytics" ]; then
    # Update agent configuration for domain integration
    cat > "/var/www/jaytibirthday-in-analytics/config/domain_config.js" << EOF
// Domain configuration for jaytibirthday.in
module.exports = {
    domain: 'jaytibirthday.in',
    analyticsPath: '/api/track',
    secure: true,
    corsOrigin: 'https://jaytibirthday.in',
    
    // Update database paths for production
    database: {
        visitors: '/var/data/analytics/visitors.db',
        analytics: '/var/data/analytics/analytics.db'
    },
    
    // Monitoring settings
    monitoring: {
        enabled: true,
        logPath: '/var/log/jaytibirthday-analytics/agent.log',
        metricsPath: '/var/log/jaytibirthday-analytics/metrics.log'
    }
};
EOF
    echo "   ✅ Analytics agent configured"
else
    echo "   ⚠️  Analytics agent directory not found"
fi

# Step 7: Set up analytics dashboard authentication
echo "🔑 Step 7: Setting up dashboard authentication..."
read -p "Enter username for analytics dashboard: " dashboard_user
read -sp "Enter password for analytics dashboard: " dashboard_pass
echo ""
echo "$dashboard_user:$(openssl passwd -crypt $dashboard_pass)" > /etc/nginx/.htpasswd-analytics
echo "   ✅ Dashboard authentication configured"

# Step 8: Set up log rotation
echo "📊 Step 8: Setting up log rotation..."
cat > /etc/logrotate.d/jaytibirthday-analytics << EOF
/var/log/jaytibirthday-analytics/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 640 root adm
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 \$(cat /var/run/nginx.pid)
    endscript
}
EOF
echo "   ✅ Log rotation configured"

# Step 9: Set up monitoring service
echo "📈 Step 9: Setting up monitoring service..."
cat > /etc/systemd/system/jaytibirthday-analytics.service << EOF
[Unit]
Description=Jayati Birthday Analytics Agent
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/jaytibirthday-in-analytics
ExecStart=/usr/bin/node server.js
Environment="PORT=$ANALYTICS_PORT"
Environment="NODE_ENV=production"
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable jaytibirthday-analytics
echo "   ✅ Monitoring service configured"

# Step 10: Test Nginx configuration
echo "🧪 Step 10: Testing configuration..."
nginx -t
if [ $? -eq 0 ]; then
    echo "   ✅ Nginx configuration test passed"
    
    # Restart Nginx
    systemctl restart nginx
    echo "   ✅ Nginx restarted"
    
    # Start analytics agent
    systemctl start jaytibirthday-analytics
    echo "   ✅ Analytics agent started"
else
    echo "   ❌ Nginx configuration test failed"
    echo "   Please check the configuration at $NGINX_CONFIG"
fi

# Step 11: Create monitoring script
echo "👁️ Step 11: Creating monitoring script..."
cat > /usr/local/bin/monitor-analytics.sh << 'EOF'
#!/bin/bash
echo "=== Jayati Birthday Analytics Status ==="
echo ""
echo "1. Nginx Status:"
systemctl status nginx --no-pager | grep -E "(Active|Main PID)"
echo ""
echo "2. Analytics Agent Status:"
systemctl status jaytibirthday-analytics --no-pager | grep -E "(Active|Main PID)"
echo ""
echo "3. Recent Logs (last 10 lines):"
tail -10 /var/log/jaytibirthday-analytics/agent.log
echo ""
echo "4. Disk Usage:"
df -h /var/www /var/data
echo ""
echo "5. Memory Usage:"
free -h
EOF

chmod +x /usr/local/bin/monitor-analytics.sh
echo "   ✅ Monitoring script created"

echo ""
echo "=========================================="
echo "🎉 Integration Complete!"
echo "=========================================="
echo ""
echo "📊 Analytics Access URLs:"
echo "   - Main Website: https://$DOMAIN"
echo "   - Analytics Dashboard: https://$DOMAIN/dashboard"
echo "   - Admin Dashboard: https://analytics.$DOMAIN"
echo ""
echo "🔧 Management Commands:"
echo "   - Check status: monitor-analytics.sh"
echo "   - View agent logs: tail -f /var/log/jaytibirthday-analytics/agent.log"
echo "   - Restart agent: systemctl restart jaytibirthday-analytics"
echo "   - Test analytics: curl https://$DOMAIN/api/track"
echo ""
echo "📋 Next Steps:"
echo "   1. Add JavaScript snippet to your website HTML"
echo "   2. Test visitor tracking is working"
echo "   3. Monitor analytics in the dashboard"
echo "   4. Set up automated backups"
echo ""
echo "✅ Integration with $DOMAIN is now active in the background!"
echo "=========================================="