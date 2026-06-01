/**
 * CartBack Tracking Snippet v1.0
 * 
 * USAGE: Add this to your website's <head>:
 * <script src="https://cdn.cartback.io/track.js" data-key="cb_sk_your_api_key"></script>
 * 
 * Then call CartBack methods from your site:
 * 
 * CartBack.trackCart({
 *   phone: '+919876543210',
 *   email: 'customer@example.com',
 *   name: 'Rahul',
 *   cart_total: 2499.00,
 *   currency: 'INR',
 *   items: [
 *     { product_name: 'Wireless Earbuds', product_id: 'SKU-001', quantity: 1, unit_price: 2499.00 }
 *   ],
 *   consent: true
 * });
 * 
 * CartBack.trackPurchase({
 *   order_id: 'ORD-12345',
 *   order_total: 2249.00,
 *   discount_code: 'CARTBACK-A7X9'
 * });
 * 
 * CartBack.trackConsent({ phone: '+919876543210', source: 'checkout_optin' });
 */
(function () {
  'use strict';

  // Find the script tag to read the API key
  var scripts = document.getElementsByTagName('script');
  var currentScript = scripts[scripts.length - 1];
  var apiKey = currentScript.getAttribute('data-key');

  if (!apiKey) {
    console.warn('[CartBack] Missing data-key attribute on script tag');
    return;
  }

  // Configuration
  var API_BASE = currentScript.getAttribute('data-api') || 'https://api.cartback.io';
  var DEBUG = currentScript.getAttribute('data-debug') === 'true';

  function log() {
    if (DEBUG) console.log.apply(console, ['[CartBack]'].concat(Array.prototype.slice.call(arguments)));
  }

  function send(endpoint, data, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open('POST', API_BASE + '/api/track/' + endpoint, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-API-Key', apiKey);
    xhr.timeout = 10000;

    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) {
          log(endpoint + ' tracked successfully');
          try {
            var response = JSON.parse(xhr.responseText);
            if (callback) callback(null, response);
          } catch (e) {
            if (callback) callback(null, {});
          }
        } else {
          log(endpoint + ' tracking failed:', xhr.status, xhr.responseText);
          if (callback) callback(new Error('HTTP ' + xhr.status));
        }
      }
    };

    xhr.onerror = function () {
      log(endpoint + ' request error');
      if (callback) callback(new Error('Network error'));
    };

    xhr.ontimeout = function () {
      log(endpoint + ' request timeout');
      if (callback) callback(new Error('Timeout'));
    };

    // Add page URL and UTM params automatically
    data.page_url = data.page_url || window.location.href;

    var urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('utm_source')) data.utm_source = urlParams.get('utm_source');
    if (urlParams.get('utm_medium')) data.utm_medium = urlParams.get('utm_medium');
    if (urlParams.get('utm_campaign')) data.utm_campaign = urlParams.get('utm_campaign');

    xhr.send(JSON.stringify(data));
  }

  // ======================== PUBLIC API ========================

  var CartBack = {
    /**
     * Track a cart update
     * Call this whenever the cart changes (add/remove/update items)
     */
    trackCart: function (data, callback) {
      if (!data || !data.phone) {
        log('trackCart requires phone number');
        if (callback) callback(new Error('phone is required'));
        return;
      }

      if (!data.items || !data.items.length) {
        log('trackCart requires at least one item');
        if (callback) callback(new Error('items are required'));
        return;
      }

      send('cart', data, callback);
    },

    /**
     * Track checkout start
     * Call when customer begins the checkout process
     */
    trackCheckout: function (data, callback) {
      send('checkout', data, callback);
    },

    /**
     * Track a completed purchase
     * Call this on your "Thank You" / order confirmation page
     */
    trackPurchase: function (data, callback) {
      if (!data || !data.order_id) {
        log('trackPurchase requires order_id');
        if (callback) callback(new Error('order_id is required'));
        return;
      }

      send('purchase', data, callback);
    },

    /**
     * Record WhatsApp consent
     * Call when customer opts in to receive WhatsApp messages
     */
    trackConsent: function (data, callback) {
      if (!data || !data.phone) {
        log('trackConsent requires phone number');
        if (callback) callback(new Error('phone is required'));
        return;
      }

      send('consent', data, callback);
    },

    /**
     * Helper: Auto-track purchase on order confirmation pages
     * Reads order data from a data attribute on the page
     * 
     * Usage: <div id="cartback-purchase" 
     *           data-order-id="ORD-123" 
     *           data-total="2499" 
     *           data-discount="CARTBACK-A7X9"></div>
     */
    autoTrackPurchase: function () {
      var el = document.getElementById('cartback-purchase');
      if (el) {
        CartBack.trackPurchase({
          order_id: el.getAttribute('data-order-id'),
          order_total: parseFloat(el.getAttribute('data-total') || '0'),
          discount_code: el.getAttribute('data-discount') || undefined,
          discount_amount: parseFloat(el.getAttribute('data-discount-amount') || '0'),
          phone: el.getAttribute('data-phone') || undefined,
          email: el.getAttribute('data-email') || undefined,
        });
      }
    },

    // Version
    version: '1.0.0',
  };

  // Auto-track purchase if the element exists on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', CartBack.autoTrackPurchase);
  } else {
    CartBack.autoTrackPurchase();
  }

  // Expose globally
  window.CartBack = CartBack;

  log('Initialized with key:', apiKey.substring(0, 12) + '...');
})();
