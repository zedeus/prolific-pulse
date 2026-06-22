// Visual audit: seed IndexedDB with fake submissions, screenshot the submissions panel
// and detail modal.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POPUP_URL } from '../helpers/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'screenshots', 'visual');
const SCALES = [0, 10, 100];

async function setTheme(theme) {
  await browser.execute((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

async function seedSubmissions(count) {
  const t0 = Date.now();
  const result = await browser.executeAsync((n, done) => {
    const run = async () => {
      if (!window.__ppDev) { done({ error: 'no __ppDev' }); return; }
      const seededCount = await window.__ppDev.seed(n);
      done({ count: seededCount });
    };
    run().catch((e) => done({ error: String(e) }));
  }, count);
  const ms = Date.now() - t0;
  console.log(`  seeded ${result.count} submissions in ${ms}ms`);
  return ms;
}

async function clearSubmissions() {
  await browser.executeAsync((done) => {
    if (!window.__ppDev) { done(); return; }
    window.__ppDev.clear().then(done).catch(() => done());
  });
}

async function navigateToSubmissionsPanel() {
  await browser.execute(() => {
    const tab = document.querySelector('button[data-tab="submissions"]');
    if (tab) tab.click();
  });
  await browser.pause(100);
}

async function mockAuthState() {
  await browser.executeAsync((done) => {
    // Set sync state to appear authenticated so the popup doesn't show "Waiting for login"
    const fakeState = {
      token_ok: true,
      token_auth_required: false,
      token_reason: 'mocked',
    };
    browser.storage.local.set({ syncState: fakeState }).then(done).catch(() => done());
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

describe('Visual: Submissions Panel', () => {
  before(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await browser.url(POPUP_URL);
    await browser.waitUntil(
      async () => browser.execute(() => typeof window.__ppDev?.seed === 'function'),
      { timeout: 10_000, timeoutMsg: '__ppDev.seed not available' },
    );
    await resizeWindow();
  });

  for (const count of SCALES) {
    describe(`n=${count}`, () => {
      before(async () => {
        await clearSubmissions();
        if (count > 0) await seedSubmissions(count);
        await mockAuthState();
        await browser.url(POPUP_URL);
        await browser.pause(300);
        await navigateToSubmissionsPanel();
      });

      it(`screenshots submissions-n${count}-light`, async () => {
        await setTheme('light');
        await browser.pause(150);
        await screenshot(`submissions-n${count}-light`);
      });

      it(`screenshots submissions-n${count}-dark`, async () => {
        await setTheme('dark');
        await browser.pause(150);
        await screenshot(`submissions-n${count}-dark`);
      });
    });
  }

  describe('filter states', () => {
    before(async () => {
      await clearSubmissions();
      await seedSubmissions(50);
      await mockAuthState();
      await browser.url(POPUP_URL);
      await browser.pause(300);
      await navigateToSubmissionsPanel();
    });

    it('screenshots submissions-status-filter-light', async () => {
      await setTheme('light');
      await browser.execute(() => {
        const statusSelect = document.querySelectorAll('#panelSubmissions select')[0];
        if (statusSelect) {
          statusSelect.value = 'rejected';
          statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await browser.pause(150);
      await screenshot('submissions-status-filter-light');
    });

    it('screenshots submissions-advanced-filters-dark', async () => {
      await setTheme('dark');
      await browser.execute(() => {
        // Reset status filter
        const statusSelect = document.querySelectorAll('#panelSubmissions select')[0];
        if (statusSelect) {
          statusSelect.value = 'all';
          statusSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        // Click filter toggle to expand advanced filters
        const filterBtn = document.querySelector('#panelSubmissions .btn-square');
        if (filterBtn) filterBtn.click();
      });
      await browser.pause(150);
      await screenshot('submissions-advanced-filters-dark');
    });

    it('screenshots submissions-detail-modal-light', async () => {
      await setTheme('light');
      // Close filter panel if open
      await browser.execute(() => {
        const filterBtn = document.querySelector('#panelSubmissions .btn-square.btn-primary');
        if (filterBtn) filterBtn.click();
      });
      await browser.pause(100);
      // Click first submission card to open detail modal
      await browser.execute(() => {
        const firstCard = document.querySelector('#panelSubmissions .event-btn');
        if (firstCard) firstCard.click();
      });
      await browser.pause(200);
      await screenshot('submissions-detail-modal-light');
    });

    it('screenshots submissions-detail-modal-dark', async () => {
      await setTheme('dark');
      await browser.pause(150);
      await screenshot('submissions-detail-modal-dark');
    });
  });
});
