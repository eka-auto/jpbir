# Visitor Analytics Agent API Documentation

## Overview

The Visitor Analytics Agent provides a comprehensive REST API for collecting visitor analytics, network information, and device discovery. This document details all available endpoints, request/response formats, and usage examples.

## Base URL

```
http://localhost:3000/api
```

Or when deployed:
```
https://yourdomain.com/api
```

## Authentication

### Public Endpoints
Most analytics endpoints are public and don't require authentication.

### Admin Endpoints
Admin endpoints require basic authentication. Include the `Authorization` header:

```http
Authorization: Basic base64(username:password)
```

## Rate Limiting

- Public endpoints: 100 requests per 15 minutes per IP
- Admin endpoints: 50 requests per 15 minutes per IP
- Analytics endpoints: 100 requests per 15 minutes per IP

## Response Format

All API responses follow this format:

```json
{
  "success": true,
  "data": {},
  "message": "Optional message",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

Error responses:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Core Endpoints

### 1. Agent Status

**GET /status**

Get the current status of the agent.

**Response:**
```json
{
  "success": true,
  "name": "Visitor Analytics Agent",
  "version": "2.0.0",
  "status": "active",
  "uptime": 3600,
  "visitorsTracked": 150,
  "features": [
    "IP address tracking",
    "Network information collection",
    "Time spent analytics",
    "Device/browser detection",
    "Geolocation data",
    "Network scanning capabilities"
  ],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 2. Health Check

**GET /health**

Check if the agent is healthy and responsive.

**Response:**
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "database": "connected",
  "services": ["visitorLogger", "networkScanner", "analyticsEngine"]
}
```

## Analytics Endpoints

### 1. Track Visitor

**POST /analytics/track**

Track a new visitor or update existing visitor information.

**Request Body:**
```json
{
  "page_url": "https://yourdomain.com/page",
  "network_data": {
    "ip_address": "203.0.113.1",
    "connection_type": "wifi",
    "bandwidth_estimate": "50 Mbps",
    "public_ip": "203.0.113.1",
    "local_ip": "192.168.1.100"
  }
}
```

**Response:**
```json
{
  "success": true,
  "visitor_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Visitor tracked successfully",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 2. Update Visitor Activity

**POST /analytics/activity**

Update visitor activity (time spent, page views, etc.).

**Request Body:**
```json
{
  "visitor_id": "550e8400-e29b-41d4-a716-446655440000",
  "time_spent": 60,
  "page_url": "https://yourdomain.com/another-page",
  "action_type": "page_view"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Activity updated successfully",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 3. Log Network Information

**POST /analytics/network**

Log detailed network information for a visitor.

**Request Body:**
```json
{
  "visitor_id": "550e8400-e29b-41d4-a716-446655440000",
  "network_data": {
    "ip_address": "203.0.113.1",
    "network_type": "home",
    "bandwidth_estimate": "100 Mbps",
    "connection_type": "ethernet",
    "public_ip": "203.0.113.1",
    "local_ip": "192.168.1.100",
    "latency": 25
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Network information logged successfully",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 4. Get Client Information

**GET /analytics/client-info**

Get information about the current client (useful for debugging).

**Response:**
```json
{
  "success": true,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "headers": {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "accept-language": "en-US,en;q=0.9",
    "accept-encoding": "gzip, deflate, br"
  },
  "ip_info": {
    "ip": "203.0.113.1",
    "forwarded_for": null
  },
  "available_data_points": [
    "ip_address",
    "user_agent",
    "browser_info",
    "os_info",
    "device_type",
    "geolocation",
    "network_info",
    "time_spent",
    "page_views"
  ],
  "privacy_notice": "This agent collects anonymous analytics data..."
}
```

### 5. Enhanced Analytics

**POST /analytics/enhanced**

Collect enhanced visitor data including geolocation, fingerprinting, etc.

**Request Body:** (Empty - data is collected from request headers)

**Response:**
```json
{
  "success": true,
  "visitor_id": "550e8400-e29b-41d4-a716-446655440000",
  "fingerprint": {
    "fingerprint": "a1b2c3d4e5f6",
    "components": ["chrome", "windows", "desktop", "US"],
    "uniqueness_score": 85
  },
  "data_collected": {
    "collector_name": "EnhancedCollector",
    "version": "1.0.0",
    "capabilities": [
      "visitor_info_extraction",
      "geolocation_lookup",
      "network_latency_measurement"
    ]
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Analytics Reports Endpoints

### 1. Generate Analytics Report

**GET /analytics/report**

Generate a comprehensive analytics report.

**Query Parameters:**
- `days` (optional): Number of days to include (default: 7)

**Response:**
```json
{
  "success": true,
  "report": {
    "report_date": "2024-01-01T00:00:00.000Z",
    "period_days": 7,
    "summary": {
      "total_days": 7,
      "total_visitors": 1250,
      "total_page_views": 5678,
      "avg_session_duration": 120,
      "avg_bounce_rate": 35.5
    },
    "trending": [
      {
        "date": "2024-01-01",
        "total_visitors": 150,
        "new_visitors": 120,
        "returning_visitors": 30,
        "total_page_views": 650,
        "avg_session_duration": 115,
        "bounce_rate": 32.5
      }
    ],
    "devices": [
      {
        "device_type": "desktop",
        "total_visitors": 850,
        "total_page_views": 4250,
        "avg_time_spent": 150,
        "avg_bounce_rate": 28.5
      }
    ],
    "browsers": [
      {
        "browser_name": "Chrome",
        "total_visitors": 750,
        "total_page_views": 3750,
        "avg_time_spent": 145
      }
    ],
    "insights": [
      {
        "type": "traffic_trend",
        "message": "Traffic increased by 15% compared to previous day",
        "direction": "up",
        "value": 15
      }
    ]
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 2. Real-time Analytics

**GET /analytics/realtime**

Get real-time analytics data.

**Response:**
```json
{
  "success": true,
  "analytics": {
    "realtime": {
      "current_hour_visitors": 25,
      "active_sessions": 8,
      "today_total": 150
    },
    "performance": {
      "performance": {
        "avg_session_duration": 120,
        "avg_bounce_rate": 35.5,
        "avg_conversion_rate": 2.5
      },
      "growth": {
        "days_tracked": 30,
        "total_visitors_30d": 3750,
        "total_page_views_30d": 18750
      },
      "peak_hour": {
        "hour": 14,
        "max_visitors": 45
      }
    },
    "generated_at": "2024-01-01T00:00:00.000Z"
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 3. Trending Data

**GET /analytics/trending**

Get trending data for specified period.

**Query Parameters:**
- `days` (optional): Number of days (default: 7)

**Response:**
```json
{
  "success": true,
  "days": 7,
  "trending": [
    {
      "date": "2024-01-01",
      "total_visitors": 150,
      "new_visitors": 120,
      "returning_visitors": 30,
      "total_page_views": 650,
      "avg_session_duration": 115,
      "bounce_rate": 32.5
    }
  ],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 4. Device Analytics

**GET /analytics/devices**

Get device distribution analytics.

**Query Parameters:**
- `days` (optional): Number of days (default: 30)

**Response:**
```json
{
  "success": true,
  "days": 30,
  "devices": [
    {
      "device_type": "desktop",
      "total_visitors": 850,
      "total_page_views": 4250,
      "avg_time_spent": 150,
      "avg_bounce_rate": 28.5
    },
    {
      "device_type": "mobile",
      "total_visitors": 350,
      "total_page_views": 1400,
      "avg_time_spent": 90,
      "avg_bounce_rate": 45.2
    }
  ],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 5. Browser Analytics

**GET /analytics/browsers**

Get browser distribution analytics.

**Query Parameters:**
- `days` (optional): Number of days (default: 30)

**Response:**
```json
{
  "success": true,
  "days": 30,
  "browsers": [
    {
      "browser_name": "Chrome",
      "total_visitors": 750,
      "total_page_views": 3750,
      "avg_time_spent": 145
    },
    {
      "browser_name": "Firefox",
      "total_visitors": 250,
      "total_page_views": 1250,
      "avg_time_spent": 130
    }
  ],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 6. Geographic Analytics

**GET /analytics/geography**

Get geographic distribution analytics.

**Query Parameters:**
- `days` (optional): Number of days (default: 30)

**Response:**
```json
{
  "success": true,
  "days": 30,
  "geography": [
    {
      "country": "United States",
      "region": "California",
      "city": "San Francisco",
      "total_visitors": 350,
      "total_page_views": 1750
    },
    {
      "country": "United Kingdom",
      "region": "England",
      "city": "London",
      "total_visitors": 200,
      "total_page_views": 1000
    }
  ],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Admin Endpoints

### 1. List All Visitors

**GET /admin/visitors**

Get a list of all visitors with pagination.

**Query Parameters:**
- `limit` (optional): Number of visitors per page (default: 100)
- `page` (optional): Page number (default: 1)

**Response:**
```json
{
  "success": true,
  "page": 1,
  "limit": 100,
  "total": 1250,
  "visitors": [
    {
      "visitor_id": "550e8400-e29b-41d4-a716-446655440000",
      "ip_address": "203.0.113.1",
      "browser_name": "Chrome",
      "os_name": "Windows",
      "device_type": "desktop",
      "country": "United States",
      "city": "San Francisco",
      "initial_timestamp": "2024-01-01T00:00:00.000Z",
      "last_activity": "2024-01-01T01:30:00.000Z",
      "total_time_spent": 5400,
      "page_views": 12
    }
  ],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 2. Get Visitor Details

**GET /admin/visitors/{visitor_id}**

Get detailed information about a specific visitor.

**Response:**
```json
{
  "success": true,
  "visitor": {
    "visitor_id": "550e8400-e29b-41d4-a716-446655440000",
    "ip_address": "203.0.113.1",
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
    "browser_name": "Chrome",
    "browser_version": "120",
    "os_name": "Windows",
    "os_version": "10",
    "device_type": "desktop",
    "country": "United States",
    "region": "California",
    "city": "San Francisco",
    "timezone": "America/Los_Angeles",
    "latitude": 37.7749,
    "longitude": -122.4194,
    "network_isp": "Comcast",
    "referrer": "https://google.com",
    "initial_timestamp": "2024-01-01T00:00:00.000Z",
    "last_activity": "2024-01-01T01:30:00.000Z",
    "total_time_spent": 5400,
    "page_views": 12,
    "session_active": true
  },
  "network_info": [
    {
      "id": 1,
      "visitor_id": "550e8400-e29b-41d4-a716-446655440000",
      "ip_address": "203.0.113.1",
      "network_type": "home",
      "bandwidth_estimate": "100 Mbps",
      "connection_type": "ethernet",
      "public_ip": "203.0.113.1",
      "local_ip": "192.168.1.100",
      "collected_at": "2024-01-01T00:00:00.000Z"
    }
  ],
  "activity_log": [
    {
      "id": 1,
      "visitor_id": "550e8400-e29b-41d4-a716-446655440000",
      "action_type": "page_visit",
      "page_url": "https://yourdomain.com/",
      "action_data": "{\"referrer\": \"https://google.com\"}",
      "timestamp": "2024-01-01T00:00:00.000Z"
    }
  ],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 3. Network Scan

**GET /admin/network/scan**

Scan the local network for devices.

**Response:**
```json
{
  "success": true,
  "scan_timestamp": "2024-01-01T00:00:00.000Z",
  "total_devices": 8,
  "local_network": {
    "Ethernet": {
      "address": "192.168.1.100",
      "netmask": "255.255.255.0",
      "mac": "00:1A:2B:3C:4D:5E",
      "cidr": "192.168.1.100/24"
    }
  },
  "public_ip": "203.0.113.1",
  "network_speed": {
    "download_speed": "95.42 Mbps",
    "latency": "25ms",
    "test_size": "1MB"
  },
  "discovered_devices": [
    {
      "ip": "192.168.1.1",
      "hostname": "router.local",
      "mac_address": "00:1A:2B:3C:4D:5F",
      "status": "online",
      "last_seen": "2024-01-01T00:00:00.000Z",
      "open_ports": [
        {
          "port": 80,
          "service": "HTTP",
          "status": "open"
        },
        {
          "port": 443,
          "service": "HTTPS",
          "status": "open"
        }
      ],
      "device_type": "router"
    }
  ],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 4. Network Status

**GET /admin/network/status**

Get current network status.

**Response:**
```json
{
  "success": true,
  "status_timestamp": "2024-01-01T00:00:00.000Z",
  "network_status": "online",
  "local_network": {
    "Ethernet": {
      "address": "192.168.1.100",
      "netmask": "255.255.255.0",
      "mac": "00:1A:2B:3C:4D:5E",
      "cidr": "192.168.1.100/24"
    }
  },
  "public_ip": "203.0.113.1",
  "discovered_devices_count": 8,
  "recently_discovered": [
    {
      "ip": "192.168.1.1",
      "hostname": "router.local",
      "mac_address": "00:1A:2B:3C:4D:5F",
      "status": "online",
      "last_seen": "2024-01-01T00:00:00.000Z",
      "device_type": "router"
    }
  ],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 5. Connection Help

**POST /admin/network/connect-help**

Get connection suggestions for a specific device.

**Request Body:**
```json
{
  "target_ip": "192.168.1.100",
  "target_port": 80,
  "device_type": "web_server"
}
```

**Response:**
```json
{
  "success": true,
  "target_ip": "192.168.1.100",
  "is_online": true,
  "connection_suggestions": [
    {
      "type": "connection",
      "protocol": "HTTP",
      "description": "Web interface",
      "connection_method": "http://192.168.1.100",
      "port": 80
    },
    {
      "type": "general",
      "message": "General network troubleshooting",
      "suggestions": [
        "Ensure both devices are on the same network",
        "Check firewall settings on both devices",
        "Verify IP address configuration",
        "Try pinging the device to confirm connectivity"
      ]
    }
  ],
  "scan_recommended": false,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 6. Export Visitor Data

**GET /admin/export/visitors**

Export visitor data as CSV.

**Response:** CSV file download

### 7. Data Cleanup

**DELETE /admin/data/cleanup**

Clean up old data.

**Query Parameters:**
- `days_old` (optional): Delete data older than X days (default: 30)

**Response:**
```json
{
  "success": true,
  "message": "Would delete data older than 30 days",
  "note": "This is a demo endpoint. In production, this would perform actual data cleanup.",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Error Codes

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `VALIDATION_ERROR` | Request validation failed | 400 |
| `AUTH_REQUIRED` | Authentication required | 401 |
| `FORBIDDEN` | Insufficient permissions | 403 |
| `NOT_FOUND` | Resource not found | 404 |
| `RATE_LIMITED` | Rate limit exceeded | 429 |
| `SERVER_ERROR` | Internal server error | 500 |
| `SERVICE_UNAVAILABLE` | Service temporarily unavailable | 503 |

## Client-Side Integration

### JavaScript Tracker

Include this script in your HTML:

```html
<script src="/js/enhancedTracking.js"></script>
<script>
  // Auto-initialize with data attribute
  document.body.setAttribute('data-enhanced-tracking', 'true');
  
  // Or manually initialize
  const tracker = new EnhancedTracker({
    endpoint: '/api/analytics/track',
    activityEndpoint: '/api/analytics/activity',
    debug: true
  });
</script>
```

### Basic Tracking

```javascript
// Track page visit
fetch('/api/analytics/track', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    page_url: window.location.href,
    network_data: {
      connection_type: navigator.connection?.effectiveType || 'unknown'
    }
  })
});
```

## Webhook Support

The agent can send webhook notifications for various events:

1. `WEBHOOK_NEW_VISITOR`: When a new visitor is tracked
2. `WEBHOOK_NETWORK_SCAN`: When network scan completes
3. `WEBHOOK_ANALYTICS_REPORT`: When analytics report is generated

Configure webhooks in the environment variables.

## Privacy & Compliance

All data collection respects:
- GDPR compliance (EU visitors)
- CCPA compliance (California visitors)
- Do Not Track headers
- Data minimization principles
- Right to erasure

Data is anonymized by default and can be configured for specific compliance requirements.