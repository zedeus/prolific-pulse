// Visual audit for issue #18: researcher reliability profiles.
// Seeds submissions + studies (studies also seed the researchers table + availability events),
// then screenshots: the live panel (clickable researcher names), the researcher profile card,
// and the Settings researcher picker (reliability badges + pay sparklines).
// Screenshots land in screenshots/visual/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POPUP_URL } from '../helpers/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'screenshots', 'visual');

async function setTheme(theme) {
  await browser.execute((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

async function seedAll(subCount, studyCount) {
  await browser.executeAsync((subs, studies, done) => {
    const run = async () => {
      if (!window.__ppDev) { done({ error: 'no __ppDev' }); return; }
      await window.__ppDev.seed(subs);
      const n = await window.__ppDev.seedStudies(studies);
      done({ studies: n });
    };
    run().catch((e) => done({ error: String(e) }));
  }, subCount, studyCount);
}

async function clearAll() {
  await browser.executeAsync((done) => {
    if (!window.__ppDev) { done(); return; }
    Promise.allSettled([window.__ppDev.clear(), window.__ppDev.clearStudies()]).then(() => done());
  });
}

async function navigateTo(tab) {
  await browser.execute((t) => {
    document.querySelector(`button[data-tab="${t}"]`)?.click();
  }, tab);
  await browser.pause(150);
}

async function resizeWindow() {
  try { await browser.setWindowRect(0, 0, 640, 820); }
  catch { try { await browser.setWindowSize(640, 820); } catch { /* ignore */ } }
}

async function screenshot(name) {
  const filePath = path.join(OUT_DIR, `${name}.png`);
  await browser.saveScreenshot(filePath);
  console.log(`  saved: ${filePath}`);
}

// Click through live cards until a profile card with a numeric reliability score opens,
// so the screenshot shows a data-rich profile (not "not enough history").
async function openRichProfileCard() {
  const count = await browser.execute(() => document.querySelectorAll('.event.live .researcher-link').length);
  for (let i = 0; i < Math.min(count, 8); i++) {
    const opened = await browser.execute((idx) => {
      const links = document.querySelectorAll('.event.live .researcher-link');
      if (!links[idx]) return false;
      links[idx].click();
      return true;
    }, i);
    if (!opened) continue;
    await browser.pause(250);
    const hasScore = await browser.execute(() => {
      const card = document.querySelector('.researcher-profile-card');
      if (!card) return false;
      return /\b\d{1,3}\b/.test(card.querySelector('.text-2xl')?.textContent || '');
    });
    if (hasScore) return true;
    // close and try the next
    await browser.execute(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await browser.pause(150);
  }
  return browser.execute(() => !!document.querySelector('.researcher-profile-card'));
}

describe('Visual: Researcher profiles (issue #18)', () => {
  before(async () => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    await browser.url(POPUP_URL);
    await browser.waitUntil(
      async () => browser.execute(() => typeof window.__ppDev?.seedStudies === 'function'),
      { timeout: 10_000, timeoutMsg: '__ppDev.seedStudies not available' },
    );
    await resizeWindow();
    await clearAll();
    await seedAll(400, 30);
    await browser.url(POPUP_URL);
    await browser.pause(400);
  });

  it('live panel with clickable researcher names', async () => {
    await navigateTo('live');
    await setTheme('light');
    await browser.pause(150);
    await screenshot('researcher-live-light');
  });

  it('researcher profile card (light)', async () => {
    await navigateTo('live');
    await setTheme('light');
    const ok = await openRichProfileCard();
    expect(ok).toBe(true);
    await browser.pause(200);
    await screenshot('researcher-profile-light');
  });

  it('researcher profile card (dark)', async () => {
    await setTheme('dark');
    await browser.pause(200);
    await screenshot('researcher-profile-dark');
    // close it
    await browser.execute(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await browser.pause(150);
  });

  it('settings researcher picker with reliability badges + sparklines', async () => {
    await setTheme('light');
    await navigateTo('settings');
    await browser.pause(200);
    // Add a filter and expand it.
    await browser.execute(() => document.getElementById('addFilterButton')?.click());
    await browser.pause(500);
    await browser.execute(() => {
      const card = document.querySelector('[data-filter-id]');
      card?.querySelector('button[aria-label="Expand filter"]')?.click();
    });
    await browser.pause(300);
    // Open the prioritize picker popover.
    await browser.execute(() => {
      const picker = document.querySelector('[data-filter-id] .researcher-picker');
      picker?.querySelector('.picker-add-btn')?.click();
    });
    await browser.pause(400);
    await screenshot('researcher-picker-light');

    await setTheme('dark');
    await browser.pause(200);
    await screenshot('researcher-picker-dark');
  });

  after(async () => {
    await clearAll();
  });
});
