/** Cookieless tracker: IDs exist only in memory for the lifetime of the current page/tab. */
export const TRACKER_SOURCE = String.raw`(function () {
  'use strict';
  try {
    var script = document.currentScript;
    var site = script && script.getAttribute('data-site');
    if (!site || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(site)) return;
    if (window.audience) return;
    var collector = new URL('/v1/events', script.src);
    if (collector.protocol !== 'https:' && collector.protocol !== 'http:') return;
    var configuredEndpoint = script.getAttribute('data-endpoint');
    if (configuredEndpoint) {
      collector = new URL(configuredEndpoint, location.href);
      if (collector.origin !== location.origin || collector.protocol !== 'https:') return;
    }
    var endpoint = collector.href;
    var SESSION_MS = 30 * 60 * 1000;
    var IDLE_MS = 30 * 1000;
    var memoryVisitor = null;
    var memorySession = null;
    var memoryExcluded = false;
    var lastRoute = null;
    var currentPath = '/';
    var lastInteraction = null;
    var lastTick = Date.now();
    var pendingSeconds = 0;
    var focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    var pageVisible = document.visibilityState !== 'hidden';
    var lastAuto = null;

    function safe(fn) { return function () { try { return fn.apply(this, arguments); } catch (_) {} }; }
    function uuid() {
      try { if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID(); } catch (_) {}
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (letter) {
        var n = Math.floor(Math.random() * 16);
        return (letter === 'x' ? n : (n & 3) | 8).toString(16);
      });
    }
    function blocked() {
      var dnt = String(navigator.doNotTrack || navigator.msDoNotTrack || window.doNotTrack || '').toLowerCase();
      return navigator.globalPrivacyControl === true || dnt === '1' || dnt === 'yes' || memoryExcluded;
    }
    function visible() { return pageVisible && focused; }
    function context(now) {
      // No cookies, persisted browser IDs, fingerprint, or cross-tab matching.
      // A reload is a new browser visit; SPA routes retain this in-memory ID.
      if (memoryVisitor === null) memoryVisitor = uuid();
      if (!memorySession || now - memorySession.at >= SESSION_MS || memorySession.at > now + 60000) memorySession = { id: uuid(), at: now };
      memorySession.at = now;
      return { visitor: memoryVisitor, session: memorySession.id };
    }
    function routeKey() {
      var route = location.pathname || '/';
      var hash = location.hash || '';
      if (/^#!?\//.test(hash)) route = route.replace(/\/$/, '') + '/~' + hash.replace(/^#!/, '').replace(/^#/, '').split('?')[0].split('#')[0];
      return route;
    }
    function cleanPath(route) {
      var previous = '';
      var parts = route.split('/').filter(Boolean).map(function (part) {
        var decoded = part;
        try { decoded = decodeURIComponent(part); } catch (_) {}
        var secretContext = /^(invite|reset|token|users?|profile|view)$/i.test(previous);
        previous = decoded;
        if (decoded.indexOf('@') !== -1) return ':redacted';
        if (secretContext || /^[-+]?\d+(\.\d+)?$/.test(decoded) || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(decoded) || /^[a-f0-9]{24,}$/i.test(decoded) || decoded.length > 64) return ':id';
        return part;
      });
      return ('/' + parts.join('/')).slice(0, 200);
    }
    function source() {
      try { return document.referrer ? new URL(document.referrer).hostname.slice(0, 253) : ''; } catch (_) { return ''; }
    }
    function device() {
      var ua = String(navigator.userAgent || '');
      return /ipad|tablet/i.test(ua) ? 'tablet' : /mobile|iphone|android/i.test(ua) || (navigator.userAgentData && navigator.userAgentData.mobile) ? 'mobile' : 'desktop';
    }
    function send(type, name, path, activeSeconds, internal) {
      if (blocked()) return false;
      var ids = context(Date.now());
      var event = { id: uuid(), site: site, visitor: ids.visitor, session: ids.session, type: type,
        path: path || currentPath, source: source(), device: device(), automation: navigator.webdriver === true };
      if (name) event.name = name;
      if (internal) event.internal = true;
      if (type === 'engagement') event.activeSeconds = Math.max(0, Math.min(30, activeSeconds || 0));
      var body = JSON.stringify(event);
      try {
        if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(endpoint, new Blob([body], { type: 'text/plain' }))) return true;
      } catch (_) {}
      try {
        if (typeof fetch === 'function') {
          var promise = fetch(endpoint, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true, credentials: 'omit', mode: 'cors' });
          if (promise && typeof promise.catch === 'function') promise.catch(function () {});
        }
      } catch (_) {}
      return true;
    }
    function accrue(now) {
      if (blocked()) { pendingSeconds = 0; lastInteraction = null; lastTick = now; return; }
      if (visible() && lastInteraction !== null) {
        var to = Math.min(now, lastInteraction + IDLE_MS);
        var from = Math.max(lastTick, lastInteraction);
        if (to > from) pendingSeconds = Math.min(30, pendingSeconds + (to - from) / 1000);
      }
      lastTick = now;
    }
    function interact(event) {
      if (event && event.isTrusted === false) return;
      var now = Date.now();
      accrue(now);
      if (!blocked() && visible()) lastInteraction = now;
    }
    function flush(path) {
      accrue(Date.now());
      var delta = Math.min(30, Math.floor(pendingSeconds));
      if (delta > 0) { pendingSeconds -= delta; send('engagement', null, path || currentPath, delta); }
    }
    function feature(name) {
      if (typeof name !== 'string' || !/^[a-z][a-z0-9_:-]{0,63}$/.test(name) || blocked()) return;
      interact();
      send('feature', name, currentPath);
    }
    function changed() {
      var next = routeKey();
      if (next === lastRoute) return;
      flush(currentPath);
      lastRoute = next;
      currentPath = cleanPath(next);
      send('pageview', null, currentPath);
    }
    function autoFeature(name, kind) {
      var now = Date.now();
      if (kind === 'submit' && lastAuto && lastAuto.kind === 'click' && lastAuto.name === name && now - lastAuto.at < 1000) return;
      lastAuto = { name: name, at: now, kind: kind };
      feature(name);
    }
    function closest(target, selector) {
      if (target && target.nodeType === 3) target = target.parentElement;
      return target && typeof target.closest === 'function' ? target.closest(selector) : null;
    }
    function click(event) {
      var tagged = closest(event.target, '[data-audience-feature]');
      if (tagged) { autoFeature(tagged.getAttribute('data-audience-feature'), 'click'); return; }
      var link = closest(event.target, 'a[href]');
      if (!link) return;
      if (link.hasAttribute('download')) { autoFeature('download', 'click'); return; }
      try {
        var url = new URL(link.href, location.href);
        if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== location.hostname) autoFeature('outbound_link', 'click');
      } catch (_) {}
    }
    function submit(event) {
      var form = event.target;
      var tagged = closest(form, '[data-audience-feature]');
      if (tagged) { autoFeature(tagged.getAttribute('data-audience-feature'), 'submit'); return; }
      if (form && ((typeof form.matches === 'function' && form.matches('[role="search"],[data-audience-search]')) || (typeof form.querySelector === 'function' && form.querySelector('input[type="search"]')))) autoFeature('site_search', 'submit');
    }
    function suspend() {
      flush(currentPath);
      lastInteraction = null;
      lastTick = Date.now();
    }
    window.audience = {
      version: 2,
      storage: 'memory',
      identity: 'tab',
      track: safe(feature),
      exclude: safe(function (value) {
        var next = value !== false;
        if (next && !memoryExcluded && !blocked()) send('engagement', null, currentPath, 0, true);
        if (!next && memoryExcluded) { memoryVisitor = null; memorySession = null; }
        memoryExcluded = next;
        pendingSeconds = 0;
        lastInteraction = null;
        lastTick = Date.now();
        if (!blocked()) { lastRoute = null; changed(); }
      })
    };
    ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart', 'wheel'].forEach(function (type) {
      document.addEventListener(type, safe(interact), { passive: true, capture: true });
    });
    document.addEventListener('click', safe(click), true);
    document.addEventListener('submit', safe(submit), true);
    document.addEventListener('play', safe(function (event) {
      var tag = event.target && event.target.tagName;
      if (tag === 'VIDEO' || tag === 'AUDIO') feature('media_play');
    }), true);
    document.addEventListener('visibilitychange', safe(function () {
      if (document.visibilityState === 'hidden') { suspend(); pageVisible = false; }
      else { pageVisible = true; lastTick = Date.now(); lastInteraction = null; }
    }));
    window.addEventListener('blur', safe(function () { suspend(); focused = false; }));
    window.addEventListener('focus', safe(function () { focused = true; lastTick = Date.now(); lastInteraction = null; }));
    window.addEventListener('pagehide', safe(suspend));
    window.addEventListener('popstate', safe(changed));
    window.addEventListener('hashchange', safe(changed));
    ['pushState', 'replaceState'].forEach(function (method) {
      try {
        var original = history[method];
        if (typeof original !== 'function') return;
        history[method] = function () { var result = original.apply(this, arguments); safe(changed)(); return result; };
      } catch (_) {}
    });
    setInterval(safe(function () { flush(currentPath); }), 15000);
    changed();
    try { window.dispatchEvent(new CustomEvent('lupi:audience-ready')); } catch (_) {}
  } catch (_) {}
})();`;
