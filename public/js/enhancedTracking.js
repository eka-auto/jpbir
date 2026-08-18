/**
 * Enhanced Client-Side Tracking JavaScript
 * Collects comprehensive visitor data for the Kiro Analytics Agent
 */

class EnhancedTracker {
  constructor(options = {}) {
    this.options = {
      endpoint: '/api/analytics/track',
      activityEndpoint: '/api/analytics/activity',
      networkEndpoint: '/api/analytics/network',
      debug: false,
      ...options
    };
    
    this.visitorId = null;
    this.sessionStart = Date.now();
    this.pageViewStart = Date.now();
    this.dataCollected = {};
    this.activityQueue = [];
    this.isInitialized = false;
    
    // Initialize
    this.init();
  }

  async init() {
    try {
      // Collect initial data
      this.dataCollected = await this.collectAllData();
      
      // Send initial tracking request
      await this.trackInitialVisit();
      
      // Start periodic activity updates
      this.startActivityMonitoring();
      
      // Set up page visibility tracking
      this.setupVisibilityTracking();
      
      // Set up beforeunload handler
      this.setupBeforeUnload();
      
      this.isInitialized = true;
      
      if (this.options.debug) {
        console.log('EnhancedTracker initialized:', this.dataCollected);
      }
    } catch (error) {
      console.error('Failed to initialize EnhancedTracker:', error);
    }
  }

  async collectAllData() {
    const data = {
      timestamp: new Date().toISOString(),
      url: window.location.href,
      referrer: document.referrer,
      
      // Browser information
      browser: this.collectBrowserInfo(),
      
      // Device information
      device: this.collectDeviceInfo(),
      
      // Screen information
      screen: this.collectScreenInfo(),
      
      // Network information
      network: await this.collectNetworkInfo(),
      
      // Performance information
      performance: this.collectPerformanceInfo(),
      
      // Storage information
      storage: this.collectStorageInfo(),
      
      // Time information
      time: this.collectTimeInfo(),
      
      // Interaction capabilities
      capabilities: this.collectCapabilities()
    };
    
    return data;
  }

  collectBrowserInfo() {
    const userAgent = navigator.userAgent;
    const vendor = navigator.vendor || '';
    
    return {
      userAgent: userAgent,
      vendor: vendor,
      language: navigator.language,
      languages: navigator.languages,
      cookieEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack || 'unspecified',
      pdfViewerEnabled: navigator.pdfViewerEnabled || false,
      
      // Browser detection
      isChrome: userAgent.includes('Chrome') && !userAgent.includes('Edg'),
      isFirefox: userAgent.includes('Firefox'),
      isSafari: userAgent.includes('Safari') && !userAgent.includes('Chrome'),
      isEdge: userAgent.includes('Edg'),
      isIE: userAgent.includes('MSIE') || userAgent.includes('Trident'),
      isOpera: userAgent.includes('Opera') || userAgent.includes('OPR'),
      
      // Platform detection
      platform: navigator.platform,
      isMobile: /Mobile|Android|iP(hone|od|ad)/.test(userAgent),
      isTablet: /Tablet|iPad/.test(userAgent),
      isDesktop: !/Mobile|Android|Tablet|iPad/.test(userAgent)
    };
  }

  collectDeviceInfo() {
    return {
      // CPU information
      hardwareConcurrency: navigator.hardwareConcurrency || 'unknown',
      
      // Device memory
      deviceMemory: navigator.deviceMemory || 'unknown',
      
      // Max touch points
      maxTouchPoints: navigator.maxTouchPoints || 0,
      
      // Device orientation (if available)
      orientation: window.screen?.orientation?.type || 'unknown',
      
      // Pixel ratio
      pixelRatio: window.devicePixelRatio || 1
    };
  }

  collectScreenInfo() {
    const screen = window.screen;
    
    return {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
      
      // Viewport dimensions
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      
      // Scroll dimensions
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight
    };
  }

