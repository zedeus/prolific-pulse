/**
 * Screenshot capture for visual review.
 * Takes screenshots of every tab in both light and dark mode.
 * Output: tests-wdio/screenshots/
 */
import { navigateToPopup } from '../helpers/popup-dom.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');

function switchToTab(tab) {
  return browser.execute((t) => document.querySelector(`button[data-tab="${t}"]`)?.click(), tab);
}

function setTheme(theme) {
  return browser.execute((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

async function screenshot(name) {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await browser.saveScreenshot(filePath);
  console.log(`Screenshot: ${filePath}`);
}

describe('Screenshots', () => {
  for (const theme of ['light', 'dark']) {
    for (const tab of ['live', 'feed', 'submissions', 'settings']) {
      it(`${theme} mode — ${tab} tab`, async () => {
        await navigateToPopup();
        await setTheme(theme);
        await switchToTab(tab);
        await browser.pause(500);

        // Expand diagnostics if on settings
        if (tab === 'settings') {
          await browser.execute(() => {
            const details = document.querySelector('details.debug-details');
            if (details && !details.open) details.querySelector('summary')?.click();
          });
          await browser.pause(300);
        }

        await screenshot(`${theme}-${tab}`);
      });
    }
  }
});
