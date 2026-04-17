// Visual audit: seed IndexedDB with fake data, screenshot the earnings page,
// report render + interaction timings. Screenshots land in screenshots/visual/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POPUP_URL } from '../helpers/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'screenshots', 'visual');
const APP_URL = POPUP_URL.replace('/popup.html', '/app.html');
const SCALES = [10, 100, 1000, 10000];
const RANGES = ['7d', '30d', '90d', 'all'];

async function setTheme(theme) {
  await browser.execute((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

async function seedAndWait(count) {
  const t0 = Date.now();
  const seeded = await browser.executeAsync((n, done) => {
    const run = async () => {
      if (!window.__ppDev) { done({ error: 'no __ppDev' }); return; }
      const seededCount = await window.__ppDev.seed(n);
      done({ count: seededCount });
    };
    run().catch((e) => done({ error: String(e) }));
  }, count);
  const ms = Date.now() - t0;
  console.log(`  seeded ${seeded.count} records in ${ms}ms`);
  return ms;
}

async function waitForChartsRendered() {
  await browser.waitUntil(
    async () => browser.execute(() => document.querySelectorAll('svg path').length > 0),
    { timeout: 10_000, timeoutMsg: 'charts did not render' },
  );
  await browser.pause(500); // let LayerChart animations settle
}

async function measureLayoutTiming() {
  return browser.execute(() => {
    const perf = performance.getEntriesByType('navigation')[0] || {};
    return {
      dom_content_loaded_ms: perf.domContentLoadedEventEnd || 0,
      load_ms: perf.loadEventEnd || 0,
      svg_paths: document.querySelectorAll('svg path').length,
      svg_rects: document.querySelectorAll('svg rect').length,
      svg_circles: document.querySelectorAll('svg circle').length,
      total_elements: document.querySelectorAll('*').length,
    };
  });
}

// Click a button by its visible text and return ms elapsed until layout settles.
async function clickAndMeasure(label) {
  return browser.execute((text) => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === text);
    if (!btn) return null;
    const t0 = performance.now();
    btn.click();
    void document.body.offsetHeight; // force a layout flush
    return Math.round(performance.now() - t0);
  }, label);
}

async function resizeWindow() {
  try {
    await browser.setWindowRect(0, 0, 1440, 3400);
  } catch {
    try { await browser.setWindowSize(1440, 3400); } catch { /* ignore */ }
  }
}

const RANGE_BUTTON_LABEL = { '7d': '7d', '30d': '30d', '90d': '90d', all: 'All' };
async function pickRange(range) {
  await clickAndMeasure(RANGE_BUTTON_LABEL[range]);
  await browser.pause(500);
}

describe('Earnings visual audit', () => {
  before(() => {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const n of SCALES) {
    it(`renders at ${n} submissions`, async () => {
      await resizeWindow();
      await browser.url(APP_URL);
      await browser.pause(400);
      const seedMs = await seedAndWait(n);

      await resizeWindow();
      await browser.url(APP_URL);
      await waitForChartsRendered();
      await browser.pause(600);

      await setTheme('dark');
      await browser.pause(300);
      await browser.saveScreenshot(path.join(OUT_DIR, `n${n}-dark.png`));

      await setTheme('light');
      await browser.pause(300);
      await browser.saveScreenshot(path.join(OUT_DIR, `n${n}-light.png`));

      const t = await measureLayoutTiming();
      console.log(`  n=${n}: seed=${seedMs}ms, DOMContentLoaded=${Math.round(t.dom_content_loaded_ms)}ms, load=${Math.round(t.load_ms)}ms, svg_paths=${t.svg_paths}, rects=${t.svg_rects}, circles=${t.svg_circles}, dom=${t.total_elements}`);
      const toggle = await clickAndMeasure('Median $/hr');
      const r30 = await clickAndMeasure('30d');
      const r90 = await clickAndMeasure('90d');
      const rAll = await clickAndMeasure('All');
      console.log(`  n=${n} interactions: metric-toggle=${toggle}ms, range-30d=${r30}ms, range-90d=${r90}ms, range-all=${rAll}ms`);
    });
  }

  for (const range of RANGES) {
    it(`renders ${range} range at 10000 submissions`, async () => {
      await resizeWindow();
      await browser.url(APP_URL);
      await browser.pause(400);
      await seedAndWait(10000);

      await resizeWindow();
      await browser.url(APP_URL);
      await waitForChartsRendered();
      await browser.pause(400);

      await setTheme('dark');
      await pickRange(range);
      await browser.pause(500);
      await browser.saveScreenshot(path.join(OUT_DIR, `range-${range}-dark.png`));
      console.log(`  range=${range} → range-${range}-dark.png`);
    });
  }
});