  async collectNetworkInfo() {
    const info = {
      connection: 'unknown',
      effectiveType: 'unknown',
      downlink: 'unknown',
      rtt: 'unknown',
      saveData: false,
      online: navigator.onLine
    };
    
    // Network Information API
    if (navigator.connection) {
      const conn = navigator.connection;
      info.connection = conn.type || 'unknown';
      info.effectiveType = conn.effectiveType || 'unknown';
      info.downlink = conn.downlink || 'unknown';
      info.rtt = conn.rtt || 'unknown';
      info.saveData = conn.saveData || false;
    }
    
    // Try to get public IP via WebRTC (with user permission)
    try {
      const ip = await this.getIPViaWebRTC();
      if (ip) {
        info.publicIP = ip;
      }
    } catch (error) {
      // Silently fail - this requires user permission
    }
    
    return info;
  }

  async getIPViaWebRTC() {
    return new Promise((resolve) => {
      // WebRTC method to get local IP
      const RTCPeerConnection = window.RTCPeerConnection || 
                               window.mozRTCPeerConnection || 
                               window.webkitRTCPeerConnection;
      
      if (!RTCPeerConnection) {
        resolve(null);
        return;
      }
      
      const pc = new RTCPeerConnection({ iceServers: [] });
      const noop = () => {};
      
      pc.createDataChannel('');
      pc.createOffer()
        .then(pc.setLocalDescription.bind(pc))
        .catch(noop);
      
      pc.onicecandidate = (ice) => {
        if (!ice || !ice.candidate || !ice.candidate.candidate) {
          resolve(null);
          return;
        }
        
        const match = ice.candidate.candidate.match(/([0-9]{1,3}(\.[0-9]{1,3}){3}|[a-f0-9]{1,4}(:[a-f0-9]{1,4}){7})/);
        if (match) {
          resolve(match[1]);
        } else {
          resolve(null);
        }
        pc.close();
      };
      
      // Timeout after 1 second
      setTimeout(() => {
        pc.close();
        resolve(null);
      }, 1000);
    });
  }

  collectPerformanceInfo() {
    const perf = window.performance;
    const info = {
      timingAvailable: !!perf?.timing,
      memoryAvailable: !!perf?.memory,
      navigation: {}
    };
    
    if (perf?.timing) {
      const t = perf.timing;
      info.timing = {
        navigationStart: t.navigationStart,
        domLoading: t.domLoading,
        domInteractive: t.domInteractive,
        domContentLoaded: t.domContentLoadedEventEnd,
        domComplete: t.domComplete,
        loadEventEnd: t.loadEventEnd,
        fetchStart: t.fetchStart,
        domainLookupStart: t.domainLookupStart,
        domainLookupEnd: t.domainLookupEnd,
        connectStart: t.connectStart,
        connectEnd: t.connectEnd,
        requestStart: t.requestStart,
        responseStart: t.responseStart,
        responseEnd: t.responseEnd
      };
      
      // Calculate page load time
      info.pageLoadTime = t.loadEventEnd - t.navigationStart;
    }
    
    if (perf?.memory) {
      info.memory = {
        usedJSHeapSize: perf.memory.usedJSHeapSize,
        totalJSHeapSize: perf.memory.totalJSHeapSize,
        jsHeapSizeLimit: perf.memory.jsHeapSizeLimit
      };
    }
    
    if (perf?.navigation) {
      info.navigation = {
        type: perf.navigation.type,
        redirectCount: perf.navigation.redirectCount
      };
    }
    
    // Resource timing
    if (perf?.getEntriesByType) {
      const resources = perf.getEntriesByType('resource');
      info.resourceCount = resources.length;
      
      // Calculate average resource load time
      if (resources.length > 0) {
        const totalDuration = resources.reduce((sum, r) => sum + r.duration, 0);
        info.avgResourceLoadTime = totalDuration / resources.length;
      }
    }
    
    return info;
  }

  collectStorageInfo() {
    const info = {
      localStorage: 'unknown',
      sessionStorage: 'unknown',
      cookies: 'unknown',
      indexedDB: 'unknown'
    };
    
    try {
      info.localStorage = localStorage ? 'available' : 'unavailable';
    } catch (e) {
      info.localStorage = 'blocked';
    }
    
    try {
      info.sessionStorage = sessionStorage ? 'available' : 'unavailable';
    } catch (e) {
      info.sessionStorage = 'blocked';
    }
    
    try {
      info.cookies = navigator.cookieEnabled ? 'enabled' : 'disabled';
    } catch (e) {
      info.cookies = 'unknown';
    }
    
    info.indexedDB = 'indexedDB' in window ? 'available' : 'unavailable';
    
    return info;
  }

