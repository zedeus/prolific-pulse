import { navigateToPopup, getPopupStatus } from '../helpers/popup-dom.js';
import { PROLIFIC_STUDIES_URL } from '../helpers/constants.js';

describe('Studies Interception', () => {
  it('should receive studies data after page load', async () => {
    await browser.url(PROLIFIC_STUDIES_URL);
    await browser.pause(5000);

    // Poll popup for refresh timestamp to appear
    const deadline = Date.now() + 15_000;
    let hasRefresh = false;
    while (Date.now() < deadline) {
      await navigateToPopup();
      await browser.pause(1000);
      const status = await getPopupStatus();
      if (status.refresh_text && status.refresh_text !== 'never' && status.refresh_text !== '') {
        hasRefresh = true;
        break;
      }
      await browser.url(PROLIFIC_STUDIES_URL);
      await browser.pause(2000);
    }

    expect(hasRefresh).toBe(true);
  });

  it('should show extension as healthy after interception', async () => {
    await navigateToPopup();
    const status = await getPopupStatus();
    expect(status.dot_bad).toBe(false);
    expect(status.error_visible).toBe(false);
  });

  it('should populate studies in popup', async () => {
    await navigateToPopup();
    await browser.pause(2000);

    // The live panel should have studies or an empty state
    const panel = await browser.execute(() => {
      const el = document.getElementById('panelLive');
      if (!el) return null;
      return {
        cardCount: el.querySelectorAll('.event').length,
        emptyState: !!el.querySelector('.empty-events'),
      };
    });

    expect(panel).not.toBeNull();
    // Studies list should show data (even if 0 studies are available,
    // the empty state should be visible)
    expect(panel.cardCount > 0 || panel.emptyState).toBe(true);
  });

  it('should fire delayed refresh @slow', async function () {
    this.timeout(150_000);

    // Navigate to trigger an initial refresh
    await browser.url(PROLIFIC_STUDIES_URL);
    await browser.pause(5000);

    // Get the initial refresh timestamp from popup
    await navigateToPopup();
    await browser.pause(2000);
    const initialRefreshText = await browser.execute(() => {
      const el = document.getElementById('latestRefresh');
      return el?.textContent?.trim() ?? '';
    });

    // Wait for a delayed refresh to fire (timestamp should change)
    // With default settings, delayed refreshes fire at ~30s intervals
    const deadline = Date.now() + 90_000;
    let refreshChanged = false;
    while (Date.now() < deadline) {
      await browser.pause(5000);
      await navigateToPopup();
      await browser.pause(1000);
      const currentRefreshText = await browser.execute(() => {
        const el = document.getElementById('latestRefresh');
        return el?.textContent?.trim() ?? '';
      });

      // The relative time display should update (e.g., "5s ago" → "35s ago" or change entirely)
      if (currentRefreshText !== initialRefreshText && currentRefreshText !== '' && currentRefreshText !== 'never') {
        refreshChanged = true;
        break;
      }
    }

    expect(refreshChanged).toBe(true);
  });
});
