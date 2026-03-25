import { navigateToPopup, getPopupStatus } from '../helpers/popup-dom.js';

describe('Extension Health', () => {
  it('should load the popup page', async () => {
    await navigateToPopup();
    const title = await browser.getTitle();
    expect(typeof title).toBe('string');
  });

  it('should show sync dot without error state', async () => {
    await navigateToPopup();
    const status = await getPopupStatus();
    expect(status.dot_bad).toBe(false);
  });

  it('should have the extension URL set', async () => {
    expect(browser.popupUrl).toMatch(/^(moz-extension|chrome-extension):\/\//);
  });
});
