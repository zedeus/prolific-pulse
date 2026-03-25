import { browser } from 'wxt/browser';

export default defineContentScript({
  matches: ['*://app.prolific.com/*', '*://auth.prolific.com/*'],
  include: ['chrome'],
  runAt: 'document_start',
  async main() {
    const MSG_TYPE = '__prolific_pulse_intercept__';

    // Inject the MAIN-world script that patches fetch/XHR
    await injectScript('/intercept-main.js' as any, { keepInDom: true });

    // Listen for relayed API responses from the MAIN world via postMessage
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window) return;
      if (!event.data || event.data.type !== MSG_TYPE) return;

      try {
        browser.runtime.sendMessage({
          action: 'interceptedResponse',
          subtype: event.data.subtype,
          url: event.data.url,
          status: event.data.status,
          body: event.data.body,
          observed_at: event.data.observed_at,
        });
      } catch {
        // Extension may be reloading — ignore.
      }
    });
  },
});
