// content-bridge.js — ISOLATED world (Chrome only)
// Relays intercepted API response data from the MAIN-world content script
// to the extension background via chrome.runtime.sendMessage.
(() => {
  "use strict";

  const MSG_TYPE = "__prolific_pulse_intercept__";

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== MSG_TYPE) return;

    try {
      chrome.runtime.sendMessage({
        action: "interceptedResponse",
        subtype: event.data.subtype,
        url: event.data.url,
        status: event.data.status,
        body: event.data.body,
        observed_at: event.data.observed_at
      });
    } catch {
      // Extension may be reloading — ignore.
    }
  });
})();
