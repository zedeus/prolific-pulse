import { navigateToPopup, getPopupStatus } from '../helpers/popup-dom.js';
import { PROLIFIC_STUDIES_URL } from '../helpers/constants.js';

describe('Server Reconnection', () => {
  it('should detect offline and recover after server restart', async () => {
    const goServer = browser.goServer;

    // Open popup while server is up
    await navigateToPopup();

    // Phase 1: Stop server and verify offline detection
    await goServer.stop();
    await browser.pause(2000);
    await browser.refresh();
    await browser.pause(2000);

    let status = await getPopupStatus();
    expect(
      status.refresh_text === 'Offline' || status.dot_bad === true,
    ).toBe(true);

    // Phase 2: Restart server and verify recovery
    goServer.start();
    await goServer.waitHealthy();

    // Visit Prolific so the extension can resync its token.
    // On Chrome, the service worker may have been terminated during downtime
    // and needs a live Prolific tab to extract the OIDC token on restart.
    await browser.url(PROLIFIC_STUDIES_URL);
    await browser.pause(5000);

    const deadline = Date.now() + 30_000;
    let recovered = false;
    let lastStatus = null;
    while (Date.now() < deadline) {
      await navigateToPopup();
      await browser.pause(2000);
      lastStatus = await getPopupStatus();
      if (lastStatus.refresh_text !== 'Offline' && lastStatus.dot_bad === false) {
        recovered = true;
        break;
      }
      await browser.pause(3000);
    }

    if (!recovered) {
      throw new Error(
        `Popup did not recover after server restart. Last status: ${JSON.stringify(lastStatus)}`,
      );
    }
  });
});
