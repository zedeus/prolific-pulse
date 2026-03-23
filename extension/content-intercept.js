// content-intercept.js — MAIN world (Chrome only)
// Patches window.fetch AND XMLHttpRequest on Prolific pages to intercept
// API response bodies. Runs at document_start before page scripts load.
// Relays parsed JSON via postMessage to the ISOLATED-world bridge script.
(() => {
  "use strict";

  const MSG_TYPE = "__prolific_pulse_intercept__";

  const INTERCEPT_PATTERNS = [
    {
      pattern: /^https:\/\/internal-api\.prolific\.com\/api\/v1\/participant\/studies\//,
      subtype: "studies"
    },
    {
      pattern: /^https:\/\/internal-api\.prolific\.com\/api\/v1\/participant\/submissions\//,
      subtype: "participant_submissions"
    },
    {
      pattern: /^https:\/\/internal-api\.prolific\.com\/api\/v1\/submissions\/reserve\//,
      subtype: "submission"
    },
    {
      pattern: /^https:\/\/internal-api\.prolific\.com\/api\/v1\/submissions\/[^/]+\/transition\//,
      subtype: "submission"
    },
    {
      pattern: /^https:\/\/auth\.prolific\.com\/oauth\/token/,
      subtype: "oauth_token"
    }
  ];

  function matchURL(url) {
    if (!url) return null;
    return INTERCEPT_PATTERNS.find((p) => p.pattern.test(url)) || null;
  }

  function relay(subtype, url, status, body) {
    try {
      window.postMessage({
        type: MSG_TYPE,
        subtype,
        url,
        status,
        body,
        observed_at: new Date().toISOString()
      }, "*");
    } catch {
      // Silent — never interfere with page behavior.
    }
  }

  function tryParseJSON(value) {
    if (value && typeof value === "object") return value;
    if (typeof value !== "string" || !value) return null;
    try { return JSON.parse(value); } catch { return null; }
  }

  // --- Patch fetch() ---
  const originalFetch = window.fetch;
  window.fetch = function (input) {
    const result = originalFetch.apply(this, arguments);
    // Skip if the extension's own fetchStudiesInTab is active — it processes
    // the response directly, so intercepting would cause double-processing.
    if (window.__pp_ext_fetch) return result;
    try {
      const url = typeof input === "string"
        ? input
        : (input && typeof input === "object" && input.url ? input.url : "");
      const match = matchURL(url);
      if (match) {
        result.then((response) => {
          try {
            response.clone().json()
              .then((body) => relay(match.subtype, url, response.status, body))
              .catch(() => {});
          } catch {}
        }).catch(() => {});
      }
    } catch {}
    return result;
  };

  // --- Patch XMLHttpRequest ---
  const XHROpen = XMLHttpRequest.prototype.open;
  const XHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function () {
    this.__pp_url = typeof arguments[1] === "string" ? arguments[1] : String(arguments[1] || "");
    this.__pp_match = matchURL(this.__pp_url);
    return XHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    if (this.__pp_match) {
      const xhr = this;
      const match = this.__pp_match;
      const url = this.__pp_url;
      xhr.addEventListener("load", function () {
        try {
          // Accept any completed response — let the background decide what to do
          // with non-200 statuses. xhr.response is pre-parsed when responseType
          // is "json", or a string when responseType is "" or "text".
          const body = tryParseJSON(xhr.response);
          if (body) {
            relay(match.subtype, url, xhr.status, body);
          }
        } catch {}
      });
    }
    return XHRSend.apply(this, arguments);
  };
})();
