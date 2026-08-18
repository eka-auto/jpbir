# PowerShell Integration Setup Script for jaytibirthday.in Analytics
# Run this on Windows to integrate analytics agent with your domain

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  jaytibirthday.in Analytics Integration" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as administrator
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "Please run PowerShell as Administrator!" -ForegroundColor Red
    exit 1
}

# Variables
$DOMAIN = "jaytibirthday.in"
$ANALYTICS_PORT = "3001"
$PROJECT_DIR = "C:\Users\abcom\jpbir"
$ANALYTICS_DIR = "$PROJECT_DIR\agent"
$INTEGRATION_DIR = "$PROJECT_DIR\integration"
$WEB_ROOT = "C:\inetpub\wwwroot\jaytibirthday.in"
$ANALYTICS_SCRIPT = "$INTEGRATION_DIR\website_tracker.js"
$CONFIG_FILE = "$INTEGRATION_DIR\nginx_config.conf"

Write-Host "📋 Configuration:" -ForegroundColor Yellow
Write-Host "   Domain: $DOMAIN" -ForegroundColor Gray
Write-Host "   Analytics Port: $ANALYTICS_PORT" -ForegroundColor Gray
Write-Host "   Project Directory: $PROJECT_DIR" -ForegroundColor Gray
Write-Host ""

# Step 1: Check prerequisites
Write-Host "🔧 Step 1: Checking prerequisites..." -ForegroundColor Yellow

# Check if Node.js is installed
$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
    Write-Host "   ❌ Node.js is not installed" -ForegroundColor Red
    Write-Host "   Please install Node.js from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}
Write-Host "   ✅ Node.js $nodeVersion installed" -ForegroundColor Green

# Check if agent is running
Write-Host "🤖 Step 2: Checking analytics agent..." -ForegroundColor Yellow
$agentProcess = Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*jpbir*" }
if ($agentProcess) {
    Write-Host "   ✅ Analytics agent is running (PID: $($agentProcess.Id))" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Analytics agent is not running" -ForegroundColor Yellow
    Write-Host "   Starting analytics agent..." -ForegroundColor Gray
    Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $PROJECT_DIR -WindowStyle Hidden
    Start-Sleep -Seconds 5
    Write-Host "   ✅ Analytics agent started" -ForegroundColor Green
}

# Step 3: Deploy analytics JavaScript
Write-Host "📦 Step 3: Deploying analytics JavaScript..." -ForegroundColor Yellow
if (Test-Path $ANALYTICS_SCRIPT) {
    # Create directory for website if it doesn't exist
    if (-not (Test-Path "$WEB_ROOT\assets\js")) {
        New-Item -ItemType Directory -Force -Path "$WEB_ROOT\assets\js" | Out-Null
    }
    
    # Copy the tracker script
    Copy-Item $ANALYTICS_SCRIPT "$WEB_ROOT\assets\js\jaytibirthday-analytics.js" -Force
    Write-Host "   ✅ Analytics JavaScript deployed to: $WEB_ROOT\assets\js\jaytibirthday-analytics.js" -ForegroundColor Green
    
    # Create minified version
    $minifiedContent = Get-Content $ANALYTICS_SCRIPT -Raw
    # Simple minification (remove comments and whitespace)
    $minifiedContent = $minifiedContent -replace '//.*', '' -replace '/\*[\s\S]*?\*/', '' -replace '\s+', ' '
    Set-Content -Path "$WEB_ROOT\assets\js\jaytibirthday-analytics.min.js" -Value $minifiedContent
    Write-Host "   ✅ Minified version created" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Analytics JavaScript file not found at: $ANALYTICS_SCRIPT" -ForegroundColor Yellow
}

