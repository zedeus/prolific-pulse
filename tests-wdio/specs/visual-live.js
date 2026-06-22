// Visual audit: seed IndexedDB with fake studies, screenshot the live panel,
// report render timings. Screenshots land in screenshots/visual/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POPUP_URL } from '../helpers/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'screenshots', 'visual');
const SCALES = [0, 3, 10, 50];

async function setTheme(theme) {
  await browser.execute((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

async function seedStudies(count) {
  const t0 = Date.now();
  const result = await browser.executeAsync((n, done) => {
    const run = async () => {
      if (!window.__ppDev) { done({ error: 'no __ppDev' }); return; }
      const seededCount = await window.__ppDev.seedStudies(n);
      done({ count: seededCount });
    };
    run().catch((e) => done({ error: String(e) }));
  }, count);
  const ms = Date.now() - t0;
  console.log(`  seeded ${result.count} studies in ${ms}ms`);
  return ms;
}

async function clearStudies() {
  await browser.executeAsync((done) => {
    if (!window.__ppDev) { done(); return; }
    window.__ppDev.clearStudies().then(done).catch(() => done());
  });
}

async function navigateToLivePanel() {
  await browser.execute(() => {
    const liveTab = document.querySelector('button[data-tab="live"]');
    if (liveTab) liveTab.click();
  });
  await browser.pause(100);
}

async function resizeWindow() {
  try {
    await browser.setWindowRect(0, 0, 620, 700);
  } catch {
    try { await browser.setWindowSize(620, 700); } catch { /* ignore */ }
  }
}

async function screenshot(name) {
  const filePath = path.join(OUT_DIR, `${name}.png`);
  await browser.saveScreenshot(filePath);
  console.log(`  saved: ${filePath}`);
}

describe('Visual: Live Panel', () => {
  before(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await browser.url(POPUP_URL);
    await browser.waitUntil(
      async () => browser.execute(() => typeof window.__ppDev?.seedStudies === 'function'),
      { timeout: 10_000, timeoutMsg: '__ppDev.seedStudies not available' },
    );
    await resizeWindow();
  });

  for (const count of SCALES) {
    describe(`n=${count}`, () => {
      before(async () => {
        await clearStudies();
        if (count > 0) await seedStudies(count);
        await browser.url(POPUP_URL);
        await browser.pause(300);
        await navigateToLivePanel();
      });

      it(`screenshots live-n${count}-light`, async () => {
        await setTheme('light');
        await browser.pause(150);
        await screenshot(`live-n${count}-light`);
      });

      it(`screenshots live-n${count}-dark`, async () => {
        await setTheme('dark');
        await browser.pause(150);
        await screenshot(`live-n${count}-dark`);
      });
    });
  }

  describe('filter states', () => {
    before(async () => {
      await clearStudies();
      await seedStudies(20);
      await browser.url(POPUP_URL);
      await browser.pause(300);
      await navigateToLivePanel();
    });

    it('screenshots live-filtered-light', async () => {
      await setTheme('light');
      await browser.execute(() => {
        const searchInput = document.querySelector('#panelLive input[type="text"]');
        if (searchInput) {
          searchInput.value = 'opinion';
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await browser.pause(150);
      await screenshot('live-filtered-light');
    });

    it('screenshots live-sort-reward-dark', async () => {
      await setTheme('dark');
      await browser.execute(() => {
        const searchInput = document.querySelector('#panelLive input[type="text"]');
        if (searchInput) {
          searchInput.value = '';
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const sortSelect = document.querySelector('#panelLive select');
        if (sortSelect) {
          sortSelect.value = 'reward';
          sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await browser.pause(150);
      await screenshot('live-sort-reward-dark');
    });

    it('screenshots live-quickfilter-light', async () => {
      await setTheme('light');
      await browser.execute(() => {
        const sortSelect = document.querySelector('#panelLive select');
        if (sortSelect) {
          sortSelect.value = 'newest';
          sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        // Click filter toggle to expand filters
        const filterBtn = document.querySelector('#panelLive .btn-square');
        if (filterBtn) filterBtn.click();
      });
      await browser.pause(100);
      await browser.execute(() => {
        const minRewardInput = document.querySelector('#panelLive input[type="number"]');
        if (minRewardInput) {
          minRewardInput.value = '3';
          minRewardInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await browser.pause(150);
      await screenshot('live-quickfilter-light');
    });

    it('screenshots live-nomatches-dark', async () => {
      await setTheme('dark');
      await browser.execute(() => {
        const minRewardInput = document.querySelector('#panelLive input[type="number"]');
        if (minRewardInput) {
          minRewardInput.value = '999';
          minRewardInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await browser.pause(150);
      await screenshot('live-nomatches-dark');
    });
  });
});
