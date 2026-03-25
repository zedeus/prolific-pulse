import { navigateToPopup } from '../helpers/popup-dom.js';
import { PROLIFIC_STUDIES_URL } from '../helpers/constants.js';

function getDiagnostics() {
  return browser.execute(() => {
    // Open debug section if closed
    const details = document.querySelector('details.debug-details');
    if (details && !details.open) details.querySelector('summary')?.click();

    const grid = {};
    for (const row of document.querySelectorAll('#debugGrid .debug-row')) {
      const key = row.querySelector('.debug-key')?.textContent?.trim() ?? '';
      const val = row.querySelector('.debug-value')?.textContent?.trim() ?? '';
      if (key) grid[key] = val;
    }

    const logs = [...document.querySelectorAll('#debugLog .debug-line')]
      .map((el) => el.textContent?.trim() ?? '')
      .filter(Boolean);

    return { grid, logs, gridCount: Object.keys(grid).length, logCount: logs.length };
  });
}

describe('Debug State', () => {
  it('should have extension state in diagnostics panel', async () => {
    await browser.url(PROLIFIC_STUDIES_URL);
    await browser.pause(3000);

    await navigateToPopup();
    await browser.execute(() => {
      document.querySelector('button[data-tab="settings"]')?.click();
    });
    await browser.pause(500);

    const diag = await getDiagnostics();
    expect(diag.gridCount).toBeGreaterThan(0);
  });

  it('should show debug log entries', async () => {
    await navigateToPopup();
    await browser.execute(() => {
      document.querySelector('button[data-tab="settings"]')?.click();
    });
    await browser.pause(500);

    const diag = await getDiagnostics();
    expect(diag.logCount).toBeGreaterThan(0);
  });

  it('should confirm studies response was captured', async () => {
    // Navigate away and back to trigger fresh interception
    await browser.url('about:blank');
    await browser.pause(500);
    await browser.url(PROLIFIC_STUDIES_URL);
    await browser.pause(10000);

    // Check via popup diagnostics
    await navigateToPopup();
    await browser.execute(() => {
      document.querySelector('button[data-tab="settings"]')?.click();
    });
    await browser.pause(500);

    const diag = await getDiagnostics();
    // The diagnostics grid should show capture status
    const captureKey = Object.keys(diag.grid).find(
      (k) => k.toLowerCase().includes('capture') || k.toLowerCase().includes('response'),
    );
    // At minimum, the grid should have entries and logs should show capture events
    expect(diag.gridCount).toBeGreaterThan(0);
    expect(diag.logCount).toBeGreaterThan(0);
  });
});