  collectTimeInfo() {
    return {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      offset: new Date().getTimezoneOffset(),
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      dateFormat: new Date().toLocaleDateString(),
      timeFormat: new Date().toLocaleTimeString()
    };
  }

  collectCapabilities() {
    return {
      // Media capabilities
      hasWebGL: this.detectWebGL(),
      hasWebRTC: 'RTCPeerConnection' in window,
      hasWebSocket: 'WebSocket' in window,
      hasServiceWorker: 'serviceWorker' in navigator,
      hasPushManager: 'PushManager' in window,
      hasNotification: 'Notification' in window,
      hasGeolocation: 'geolocation' in navigator,
      
      // Storage capabilities
      hasLocalStorage: 'localStorage' in window,
      hasSessionStorage: 'sessionStorage' in window,
      hasIndexedDB: 'indexedDB' in window,
      
      // Media capabilities
      hasAudioContext: 'AudioContext' in window || 'webkitAudioContext' in window,
      hasVideo: 'HTMLVideoElement' in window,
      hasAudio: 'HTMLAudioElement' in window,
      hasCanvas: 'HTMLCanvasElement' in window,
      
      // Input capabilities
      hasTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
      hasPointer: 'PointerEvent' in window,
      hasGamepad: 'getGamepads' in navigator,
      
      // Performance capabilities
      hasPerformance: 'performance' in window,
      hasPerformanceObserver: 'PerformanceObserver' in window,
      hasUserTiming: 'performance' in window && 'mark' in performance
    };
  }

