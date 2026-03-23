import { getDebugExtensionState } from '../helpers/server-api.js';
import { PROLIFIC_STUDIES_URL } from '../helpers/constants.js';

describe('Debug State Reporting', () => {
  it('should have extension state on server', async () => {
    // Ensure extension has reported state by visiting Prolific
    await browser.url(PROLIFIC_STUDIES_URL);
    await browser.pause(3000);

    const deadline = Date.now() + 15_000;
    let state = {};
    while (Date.now() < deadline) {
      state = await getDebugExtensionState();
      if (Object.keys(state).length > 0) break;
      await browser.pause(2000);
    }

    expect(Object.keys(state).length).toBeGreaterThan(0);
  });

  it('should report extension URL with correct scheme', async () => {
    const state = await getDebugExtensionState();
    expect(state.extension_url).toMatch(/^(moz-extension|chrome-extension):\/\//);
  });

  it('should include sync_state object', async () => {
    const state = await getDebugExtensionState();
    expect(state).toHaveProperty('sync_state');
    expect(typeof state.sync_state).toBe('object');
  });

  it('should include received_at in raw response', async () => {
    const raw = await getDebugExtensionState(true);
    expect(raw.has_state).toBe(true);
    expect(raw).toHaveProperty('received_at');
  });

  it('should confirm studies response body was captured', async () => {
    // Navigate away first to ensure a fresh page load triggers a new XHR.
    // On Firefox, filterResponseData captures the body.
    // On Chrome, the content script XHR/fetch monkeypatch captures it.
    await browser.url('about:blank');
    await browser.pause(500);
    await browser.url(PROLIFIC_STUDIES_URL);
    await browser.pause(10000);

    // Check content script diagnostics (Chrome only — Firefox won't have __pp_diag).
    const diag = await browser.execute(() => window.__pp_diag || null);
    if (diag) {
      console.log('    Content script diag:', JSON.stringify(diag));
    }

    const state = await getDebugExtensionState();
    const ss = state.sync_state || {};
    console.log('    capture_ok:', ss.studies_response_capture_ok);
    console.log('    capture_last_at:', ss.studies_response_capture_last_at || 'never');
    expect(ss.studies_response_capture_ok).toBe(true);
  });
});