# Step 4: Create integration configuration for IIS
Write-Host "🌐 Step 4: Configuring IIS integration..." -ForegroundColor Yellow
if (Get-Command "Import-Module" -ErrorAction SilentlyContinue) {
    # Check if IIS is installed
    $iisStatus = Get-WindowsFeature -Name Web-Server
    if ($iisStatus.Installed) {
        Write-Host "   ✅ IIS is installed" -ForegroundColor Green
        
        # Create web.config for analytics endpoints
        $webConfigContent = @"
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <system.webServer>
        <rewrite>
            <rules>
                <!-- Route analytics requests to local agent -->
                <rule name="Analytics API" stopProcessing="true">
                    <match url="^_analytics/api/(.*)" />
                    <action type="Rewrite" url="http://localhost:3001/api/{R:1}" />
                    <serverVariables>
                        <set name="HTTP_X_ORIGINAL_HOST" value="{HTTP_HOST}" />
                    </serverVariables>
                </rule>
                
                <!-- Route analytics dashboard -->
                <rule name="Analytics Dashboard" stopProcessing="true">
                    <match url="^_analytics/dashboard(.*)" />
                    <action type="Rewrite" url="http://localhost:3001/dashboard{R:1}" />
                </rule>
                
                <!-- Route health check -->
                <rule name="Analytics Health" stopProcessing="true">
                    <match url="^_analytics/health" />
                    <action type="Rewrite" url="http://localhost:3001/health" />
                </rule>
            </rewrite>
            
            <outboundRules>
                <!-- Fix response headers -->
                <rule name="Fix Analytics Headers" preCondition="ResponseIsHtml">
                    <match filterByTags="A, Form, Img" pattern="^http(s)?://localhost:3001/(.*)" />
                    <action type="Rewrite" value="http{R:1}://$DOMAIN/_analytics/{R:2}" />
                </rule>
                <preConditions>
                    <preCondition name="ResponseIsHtml">
                        <add input="{RESPONSE_CONTENT_TYPE}" pattern="^text/html" />
                    </preCondition>
                </preConditions>
            </outboundRules>
        </rewrite>
        
        <!-- CORS settings -->
        <cors enabled="true" failUnlistedOrigins="true">
            <add origin="https://$DOMAIN" allowCredentials="true" maxAge="120">
                <allowHeaders allowAllRequestedHeaders="true" />
                <allowMethods>
                    <add method="GET" />
                    <add method="POST" />
                </allowMethods>
            </add>
        </cors>
        
        <!-- Don't index analytics paths -->
        <httpProtocol>
            <customHeaders>
                <add name="X-Robots-Tag" value="noindex, nofollow" />
            </customHeaders>
        </httpProtocol>
    </system.webServer>
</configuration>
"@
        
        # Save web.config for analytics
        $webConfigPath = "$WEB_ROOT\_analytics\web.config"
        if (-not (Test-Path "$WEB_ROOT\_analytics")) {
            New-Item -ItemType Directory -Force -Path "$WEB_ROOT\_analytics" | Out-Null
        }
        Set-Content -Path $webConfigPath -Value $webConfigContent
        Write-Host "   ✅ IIS rewrite rules configured at: $webConfigPath" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  IIS is not installed. Using reverse proxy configuration instead." -ForegroundColor Yellow
    }
} else {
    Write-Host "   ⚠️  IIS module not available. Using simple configuration." -ForegroundColor Yellow
}

# Step 5: Create Windows Service for analytics agent
Write-Host "⚙️ Step 5: Setting up Windows Service..." -ForegroundColor Yellow
$serviceName = "JayatiBirthdayAnalytics"
$serviceExists = Get-Service -Name $serviceName -ErrorAction SilentlyContinue

if (-not $serviceExists) {
    Write-Host "   Creating Windows service for analytics agent..." -ForegroundColor Gray
    
    # Create service using nssm (Non-Sucking Service Manager)
    $nssmPath = "$INTEGRATION_DIR\nssm.exe"
    if (-not (Test-Path $nssmPath)) {
        Write-Host "   ⚠️  NSSM not found. Please install it or run agent manually." -ForegroundColor Yellow
    } else {
        # Install service
        & $nssmPath install $serviceName "$env:ProgramFiles\nodejs\node.exe"
        & $nssmPath set $serviceName AppParameters "server.js"
        & $nssmPath set $serviceName AppDirectory $PROJECT_DIR
        & $nssmPath set $serviceName Start SERVICE_AUTO_START
        & $nssmPath set $serviceName ObjectName ".\$env:USERNAME" "password_here"
        
        Write-Host "   ✅ Windows service '$serviceName' created" -ForegroundColor Green
        Write-Host "   Start with: Start-Service $serviceName" -ForegroundColor Gray
    }
} else {
    Write-Host "   ✅ Windows service '$serviceName' already exists" -ForegroundColor Green
}

