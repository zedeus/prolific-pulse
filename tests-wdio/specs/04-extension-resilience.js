import { navigateToPopup, getPopupStatus } from '../helpers/popup-dom.js';
import { PROLIFIC_STUDIES_URL } from '../helpers/constants.js';

describe('Extension Resilience', () => {
  it('should recover state after navigating away and back', async () => {
    // Check initial state
    await navigateToPopup();
    const before = await getPopupStatus();
    expect(before.dot_bad).toBe(false);

    // Navigate away to about:blank
    await browser.url('about:blank');
    await browser.pause(2000);

    // Navigate back to Prolific and recheck
    await browser.url(PROLIFIC_STUDIES_URL);
    await browser.pause(5000);

    await navigateToPopup();
    await browser.pause(2000);
    const after = await getPopupStatus();
    expect(after.dot_bad).toBe(false);
  });

  it('should maintain data after popup close and reopen', async () => {
    // Get study count from first popup open
    await navigateToPopup();
    await browser.pause(2000);
    const cardsBefore = await browser.execute(() =>
      document.querySelectorAll('#panelLive .event.live').length,
    );

    // Close popup (navigate away)
    await browser.url('about:blank');
    await browser.pause(1000);

    // Reopen popup
    await navigateToPopup();
    await browser.pause(2000);
    const cardsAfter = await browser.execute(() =>
      document.querySelectorAll('#panelLive .event.live').length,
    );

    // Should have the same data (from IndexedDB, persisted)
    expect(cardsAfter).toBe(cardsBefore);
  });
});
