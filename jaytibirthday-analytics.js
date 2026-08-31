// jaytibirthday.in Analytics Tracker
// SPECIFICALLY built for jaytibirthday.in domain
// Add this to your website: <script async defer src="/assets/js/jaytibirthday-analytics.js"></script>

(function() {
    'use strict';
    
    // CONFIGURATION - SPECIFIC TO jaytibirthday.in
    const CONFIG = {
        // Domain-specific settings
        DOMAIN: 'jaytibirthday.in',
        ANALYTICS_ENDPOINT: '/api/track',
        WEBSITE_NAME: 'Jayati Birthday Website',
        
        // Tracking settings
        HEARTBEAT_INTERVAL: 30000, // 30 seconds
        SESSION_TIMEOUT: 1800000,  // 30 minutes
        
        // Privacy settings
        ANONYMIZE_IP: true,
        RESPECT_DNT: true,
        NO_COOKIES: true
    };
    
    // Only run on jaytibirthday.in domain
    const currentHostname = window.location.hostname;
    const isJaytibirthdayDomain = currentHostname === 'jaytibirthday.in' || 
                                   currentHostname === 'www.jaytibirthday.in';
    
    if (!isJaytibirthdayDomain) {
        return; // Don't run on other domains
    }
    
    console.log('[jaytibirthday.in] Analytics tracker loaded for specific domain');
    
    // Generate unique session ID for this domain
    const generateSessionId = () => {
        return 'jaytibirthday_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    };
    
    // Generate device fingerprint (privacy-friendly)
    const generateDeviceFingerprint = () => {
        const data = {
            domain: CONFIG.DOMAIN,
            screen: window.screen.width + 'x' + window.screen.height,
            language: navigator.language,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            platform: navigator.platform
        };
        return btoa(JSON.stringify(data)).substring(0, 32);
    };
    
    // Collect visitor data
    const collectVisitorData = () => {
        return {
            // Domain identification
            domain: CONFIG.DOMAIN,
            website_name: CONFIG.WEBSITE_NAME,
            timestamp: new Date().toISOString(),
            
            // Session information
            session_id: generateSessionId(),
            device_fingerprint: generateDeviceFingerprint(),
            
            // Page information
            page_url: window.location.href,
            page_title: document.title,
            referrer: document.referrer || 'direct',
            
            // Browser/device info
            browser_info: {
                userAgent: navigator.userAgent,
                language: navigator.language,
                platform: navigator.platform,
                vendor: navigator.vendor
            },
            
            // Screen information
            screen_info: {
                width: window.screen.width,
                height: window.screen.height,
                colorDepth: window.screen.colorDepth,
                pixelRatio: window.devicePixelRatio || 1
            },
            
            // Network information
            network_info: {
                connection_type: navigator.connection ? navigator.connection.effectiveType : 'unknown',
                downlink: navigator.connection ? navigator.connection.downlink : null
            }
        };
    };
    
    // Send data to analytics endpoint
    const sendData = (data) => {
        if (!navigator.sendBeacon) {
            // Fallback to fetch if sendBeacon not available
            fetch(CONFIG.ANALYTICS_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
                keepalive: true,
                priority: 'low'
            }).catch(() => {
                // Silently fail - doesn't affect user experience
            });
            return;
        }
        
        navigator.sendBeacon(CONFIG.ANALYTICS_ENDPOINT, JSON.stringify(data));
    };
    
    // Track page view
    const trackPageView = () => {
        const visitorData = collectVisitorData();
        visitorData.event_type = 'page_view';
        sendData(visitorData);
        
        // Store session ID for future events
        window.jaytibirthdaySessionId = visitorData.session_id;
        
        return visitorData.session_id;
    };
    
    // Track user activity
    const trackActivity = (eventType = 'activity', additionalData = {}) => {
        const activityData = {
            domain: CONFIG.DOMAIN,
            session_id: window.jaytibirthdaySessionId || generateSessionId(),
            event_type: eventType,
            page_url: window.location.href,
            timestamp: new Date().toISOString(),
            ...additionalData
        };
        
        sendData(activityData);
    };
    
    // Set up activity tracking
    const setupActivityTracking = () => {
        const events = ['click', 'scroll', 'mousemove', 'keydown', 'touchstart'];
        const debouncedTrack = debounce(() => trackActivity('user_interaction'), 5000);
        
        events.forEach(eventType => {
            document.addEventListener(eventType, debouncedTrack, { passive: true });
        });
        
        // Track page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                trackActivity('page_hidden');
            } else {
                trackActivity('page_visible');
            }
        });
    };
    
    // Set up heartbeat
    const setupHeartbeat = () => {
        setInterval(() => {
            trackActivity('heartbeat');
        }, CONFIG.HEARTBEAT_INTERVAL);
    };
    
    // Track page exit
    const setupExitTracking = () => {
        window.addEventListener('beforeunload', () => {
            const exitData = {
                domain: CONFIG.DOMAIN,
                session_id: window.jaytibirthdaySessionId,
                event_type: 'page_exit',
                page_url: window.location.href,
                timestamp: new Date().toISOString(),
                time_on_page: Date.now() - performance.timing.navigationStart
            };
            
            sendData(exitData);
        });
    };
    
    // Debounce helper
    const debounce = (func, wait) => {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    };
    
    // Initialize tracker
    const initTracker = () => {
        // Check privacy settings
        if (CONFIG.RESPECT_DNT && navigator.doNotTrack === '1') {
            return; // Respect Do Not Track
        }
        
        // Track initial page view
        trackPageView();
        
        // Set up tracking
        setupActivityTracking();
        setupHeartbeat();
        setupExitTracking();
        
        // Expose API for custom events
        window.jaytibirthdayAnalytics = {
            domain: CONFIG.DOMAIN,
            trackEvent: (eventName, data = {}) => {
                trackActivity('custom_event', {
                    event_name: eventName,
                    custom_data: data
                });
            },
            getSessionId: () => window.jaytibirthdaySessionId
        };
        
        console.log('[jaytibirthday.in] Analytics tracker initialized');
    };
    
    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTracker);
    } else {
        initTracker();
    }
})();
