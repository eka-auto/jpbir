#!/bin/bash

# Visitor Analytics Agent Deployment Script
# This script helps deploy the agent to various environments

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="visitor-analytics-agent"
VERSION="2.0.0"
DEFAULT_PORT=3000
DEFAULT_ENV="production"

# Functions
print_header() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║           Visitor Analytics Agent Deployment             ║"
    echo "║                    Version ${VERSION}                         ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

check_dependencies() {
    print_info "Checking dependencies..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 16+"
        exit 1
    fi
    
    NODE_VERSION=$(node --version | cut -d'v' -f2)
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'.' -f1)
    
    if [ "$NODE_MAJOR" -lt 16 ]; then
        print_error "Node.js version must be 16 or higher. Current: $NODE_VERSION"
        exit 1
    fi
    
    print_success "Node.js $NODE_VERSION detected"
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    
    print_success "npm detected"
    
    # Check for required system packages (for network scanning)
    check_system_packages
}

check_system_packages() {
    local missing_packages=()
    
    # Check for ping utility
    if ! command -v ping &> /dev/null; then
        missing_packages+=("iputils-ping")
    fi
    
    # Check for arp utility
    if ! command -v arp &> /dev/null; then
        missing_packages+=("net-tools")
    fi
    
    # Check for sqlite3
    if ! command -v sqlite3 &> /dev/null; then
        missing_packages+=("sqlite3")
    fi
    
    if [ ${#missing_packages[@]} -gt 0 ]; then
        print_warning "Some system packages are missing: ${missing_packages[*]}"
        print_info "Network scanning features may be limited"
    else
        print_success "All system packages available"
    fi
}

setup_environment() {
    local env=$1
    local port=$2
    
    print_info "Setting up $env environment..."
    
    # Create environment file
    cat > .env.$env << EOF
# Visitor Analytics Agent - $env Environment
NODE_ENV=$env
PORT=$port
HOST=0.0.0.0

# Security Settings
CORS_ORIGIN=*
TRUST_PROXY=false

# Database Settings
DB_BACKUP_ENABLED=true

# Feature Flags
ENHANCED_COLLECTION=true
FINGERPRINTING=true
GDPR_COMPLIANCE=true
CCPA_COMPLIANCE=true
DATA_ENCRYPTION=true
CONSENT_MANAGEMENT=true

# Logging
LOG_LEVEL=info
LOG_FORMAT=combined

# External Services
CLOUDFLARE_ENABLED=false
SSL_ENABLED=true
WEBHOOKS_ENABLED=false

# Webhook URLs (if enabled)
# WEBHOOK_NEW_VISITOR=
# WEBHOOK_NETWORK_SCAN=
# WEBHOOK_ANALYTICS_REPORT=

# Privacy Policy URL
# PRIVACY_POLICY_URL=https://yourdomain.com/privacy
EOF
    
    print_success "Environment file created: .env.$env"
}

install_dependencies() {
    print_info "Installing dependencies..."
    
    if [ "$1" = "production" ]; then
        npm ci --only=production
    else
        npm ci
    fi
    
    if [ $? -eq 0 ]; then
        print_success "Dependencies installed successfully"
    else
        print_error "Failed to install dependencies"
        exit 1
    fi
}

setup_database() {
    print_info "Setting up databases..."
    
    # Create data directory
    mkdir -p data backups
    
    # Check if databases need initialization
    if [ ! -f "data/visitors.db" ]; then
        print_info "Initializing databases..."
        
        # Create a simple script to initialize databases
        node -e "
        const sqlite3 = require('sqlite3').verbose();
        const path = require('path');
        
        // Initialize visitors database
        const visitorsDb = new sqlite3.Database(path.join(__dirname, 'data', 'visitors.db'));
        
        visitorsDb.serialize(() => {
            visitorsDb.run(\`
                CREATE TABLE IF NOT EXISTS visitors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    visitor_id TEXT UNIQUE,
                    ip_address TEXT,
                    user_agent TEXT,
                    browser_name TEXT,
                    browser_version TEXT,
                    os_name TEXT,
                    os_version TEXT,
                    device_type TEXT,
                    country TEXT,
                    region TEXT,
                    city TEXT,
                    timezone TEXT,
                    latitude REAL,
                    longitude REAL,
                    network_isp TEXT,
                    referrer TEXT,
                    initial_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
                    total_time_spent INTEGER DEFAULT 0,
                    page_views INTEGER DEFAULT 1,
                    session_active BOOLEAN DEFAULT 1
                )
            \`);
            
            visitorsDb.run(\`
                CREATE TABLE IF NOT EXISTS network_info (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    visitor_id TEXT,
                    ip_address TEXT,
                    network_type TEXT,
                    bandwidth_estimate TEXT,
                    connection_type TEXT,
                    public_ip TEXT,
                    local_ip TEXT,
                    collected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (visitor_id) REFERENCES visitors(visitor_id)
                )
            \`);
            
            console.log('Visitors database initialized');
        });
        
        visitorsDb.close();
        
        // Initialize analytics database
        const analyticsDb = new sqlite3.Database(path.join(__dirname, 'data', 'analytics.db'));
        
        analyticsDb.serialize(() => {
            analyticsDb.run(\`
                CREATE TABLE IF NOT EXISTS hourly_stats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    date DATE,
                    hour INTEGER,
                    total_visitors INTEGER DEFAULT 0,
                    new_visitors INTEGER DEFAULT 0,
                    returning_visitors INTEGER DEFAULT 0,
                    total_page_views INTEGER DEFAULT 0,
                    avg_time_spent INTEGER DEFAULT 0,
                    bounce_rate REAL DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(date, hour)
                )
            \`);
            
            console.log('Analytics database initialized');
        });
        
        analyticsDb.close();
        "
        
        if [ $? -eq 0 ]; then
            print_success "Databases initialized successfully"
        else
            print_error "Failed to initialize databases"
            exit 1
        fi
    else
        print_success "Databases already exist"
    fi
    
    # Set proper permissions
    chmod 755 data
    chmod 644 data/*.db 2>/dev/null || true
}

setup_logging() {
    print_info "Setting up logging directory..."
    
    mkdir -p logs
    chmod 755 logs
    
    print_success "Logging directory created"
}

configure_ssl() {
    local domain=$1
    
    if [ -z "$domain" ]; then
        print_warning "No domain specified. SSL configuration skipped."
        return 0
    fi
    
    print_info "Configuring SSL for domain: $domain"
    
    # Check if certbot is available
    if command -v certbot &> /dev/null; then
        print_info "Certbot detected. Setting up Let's Encrypt certificate..."
        
        # Note: This is a simplified version. Actual certbot setup depends on web server configuration
        print_warning "SSL setup requires manual configuration with your web server (nginx/apache)"
        print_info "Suggested steps:"
        print_info "1. Configure your web server (nginx/apache) as reverse proxy"
        print_info "2. Run: sudo certbot --nginx -d $domain"
        print_info "3. Configure automatic renewal"
    else
        print_warning "Certbot not installed. Manual SSL configuration required."
        print_info "Install certbot: sudo apt install certbot python3-certbot-nginx"
    fi
}

setup_service() {
    local env=$1
    local port=$2
    
    print_info "Setting up system service..."
    
    # Check system type
    if [ -f /etc/systemd/system/ ]; then
        # Systemd service file
        cat > /etc/systemd/system/$APP_NAME.service << EOF
[Unit]
Description=Visitor Analytics Agent
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$(pwd)
Environment=NODE_ENV=$env
EnvironmentFile=$(pwd)/.env.$env
ExecStart=$(which node) server.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=$APP_NAME

# Security
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$(pwd)/data $(pwd)/logs

[Install]
WantedBy=multi-user.target
EOF
        
        print_success "Systemd service file created"
        print_info "To enable the service:"
        print_info "  sudo systemctl daemon-reload"
        print_info "  sudo systemctl enable $APP_NAME"
        print_info "  sudo systemctl start $APP_NAME"
        
    elif [ -f /etc/init.d/ ]; then
        # Init.d service file
        print_warning "init.d service creation not implemented"
        print_info "Manual service setup required for your system"
    else
        print_warning "Unknown init system. Manual service setup required."
    fi
}

create_nginx_config() {
    local domain=$1
    local port=$2
    
    if [ -z "$domain" ]; then
        print_warning "No domain specified. Nginx configuration skipped."
        return 0
    fi
    
    print_info "Creating nginx configuration for $domain"
    
    cat > nginx-$domain.conf << EOF
# Nginx Configuration for Visitor Analytics Agent - $domain
server {
    listen 80;
    listen [::]:80;
    server_name $domain;
    
    # Redirect to HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $domain;
    
    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/$domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    
    # Proxy settings
    location / {
        proxy_pass http://localhost:$port;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # Static files
    location /public/ {
        alias $(pwd)/public/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # Health check endpoint
    location /health {
        proxy_pass http://localhost:$port/health;
        access_log off;
    }
}
EOF
    
    print_success "Nginx configuration created: nginx-$domain.conf"
    print_info "To use this configuration:"
    print_info "1. Copy to /etc/nginx/sites-available/"
    print_info "2. Create symlink in /etc/nginx/sites-enabled/"
    print_info "3. Test configuration: sudo nginx -t"
    print_info "4. Reload nginx: sudo systemctl reload nginx"
}

setup_firewall() {
    local port=$1
    
    print_info "Configuring firewall..."
    
    # Check for ufw
    if command -v ufw &> /dev/null; then
        sudo ufw allow $port/tcp
        print_success "Firewall rule added for port $port"
    elif command -v firewall-cmd &> /dev/null; then
        sudo firewall-cmd --permanent --add-port=$port/tcp
        sudo firewall-cmd --reload
        print_success "Firewall rule added for port $port"
    else
        print_warning "No supported firewall detected. Manual configuration may be needed."
    fi
}

create_backup_script() {
    print_info "Creating backup script..."
    
    cat > backup.sh << 'EOF'
#!/bin/bash
# Backup script for Visitor Analytics Agent

set -e

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.tar.gz"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Create backup
echo "Creating backup..."
tar -czf "$BACKUP_FILE" \
    --exclude='node_modules' \
    --exclude='*.log' \
    --exclude='*.tar.gz' \
    data/ \
    config/ \
    .env* \
    package.json \
    package-lock.json \
    server.js \
    routes/ \
    utils/ \
    public/

# Keep only last 7 backups
echo "Cleaning up old backups..."
ls -t "$BACKUP_DIR"/backup_*.tar.gz | tail -n +8 | xargs -r rm

echo "Backup completed: $BACKUP_FILE"
EOF
    
    chmod +x backup.sh
    print_success "Backup script created: backup.sh"
}

create_monitoring_script() {
    print_info "Creating monitoring script..."
    
    cat > monitor.sh << 'EOF'
#!/bin/bash
# Monitoring script for Visitor Analytics Agent

set -e

APP_NAME="visitor-analytics-agent"
LOG_FILE="./logs/agent.log"
PORT=${PORT:-3000}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

check_service() {
    if curl -s http://localhost:$PORT/api/status > /dev/null; then
        echo -e "${GREEN}✓ Agent is running${NC}"
        return 0
    else
        echo -e "${RED}✗ Agent is not responding${NC}"
        return 1
    fi
}

check_disk_space() {
    local usage=$(df -h . | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ "$usage" -gt 90 ]; then
        echo -e "${RED}✗ Disk usage is high: ${usage}%${NC}"
        return 1
    else
        echo -e "${GREEN}✓ Disk usage: ${usage}%${NC}"
        return 0
    fi
}

check_memory() {
    local mem_free=$(free -m | awk 'NR==2 {print $4}')
    if [ "$mem_free" -lt 100 ]; then
        echo -e "${YELLOW}⚠ Low memory: ${mem_free}MB free${NC}"
        return 1
    else
        echo -e "${GREEN}✓ Memory: ${mem_free}MB free${NC}"
        return 0
    fi
}

check_logs() {
    local error_count=$(tail -100 "$LOG_FILE" 2>/dev/null | grep -c "ERROR\|error\|Error")
    if [ "$error_count" -gt 10 ]; then
        echo -e "${RED}✗ High error count in logs: $error_count errors in last 100 lines${NC}"
        return 1
    else
        echo -e "${GREEN}✓ Logs: $error_count errors in last 100 lines${NC}"
        return 0
    fi
}

check_database() {
    if [ -f "./data/visitors.db" ]; then
        local db_size=$(stat -f%z "./data/visitors.db" 2>/dev/null || stat -c%s "./data/visitors.db")
        local db_size_mb=$((db_size / 1024 / 1024))
        
        if [ "$db_size_mb" -gt 1000 ]; then
            echo -e "${YELLOW}⚠ Database size is large: ${db_size_mb}MB${NC}"
            return 1
        else
            echo -e "${GREEN}✓ Database size: ${db_size_mb}MB${NC}"
            return 0
        fi
    else
        echo -e "${RED}✗ Database file not found${NC}"
        return 1
    fi
}

# Run all checks
echo "=== Visitor Analytics Agent Monitoring ==="
echo "Time: $(date)"
echo

check_service
check_disk_space
check_memory
check_logs
check_database

echo
echo "=== Monitoring Complete ==="
EOF
    
    chmod +x monitor.sh
    print_success "Monitoring script created: monitor.sh"
}

print_deployment_summary() {
    local env=$1
    local port=$2
    local domain=$3
    
    echo
    echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}              Deployment Successful!                       ${NC}"
    echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
    echo
    echo "Application: $APP_NAME v$VERSION"
    echo "Environment: $env"
    echo "Port: $port"
    
    if [ -n "$domain" ]; then
        echo "Domain: $domain"
        echo "URL: https://$domain"
    else
        echo "URL: http://localhost:$port"
    fi
    
    echo
    echo "Next Steps:"
    echo "1. Review configuration in .env.$env"
    echo "2. Start the agent:"
    
    if [ "$env" = "production" ]; then
        echo "   sudo systemctl start $APP_NAME"
        echo "   sudo systemctl enable $APP_NAME"
    else
        echo "   npm start"
    fi
    
    if [ -n "$domain" ]; then
        echo "3. Configure nginx with nginx-$domain.conf"
        echo "4. Set up SSL certificates"
    fi
    
    echo "5. Monitor with: ./monitor.sh"
    echo "6. Backup with: ./backup.sh"
    echo
    echo "Important Files:"
    echo "  - .env.$env - Environment configuration"
    echo "  - nginx-$domain.conf - Nginx configuration (if domain provided)"
    echo "  - backup.sh - Backup utility"
    echo "  - monitor.sh - Monitoring utility"
    echo
    echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
}

# Main deployment function
deploy() {
    local env=${1:-$DEFAULT_ENV}
    local port=${2:-$DEFAULT_PORT}
    local domain=${3:-""}
    
    print_header
    
    # Check if we're in the right directory
    if [ ! -f "package.json" ] || [ ! -f "server.js" ]; then
        print_error "Must be run from the project root directory"
        exit 1
    fi
    
    # Step 1: Check dependencies
    check_dependencies
    
    # Step 2: Setup environment
    setup_environment "$env" "$port"
    
    # Step 3: Install dependencies
    install_dependencies "$env"
    
    # Step 4: Setup database
    setup_database
    
    # Step 5: Setup logging
    setup_logging
    
    # Step 6: Setup SSL (if domain provided)
    if [ -n "$domain" ]; then
        configure_ssl "$domain"
    fi
    
    # Step 7: Setup system service (for production)
    if [ "$env" = "production" ]; then
        setup_service "$env" "$port"
    fi
    
    # Step 8: Create nginx config (if domain provided)
    if [ -n "$domain" ]; then
        create_nginx_config "$domain" "$port"
    fi
    
    # Step 9: Setup firewall (for production)
    if [ "$env" = "production" ]; then
        setup_firewall "$port"
    fi
    
    # Step 10: Create utility scripts
    create_backup_script
    create_monitoring_script
    
    # Step 11: Print summary
    print_deployment_summary "$env" "$port" "$domain"
}

# Quick start function for development
quick_start() {
    print_header
    
    print_info "Starting quick development setup..."
    
    check_dependencies
    setup_environment "development" "$DEFAULT_PORT"
    install_dependencies "development"
    setup_database
    setup_logging
    
    print_success "Development environment setup complete!"
    echo
    echo "To start the agent:"
    echo "  npm run dev"
    echo
    echo "Access the application at:"
    echo "  http://localhost:$DEFAULT_PORT"
    echo
    echo "Dashboard:"
    echo "  http://localhost:$DEFAULT_PORT/dashboard"
}

# Help function
show_help() {
    print_header
    
    echo "Usage: $0 [command] [options]"
    echo
    echo "Commands:"
    echo "  deploy [env] [port] [domain]  Deploy to specified environment"
    echo "  quick-start                   Setup development environment"
    echo "  help                          Show this help message"
    echo
    echo "Environments:"
    echo "  development (default)"
    echo "  staging"
    echo "  production"
    echo
    echo "Examples:"
    echo "  $0 deploy production 3000 example.com"
    echo "  $0 deploy staging 3001"
    echo "  $0 quick-start"
    echo
    echo "For production deployment with a domain, provide the domain name:"
    echo "  $0 deploy production 3000 yourdomain.com"
}

# Parse command line arguments
case "$1" in
    "deploy")
        deploy "$2" "$3" "$4"
        ;;
    "quick-start"|"dev")
        quick_start
        ;;
    "help"|"--help"|"-h")
        show_help
        ;;
    *)
        if [ $# -eq 0 ]; then
            show_help
        else
            print_error "Unknown command: $1"
            echo
            show_help
            exit 1
        fi
        ;;
esac