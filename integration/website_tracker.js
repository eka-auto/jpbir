/**
 * Visitor Analytics Tracker for jaytibirthday.in
 * Background tracking that doesn't affect SEO or user experience
 * 
 * This script is designed to be inserted into jaytibirthday.in
 * It collects visitor data in the background and sends it to the analytics agent
 */

(function() {
    'use strict';
    
    // Configuration
    const config = {
        analyticsEndpoint: 'https://jaytibirthday.in/_analytics/api/track',
        heartbeatInterval: 30000, // 30 seconds
        dataCollectionInterval: 60000, // 1 minute
        sessionTimeout: 1800000, // 30 minutes
        debug: false
    };
    
    // State management
    let visitorSession = {
        sessionId: generateSessionId(),
        startTime: Date.now(),
        lastActivity: Date.now(),
        pageViews: 1,
        visitorId: null,
        deviceFingerprint: null
    };
    
    // Initialize tracking
    function initTracker() {
        // Generate device fingerprint (non-invasive)
        visitorSession.deviceFingerprint = generateDeviceFingerprint();
        
        // Collect initial data
        const initialData = collectInitialData();
        
        // Send initial data (non-blocking)
        sendData(initialData).then(response => {
            if (response && response.visitor_id) {
                visitorSession.visitorId = response.visitor_id;
                log('Visitor ID assigned:', response.visitor_id);
            }
        }).catch(error => {
            // Silently fail - doesn't affect user experience
            if (config.debug) console.error('Analytics init error:', error);
        });
        
        // Set up activity tracking
        setupActivityTracking();
        
        // Start heartbeat
        startHeartbeat();
        
        // Track page unload
        setupUnloadTracking();
        
        log('Visitor Analytics Tracker initialized');
    }
    
    // Generate session ID
    function generateSessionId() {
        return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }
    
    // Generate device fingerprint (non-invasive)
    function generateDeviceFingerprint() {
        const fingerprintData = {
            userAgent: navigator.userAgent,
            language: navigator.language,
            platform: navigator.platform,
            screenSize: window.screen.width + 'x' + window.screen.height,
            colorDepth: window.screen.colorDepth,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            localStorageSupport: typeof localStorage !== 'undefined',
            cookiesEnabled: navigator.cookieEnabled
        };
        
        // Create a simple hash (non-unique but consistent)
        return btoa(JSON.stringify(fingerprintData)).substring(0, 32);
    }
    
    // Collect initial visitor data
    function collectInitialData() {
        return {
            session_id: visitorSession.sessionId,
            device_fingerprint: visitorSession.deviceFingerprint,
            page_url: window.location.href,
            referrer: document.referrer || 'direct',
            entry_time: new Date().toISOString(),
            browser_info: {
                userAgent: navigator.userAgent,
                language: navigator.language,
                platform: navigator.platform,
                vendor: navigator.vendor
            },
            screen_info: {
                width: window.screen.width,
                height: window.screen.height,
                colorDepth: window.screen.colorDepth,
                pixelRatio: window.devicePixelRatio || 1
            },
            network_info: {
                connection_type: navigator.connection ? navigator.connection.effectiveType : 'unknown',
                downlink: navigator.connection ? navigator.connection.downlink : null
            },
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            device_memory: navigator.deviceMemory || 'unknown',
            hardware_concurrency: navigator.hardwareConcurrency || 'unknown'
        };
    }
    
    // Send data to analytics endpoint
    async function sendData(data) {
        try {
            const response = await fetch(config.analyticsEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data),
                // Use low priority for background tasks
                priority: 'low',
                // Don't block page load
                keepalive: true
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            return await response.json();
        } catch (error) {
            // Silently fail - doesn't affect user experience
            if (config.debug) console.error('Analytics send error:', error);
            return null;
        }
    }
    
    // Set up activity tracking
    function setupActivityTracking() {
        // Track user interactions
        const events = ['mousemove', 'scroll', 'click', 'keydown', 'touchstart'];
        
        events.forEach(eventType => {
            document.addEventListener(eventType, debounce(() => {
                visitorSession.lastActivity = Date.now();
                trackActivity();
            }, 5000), { passive: true });
        });
        
        // Track page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                trackActivity('visibility_change', {
                    hidden_time: Date.now() - visitorSession.lastActivity
                });
            }
        });
    }
    
    // Track activity (heartbeat)
    function trackActivity(eventType = 'heartbeat', additionalData = {}) {
        const data = {
            session_id: visitorSession.sessionId,
            visitor_id: visitorSession.visitorId,
            device_fingerprint: visitorSession.deviceFingerprint,
            event_type: eventType,
            page_url: window.location.href,
            timestamp: new Date().toISOString(),
            time_on_page: Date.now() - visitorSession.lastActivity,
            ...additionalData
        };
        
        // Send heartbeat (non-blocking)
        sendData(data).catch(() => {
            // Silently fail
        });
    }
    
    // Start heartbeat timer
    function startHeartbeat() {
        setInterval(() => {
            trackActivity();
        }, config.heartbeatInterval);
    }
    
    // Set up unload tracking
    function setupUnloadTracking() {
        window.addEventListener('beforeunload', () => {
            const exitData = {
                session_id: visitorSession.sessionId,
                visitor_id: visitorSession.visitorId,
                device_fingerprint: visitorSession.deviceFingerprint,
                event_type: 'page_exit',
                page_url: window.location.href,
                timestamp: new Date().toISOString(),
                session_duration: Date.now() - visitorSession.startTime,
                exit_reason: 'page_unload'
            };
            
            // Use sendBeacon for reliable exit tracking
            navigator.sendBeacon(config.analyticsEndpoint, JSON.stringify(exitData));
        });
    }
    
    // Debounce function to limit frequency
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    // Logging helper
    function log(...args) {
        if (config.debug) {
            console.log('[Analytics]', ...args);
        }
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTracker);
    } else {
        initTracker();
    }
    
    // Expose minimal API for custom events (optional)
    window.JayatiAnalytics = {
        trackEvent: function(eventName, data = {}) {
            trackActivity('custom_event', {
                event_name: eventName,
                custom_data: data
            });
        },
        getSessionId: function() {
            return visitorSession.sessionId;
        }
    };
    
})();