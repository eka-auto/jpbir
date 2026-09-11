(function () {
    'use strict';
    var ENDPOINT = 'https://jaytipargal.tech/api/jp-track';
    var HEARTBEAT_MS = 30000;
    var PROBE_DELAY_MS = 4000;

    function getVisitorId() {
        try {
            var vid = localStorage.getItem('jp_visitor_id');
            if (!vid) {
                vid = 'jpv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
                localStorage.setItem('jp_visitor_id', vid);
            }
            return vid;
        } catch (e) { return 'jpv_' + Date.now(); }
    }
    function getSessionId() {
        try {
            var sid = sessionStorage.getItem('jp_session_id');
            if (!sid) {
                sid = 'jps_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
                sessionStorage.setItem('jp_session_id', sid);
            }
            return sid;
        } catch (e) { return 'jps_' + Date.now(); }
    }
    function fingerprint() {
        try {
            var parts = [
                navigator.userAgent, navigator.language, navigator.platform,
                screen.width + 'x' + screen.height, screen.colorDepth,
                window.devicePixelRatio || 1,
                Intl.DateTimeFormat().resolvedOptions().timeZone,
                navigator.hardwareConcurrency || 0,
                navigator.deviceMemory || 0,
                navigator.maxTouchPoints || 0
            ];
            var str = parts.join('###');
            var hash = 0;
            for (var i = 0; i < str.length; i++) {
                hash = ((hash << 5) - hash) + str.charCodeAt(i);
                hash = hash & hash;
            }
            return 'jpfp_' + Math.abs(hash).toString(36);
        } catch (e) { return 'jpfp_unknown'; }
    }
    function parseDevice() {
        var ua = navigator.userAgent;
        var device = /Mobile|Android|iPhone|iPad|iPod/i.test(ua) ? 'Mobile' : 'Desktop';
        var browser = 'other';
        if (/Edg\//i.test(ua)) browser = 'Edge';
        else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
        else if (/Firefox\//i.test(ua)) browser = 'Firefox';
        else if (/Chrome\//i.test(ua)) browser = /Mobile/i.test(ua) ? 'Chrome Mobile' : 'Chrome';
        else if (/Safari\//i.test(ua) && /Version\//i.test(ua)) browser = 'Safari';
        var os = 'other';
        if (/Windows/i.test(ua)) os = 'Windows';
        else if (/Android/i.test(ua)) os = 'Android ' + (ua.match(/Android\s([\d.]+)/) || [])[1];
        else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
        else if (/Mac OS X/i.test(ua)) os = 'macOS';
        else if (/Linux/i.test(ua)) os = 'Linux';
        return { device: device, browser: browser, os: os };
    }
    function getNetwork() {
        try {
            var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (conn && conn.effectiveType) {
                return conn.effectiveType + (conn.downlink ? ' (' + conn.downlink + 'Mbps)' : '');
            }
        } catch (e) {}
        return null;
    }

    var visitorId = getVisitorId();
    var sessionId = getSessionId();
    var fp = fingerprint();
    var dev = parseDevice();
    var startTime = Date.now();

    function send(eventType, extra) {
        var payload = {
            event_type: eventType,
            session_id: sessionId,
            visitor_id: visitorId,
            device_fingerprint: fp,
            page_url: window.location.href,
            page_title: document.title,
            referrer: document.referrer || null,
            screen: screen.width + 'x' + screen.height + ' (DPR:' + (window.devicePixelRatio || 1) + ')',
            device_type: dev.device,
            browser: dev.browser,
            os: dev.os,
            network: getNetwork(),
            time_on_page: Date.now() - startTime,
            scroll_percent: Math.round((window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight)) * 100),
            timestamp: new Date().toISOString()
        };
        if (extra) {
            for (var k in extra) {
                if (extra.hasOwnProperty(k)) payload[k] = extra[k];
            }
        }
        try {
            if (navigator.sendBeacon) {
                navigator.sendBeacon(ENDPOINT, JSON.stringify(payload));
            } else {
                fetch(ENDPOINT, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    keepalive: true
                }).catch(function () {});
            }
        } catch (e) {}
    }

    function sendPageview() { send('pageview'); }

    function setupHeartbeat() {
        setInterval(function () {
            if (!document.hidden) send('heartbeat');
        }, HEARTBEAT_MS);
    }

    function setupClicks() {
        document.addEventListener('click', function (e) {
            var el = e.target.closest ? e.target.closest('a, button, [role="button"]') : null;
            if (!el) return;
            send('click', {
                event_data: {
                    element: el.tagName,
                    text: (el.innerText || '').trim().substring(0, 80),
                    href: el.href || null
                }
            });
        }, { passive: true });
    }

    function setupVisibility() {
        document.addEventListener('visibilitychange', function () {
            send(document.hidden ? 'page_hidden' : 'page_visible');
        });
    }

    function setupExit() {
        window.addEventListener('beforeunload', function () {
            send('page_exit');
        });
    }

    function setupProbe() {
        setTimeout(function () {
            var extra = { event_data: {} };
            try {
                if (navigator.userAgentData) {
                    extra.event_data.uaHints = {
                        platform: navigator.userAgentData.platform,
                        mobile: navigator.userAgentData.mobile,
                        brands: navigator.userAgentData.brands
                    };
                }
            } catch (e) {}
            try {
                if (performance.memory) {
                    extra.event_data.memory = {
                        usedMB: Math.round(performance.memory.usedJSHeapSize / 1048576),
                        limitMB: Math.round(performance.memory.jsHeapSizeLimit / 1048576)
                    };
                }
            } catch (e) {}
            try {
                var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
                if (nav) extra.event_data.loadTimeMs = Math.round(nav.loadEventEnd || nav.domComplete || 0);
            } catch (e) {}
            send('device_probe', extra);
        }, PROBE_DELAY_MS);
    }

    function init() {
        sendPageview();
        setupHeartbeat();
        setupClicks();
        setupVisibility();
        setupExit();
        setupProbe();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