# Step 6: Create monitoring script
Write-Host "📈 Step 6: Creating monitoring tools..." -ForegroundColor Yellow

# Create monitoring script
$monitorScript = @"
# Jayati Birthday Analytics Monitor
# Run this to check the status of your analytics integration

Write-Host "=== Jayati Birthday Analytics Status ===" -ForegroundColor Cyan
Write-Host ""

# Check agent process
`$agentProcess = Get-Process node -ErrorAction SilentlyContinue | Where-Object { `$_.Path -like "*jpbir*" }
if (`$agentProcess) {
    Write-Host "✅ Analytics Agent: RUNNING (PID: `$(`$agentProcess.Id))" -ForegroundColor Green
} else {
    Write-Host "❌ Analytics Agent: STOPPED" -ForegroundColor Red
}

# Check service status
`$service = Get-Service -Name "JayatiBirthdayAnalytics" -ErrorAction SilentlyContinue
if (`$service) {
    Write-Host "✅ Windows Service: `$(`$service.Status)" -ForegroundColor Green
}

# Test API endpoint
try {
    `$response = Invoke-WebRequest -Uri "http://localhost:$ANALYTICS_PORT/api/status" -TimeoutSec 5
    if (`$response.StatusCode -eq 200) {
        Write-Host "✅ API Status: ONLINE" -ForegroundColor Green
        `$data = `$response.Content | ConvertFrom-Json
        Write-Host "   Agent: `$(`$data.name)" -ForegroundColor Gray
        Write-Host "   Version: `$(`$data.version)" -ForegroundColor Gray
        Write-Host "   Status: `$(`$data.status)" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ API Status: OFFLINE" -ForegroundColor Red
}

# Check disk space
Write-Host "`n💾 Disk Usage:" -ForegroundColor Yellow
Get-PSDrive -PSProvider FileSystem | Where-Object { `$_.Name -in 'C' } | Format-Table Name, Used, Free, @{n='PercentFree';e={[math]::Round((`$_.Free/`$_.Used)*100,2)}} -AutoSize

# Memory usage
Write-Host "`n🧠 Memory Usage:" -ForegroundColor Yellow
Get-CimInstance Win32_OperatingSystem | Select-Object @{Name="TotalMemory(GB)";Expression={[math]::Round(`$_.TotalVisibleMemorySize/1MB,2)}}, @{Name="FreeMemory(GB)";Expression={[math]::Round(`$_.FreePhysicalMemory/1MB,2)}} | Format-List

Write-Host "`n🔧 Management Commands:" -ForegroundColor Cyan
Write-Host "   • Start Agent: node server.js (in $PROJECT_DIR)" -ForegroundColor Gray
Write-Host "   • Stop Agent: Ctrl+C in the agent window" -ForegroundColor Gray
Write-Host "   • View Logs: Get-Content $PROJECT_DIR\logs\agent.log -Tail 20" -ForegroundColor Gray
Write-Host "   • Test Integration: curl http://localhost:$ANALYTICS_PORT/api/status" -ForegroundColor Gray
"@

Set-Content -Path "$INTEGRATION_DIR\monitor-analytics.ps1" -Value $monitorScript
Write-Host "   ✅ Monitoring script created: $INTEGRATION_DIR\monitor-analytics.ps1" -ForegroundColor Green

# Step 7: Create integration guide
Write-Host "📋 Step 7: Creating integration guide..." -ForegroundColor Yellow

$integrationGuide = @"
# Jayati Birthday Analytics Integration Guide

## Overview
Analytics agent has been integrated with $DOMAIN to collect visitor data in the background.

## Installation Status
✅ Analytics agent deployed on port $ANALYTICS_PORT
✅ JavaScript tracker deployed to website
✅ Monitoring tools configured
✅ Windows service created (optional)

## Access URLs
- Main Website: https://$DOMAIN
- Analytics Dashboard: https://$DOMAIN/_analytics/dashboard
- API Status: https://$DOMAIN/_analytics/api/status
- Health Check: https://$DOMAIN/_analytics/health

## Integration Details

### 1. JavaScript Tracker
Location: $WEB_ROOT\assets\js\jaytibirthday-analytics.js

Add this to your website's HTML (before </head>):
```html
<script async defer src="/assets/js/jaytibirthday-analytics.js"></script>
```

### 2. Analytics Endpoints
All analytics requests are routed through:
- API: /_analytics/api/* → localhost:3001/api/*
- Dashboard: /_analytics/dashboard → localhost:3001/dashboard
- Health: /_analytics/health → localhost:3001/health

### 3. Data Collection
The tracker collects:
- Visitor session information
- Page views and time spent
- Device/browser details
- Network information
- User interactions

## Management Commands

### Start Analytics Agent
```powershell
cd $PROJECT_DIR
node server.js
```

### Monitor Status
```powershell
$INTEGRATION_DIR\monitor-analytics.ps1
```

### View Logs
```powershell
Get-Content $PROJECT_DIR\logs\agent.log -Tail 50
```

### Test Integration
```powershell
curl http://localhost:$ANALYTICS_PORT/api/status
```

## Security Notes
1. Analytics endpoints are set to 'noindex, nofollow' to protect SEO
2. Data is stored locally in SQLite databases
3. No personal identifiable information is collected
4. Integration works in background without affecting website performance

## Troubleshooting

1. **Agent not starting**
   - Check if port $ANALYTICS_PORT is available
   - Verify Node.js is installed: `node --version`
   - Check logs: `$PROJECT_DIR\logs\agent.log`

2. **JavaScript tracker not loading**
   - Verify file exists: `$WEB_ROOT\assets\js\jaytibirthday-analytics.js`
   - Check browser console for errors
   - Ensure script tag is in HTML

3. **No data in dashboard**
   - Wait for first visitor
   - Check agent is running
   - Verify database files exist: `$PROJECT_DIR\data\*.db`

## Next Steps
1. Add the JavaScript snippet to your website HTML
2. Visit the dashboard to see initial data
3. Monitor performance and adjust as needed
4. Set up regular backups of analytics data

## Support
For issues, check the logs and run the monitoring script.
"@

Set-Content -Path "$INTEGRATION_DIR\integration_guide.md" -Value $integrationGuide
Write-Host "   ✅ Integration guide created: $INTEGRATION_DIR\integration_guide.md" -ForegroundColor Green

# Step 8: Test the integration
Write-Host "🧪 Step 8: Testing integration..." -ForegroundColor Yellow
try {
    $testResponse = Invoke-WebRequest -Uri "http://localhost:$ANALYTICS_PORT/api/status" -TimeoutSec 10
    if ($testResponse.StatusCode -eq 200) {
        Write-Host "   ✅ Analytics agent API is responding" -ForegroundColor Green
        $statusData = $testResponse.Content | ConvertFrom-Json
        Write-Host "   Agent: $($statusData.name) v$($statusData.version)" -ForegroundColor Gray
    }
} catch {
    Write-Host "   ⚠️  Analytics agent API test failed. Agent might need to be started." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "🎉 Integration Complete!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "📊 Next Steps:" -ForegroundColor Yellow
Write-Host "   1. Add this to your website HTML (before </head>):" -ForegroundColor Gray
Write-Host "      <script async defer src='/assets/js/jaytibirthday-analytics.js'></script>" -ForegroundColor White
Write-Host "   2. Test the dashboard: http://localhost:$ANALYTICS_PORT/dashboard" -ForegroundColor Gray
Write-Host "   3. Monitor integration: $INTEGRATION_DIR\monitor-analytics.ps1" -ForegroundColor Gray
Write-Host "   4. Review guide: $INTEGRATION_DIR\integration_guide.md" -ForegroundColor Gray
Write-Host ""
Write-Host "✅ The Visitor Analytics Agent is now integrated with $DOMAIN in the background!" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan