// Visual audit: seed IndexedDB with fake submissions + study types, screenshot the POPUP
// earnings panel (tab "earnings"). The panel scrolls at 420px, so we also capture an
// expanded full-height version where every widget below the fold is visible.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POPUP_URL } from '../helpers/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'screenshots', 'visual');
const SCALES = [0, 12, 300];

async function setTheme(theme) {
  await browser.execute((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

async function seed(count) {
  const result = await browser.executeAsync((n, done) => {
    if (!window.__ppDev) { done({ error: 'no __ppDev' }); return; }
    window.__ppDev.seed(n).then((c) => done({ count: c })).catch((e) => done({ error: String(e) }));
  }, count);
  console.log(`  seeded ${result.count ?? 0} submissions`);
}

async function clearAll() {
  await browser.executeAsync((done) => {
    if (!window.__ppDev) { done(); return; }
    window.__ppDev.clear().then(done).catch(() => done());
  });
}

async function mockAuthState() {
  await browser.executeAsync((done) => {
    browser.storage.local
      .set({ syncState: { token_ok: true, token_auth_required: false, token_reason: 'mocked' } })
      .then(done)
      .catch(() => done());
  });
  await browser.pause(100);
}

async function gotoEarnings() {
  await browser.execute(() => {
    const tab = document.querySelector('button[data-tab="earnings"]');
    if (tab) tab.click();
  });
  await browser.pause(450); // EarningsPanel is lazy-loaded; let it import + derive
}

async function expandPanel() {
  await browser.execute(() => {
    const sc = document.querySelector('#panelEarnings .scroll-container');
    if (sc) { sc.style.maxHeight = 'none'; sc.style.minHeight = '0'; }
  });
  await browser.pause(150);
}

async function resizeWindow(h = 700) {
  try {
    await browser.setWindowRect(0, 0, 620, h);
  } catch {
    try { await browser.setWindowSize(620, h); } catch { /* ignore */ }
  }
}

async function screenshot(name) {
  const filePath = path.join(OUT_DIR, `${name}.png`);
  await browser.saveScreenshot(filePath);
  console.log(`  saved: ${filePath}`);
}

describe('Visual: Popup Earnings Panel', () => {
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
        await clearAll();
        if (count > 0) await seed(count);
        await mockAuthState();
        await resizeWindow(700);
        await browser.url(POPUP_URL);
        await browser.pause(300);
        await gotoEarnings();
      });

      it(`screenshots earnings-popup-n${count}-light`, async () => {
        await setTheme('light');
        await browser.pause(150);
        await screenshot(`earnings-popup-n${count}-light`);
      });

      it(`screenshots earnings-popup-n${count}-dark`, async () => {
        await setTheme('dark');
        await browser.pause(150);
        await screenshot(`earnings-popup-n${count}-dark`);
      });
    });
  }

  // Expanded full-height capture so every widget below the 420px scroll fold is reviewable.
  describe('expanded full panel', () => {
    before(async () => {
      await clearAll();
      await seed(300);
      await mockAuthState();
      await resizeWindow(1700);
      await browser.url(POPUP_URL);
      await browser.pause(300);
      await gotoEarnings();
      await expandPanel();
    });

    it('screenshots earnings-popup-full-light', async () => {
      await setTheme('light');
      await browser.pause(150);
      await screenshot('earnings-popup-full-light');
    });

    it('screenshots earnings-popup-full-dark', async () => {
      await setTheme('dark');
      await browser.pause(150);
      await screenshot('earnings-popup-full-dark');
    });
  });
});