  detectWebGL() {
    try {
      const canvas = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && 
               (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }

  async trackInitialVisit() {
    try {
      const response = await fetch(this.options.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ...this.dataCollected,
          page_url: window.location.href,
          network_data: {
            ip_address: await this.getPublicIP(),
            connection_type: this.dataCollected.network.effectiveType,
            bandwidth_estimate: this.dataCollected.network.downlink + ' Mbps',
            latency: this.dataCollected.network.rtt + ' ms'
          }
        })
      });
      
      const data = await response.json();
      if (data.success) {
        this.visitorId = data.visitor_id;
        if (this.options.debug) {
          console.log('Visitor tracked with ID:', this.visitorId);
        }
      }
    } catch (error) {
      console.error('Error tracking initial visit:', error);
    }
  }

  async getPublicIP() {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip;
    } catch (error) {
      return 'unknown';
    }
  }

  startActivityMonitoring() {
    // Update activity every 30 seconds
    this.activityInterval = setInterval(() => {
      this.updateActivity();
    }, 30000);
    
    // Track mouse movements
    this.setupMouseTracking();
    
    // Track keyboard activity
    this.setupKeyboardTracking();
    
    // Track scroll activity
    this.setupScrollTracking();
    
    // Track clicks
    this.setupClickTracking();
  }

  setupMouseTracking() {
    let mouseMoveCount = 0;
    let lastMouseMove = Date.now();
    
    document.addEventListener('mousemove', () => {
      mouseMoveCount++;
      lastMouseMove = Date.now();
      
      // Log mouse activity every 10 movements
      if (mouseMoveCount % 10 === 0) {
        this.logActivity('mouse_movement', {
          movement_count: mouseMoveCount,
          last_movement: new Date(lastMouseMove).toISOString()
        });
      }
    });
  }

  setupKeyboardTracking() {
    let keyPressCount = 0;
    
    document.addEventListener('keydown', (event) => {
      keyPressCount++;
      
      // Log keyboard activity every 20 keypresses
      if (keyPressCount % 20 === 0) {
        this.logActivity('keyboard_activity', {
          keypress_count: keyPressCount,
          last_key: event.key,
          key_code: event.code
        });
      }
    });
  }

  setupScrollTracking() {
    let scrollCount = 0;
    let lastScrollTop = 0;
    
    window.addEventListener('scroll', () => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      
      // Count significant scrolls (more than 50 pixels)
      if (Math.abs(scrollTop - lastScrollTop) > 50) {
        scrollCount++;
        lastScrollTop = scrollTop;
        
        this.logActivity('scroll', {
          scroll_count: scrollCount,
          scroll_position: scrollTop,
          scroll_percentage: (scrollTop / document.documentElement.scrollHeight * 100).toFixed(1) + '%'
        });
      }
    });
  }

  setupClickTracking() {
    let clickCount = 0;
    
    document.addEventListener('click', (event) => {
      clickCount++;
      
      const target = event.target;
      const elementInfo = {
        tag: target.tagName,
        id: target.id || 'none',
        class: target.className || 'none',
        text: target.textContent?.substring(0, 50) || 'none'
      };
      
      this.logActivity('click', {
        click_count: clickCount,
        element: elementInfo,
        coordinates: {
          x: event.clientX,
          y: event.clientY
        }
      });
    });
  }

  setupVisibilityTracking() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.logActivity('page_hidden', {
          hidden_at: new Date().toISOString(),
          visible_time: Date.now() - this.pageViewStart
        });
      } else {
        this.pageViewStart = Date.now();
        this.logActivity('page_visible', {
          visible_at: new Date().toISOString()
        });
      }
    });
  }

  setupBeforeUnload() {
    window.addEventListener('beforeunload', () => {
      const totalTime = Date.now() - this.sessionStart;
      this.logActivity('page_exit', {
        exit_time: new Date().toISOString(),
        total_session_time: totalTime,
        page_view_time: Date.now() - this.pageViewStart
      });
      
      // Send final activity update
      this.sendFinalActivity(totalTime);
    });
  }

  async logActivity(actionType, data = {}) {
    const activity = {
      visitor_id: this.visitorId,
      action_type: actionType,
      page_url: window.location.href,
      timestamp: new Date().toISOString(),
      data: data
    };
    
    this.activityQueue.push(activity);
    
    // Send batch updates every 5 activities or every minute
    if (this.activityQueue.length >= 5) {
      await this.flushActivityQueue();
    }
  }

  async flushActivityQueue() {
    if (this.activityQueue.length === 0) return;
    
    try {
      await fetch(this.options.activityEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          activities: this.activityQueue,
          time_spent: Math.floor((Date.now() - this.pageViewStart) / 1000)
        })
      });
      
      this.activityQueue = [];
    } catch (error) {
      console.error('Error flushing activity queue:', error);
    }
  }

  async updateActivity() {
    if (!this.visitorId) return;
    
    const timeSpent = Math.floor((Date.now() - this.pageViewStart) / 1000);
    
    try {
      await fetch(this.options.activityEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          visitor_id: this.visitorId,
          time_spent: timeSpent,
          page_url: window.location.href,
          action_type: 'periodic_update'
        })
      });
    } catch (error) {
      console.error('Error updating activity:', error);
    }
    
    // Flush any queued activities
    if (this.activityQueue.length > 0) {
      await this.flushActivityQueue();
    }
  }

  async sendFinalActivity(totalTime) {
    if (!this.visitorId) return;
    
    try {
      await fetch(this.options.activityEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          visitor_id: this.visitorId,
          time_spent: Math.floor(totalTime / 1000),
          page_url: window.location.href,
          action_type: 'session_end'
        })
      });
    } catch (error) {
      // Ignore errors during page unload
    }
  }

  getVisitorId() {
    return this.visitorId;
  }

  getCollectedData() {
    return this.dataCollected;
  }

  destroy() {
    if (this.activityInterval) {
      clearInterval(this.activityInterval);
    }
    
    // Remove event listeners
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    
    this.isInitialized = false;
  }
}

// Export for use in browser
if (typeof window !== 'undefined') {
  window.EnhancedTracker = EnhancedTracker;
  
  // Auto-initialize if data-track attribute is present
  document.addEventListener('DOMContentLoaded', () => {
    if (document.body.hasAttribute('data-enhanced-tracking')) {
      window.enhancedTracker = new EnhancedTracker({
        debug: document.body.hasAttribute('data-debug-tracking')
      });
    }
  });
}

// Export for Node.js/CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EnhancedTracker;
}