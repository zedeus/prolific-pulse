import { navigateToPopup } from '../helpers/popup-dom.js';

const SEED_RESEARCHERS = [
  { id: 'r-researcher-test-1', name: 'Oxford Behavioural Lab', country: 'GB', study_count: 5, submission_count: 2 },
  { id: 'r-researcher-test-2', name: 'Anthropic Evaluations', country: 'US', study_count: 3, submission_count: 0 },
  { id: 'r-researcher-test-3', name: 'Spammy Research Co', country: 'US', study_count: 1, submission_count: 0 },
];

function switchToSettings() {
  return browser.execute(() => {
    document.querySelector('button[data-tab="settings"]')?.click();
  });
}

function switchToLive() {
  return browser.execute(() => {
    document.querySelector('button[data-tab="live"]')?.click();
  });
}

async function reopenPopup() {
  await browser.url('about:blank');
  await browser.pause(400);
  await navigateToPopup();
  await browser.pause(800);
}

async function seedResearchersViaIndexedDB() {
  return browser.executeAsync((records, done) => {
    const req = indexedDB.open('prolific-pulse');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('researchers')) {
        db.close();
        done({ ok: false, error: 'researchers store missing' });
        return;
      }
      const tx = db.transaction('researchers', 'readwrite');
      const store = tx.objectStore('researchers');
      const now = new Date().toISOString();
      for (const r of records) {
        store.put({
          id: r.id,
          name: r.name,
          country: r.country,
          first_seen_at: now,
          last_seen_at: now,
          study_count: r.study_count,
          submission_count: r.submission_count,
        });
      }
      tx.oncomplete = () => { db.close(); done({ ok: true }); };
      tx.onerror = () => { db.close(); done({ ok: false, error: String(tx.error) }); };
    };
    req.onerror = () => done({ ok: false, error: String(req.error) });
  }, SEED_RESEARCHERS);
}

async function clearResearchersAndFilters() {
  return browser.executeAsync((done) => {
    const req = indexedDB.open('prolific-pulse');
    req.onsuccess = () => {
      const db = req.result;
      const finish = () => {
        db.close();
        const api = (typeof browser !== 'undefined' && browser.storage) ? browser.storage : chrome.storage;
        try {
          const p = api.local.remove('priorityFilters');
          if (p && typeof p.then === 'function') p.then(() => done({ ok: true }), () => done({ ok: true }));
          else done({ ok: true });
        } catch { done({ ok: true }); }
      };
      if (!db.objectStoreNames.contains('researchers')) { finish(); return; }
      const tx = db.transaction('researchers', 'readwrite');
      tx.objectStore('researchers').clear();
      tx.oncomplete = finish;
      tx.onerror = finish;
    };
    req.onerror = () => done({ ok: false });
  });
}

async function ensureFreshFilter() {
  await browser.execute(() => {
    // Clear all filters first, then add one via the UI
    const btn = document.getElementById('addFilterButton');
    if (btn) btn.click();
  });
  await browser.pause(500);
  // Expand it
  await browser.execute(() => {
    const card = document.querySelector('[data-filter-id]');
    if (card) {
      const expandBtn = card.querySelector('button[aria-label="Expand filter"]');
      if (expandBtn) expandBtn.click();
    }
  });
  await browser.pause(300);
}

async function openPicker(kind) {
  // kind = 'prioritize' | 'blacklist'. Prioritize is first, blacklist is second
  return browser.execute((kind) => {
    const cards = document.querySelectorAll('[data-filter-id]');
    if (!cards.length) return false;
    const pickers = cards[0].querySelectorAll('.researcher-picker');
    // First picker = prioritize, second = blacklist
    const idx = kind === 'prioritize' ? 0 : 1;
    const picker = pickers[idx];
    if (!picker) return false;
    const addBtn = picker.querySelector('.picker-add-btn');
    if (!addBtn) return false;
    addBtn.click();
    return true;
  }, kind);
}

async function getFirstSuggestionText() {
  return browser.execute(() => {
    const popover = document.querySelector('.picker-popover');
    if (!popover) return null;
    const row = popover.querySelector('.suggestion-row');
    if (!row) return null;
    return row.textContent?.trim() || '';
  });
}

async function clickFirstSuggestion() {
  return browser.execute(() => {
    const popover = document.querySelector('.picker-popover');
    if (!popover) return false;
    const row = popover.querySelector('.suggestion-row');
    if (!row) return false;
    row.click();
    return true;
  });
}

async function typeIntoPickerSearch(text) {
  return browser.execute((text) => {
    const popover = document.querySelector('.picker-popover');
    if (!popover) return false;
    const input = popover.querySelector('input[type="text"]');
    if (!input) return false;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, text);
}

async function getSelectedChipLabels(kind) {
  return browser.execute((kind) => {
    const cards = document.querySelectorAll('[data-filter-id]');
    if (!cards.length) return [];
    const pickers = cards[0].querySelectorAll('.researcher-picker');
    const idx = kind === 'prioritize' ? 0 : 1;
    const picker = pickers[idx];
    if (!picker) return [];
    return [...picker.querySelectorAll('.chip')].map((c) =>
      c.querySelector('span')?.textContent?.trim() || ''
    );
  }, kind);
}

async function getStoredFilters() {
  return browser.executeAsync((done) => {
    const api = (typeof browser !== 'undefined' && browser.storage) ? browser.storage : chrome.storage;
    const result = api.local.get('priorityFilters');
    if (result && typeof result.then === 'function') {
      result.then((data) => done(data.priorityFilters || []), () => done([]));
    } else {
      api.local.get('priorityFilters', (data) => done(data.priorityFilters || []));
    }
  });
}

describe('Researcher lists (issue #12)', () => {
  before(async () => {
    await navigateToPopup();
    await browser.pause(500);
    await clearResearchersAndFilters();
    const seed = await seedResearchersViaIndexedDB();
    expect(seed.ok).toBe(true);
    // Force popup to reload with seeded data
    await reopenPopup();
  });

  it('researchers table exists in IndexedDB (schema v2)', async () => {
    const result = await browser.execute(async () => {
      const req = indexedDB.open('prolific-pulse');
      const db = await new Promise((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const names = [...db.objectStoreNames];
      const version = db.version;
      db.close();
      return { names, version };
    });
    expect(result.names).toContain('researchers');
    expect(result.version).toBeGreaterThanOrEqual(2);
  });

  it('seeded researchers appear in Settings picker dropdown', async () => {
    await switchToSettings();
    await browser.pause(300);
    await ensureFreshFilter();

    const opened = await openPicker('prioritize');
    expect(opened).toBe(true);
    await browser.pause(250);

    const first = await getFirstSuggestionText();
    expect(first).toBeTruthy();
    // One of our seeded labs should show in the dropdown
    const names = await browser.execute(() => {
      const rows = document.querySelectorAll('.picker-popover .suggestion-row');
      return [...rows].map((r) => r.textContent?.trim() || '');
    });
    const hasAny = names.some((txt) =>
      /Oxford Behavioural Lab|Anthropic Evaluations|Spammy Research Co/.test(txt)
    );
    expect(hasAny).toBe(true);
  });

  it('typing in search filters the dropdown', async () => {
    await typeIntoPickerSearch('anthropic');
    await browser.pause(200);
    const names = await browser.execute(() => {
      const rows = document.querySelectorAll('.picker-popover .suggestion-row');
      return [...rows].map((r) => r.textContent?.trim().toLowerCase() || '');
    });
    expect(names.length).toBeGreaterThanOrEqual(1);
    expect(names.every((n) => n.includes('anthropic'))).toBe(true);
  });

  it('adds a researcher chip to Prioritize list, persists across reopen', async () => {
    // Clear search to see all options again
    await typeIntoPickerSearch('');
    await browser.pause(150);
    // Specifically target Oxford
    await typeIntoPickerSearch('oxford');
    await browser.pause(150);
    const clicked = await clickFirstSuggestion();
    expect(clicked).toBe(true);

    // Wait for the debounced persist so both UI and storage reflect the click.
    await browser.waitUntil(
      async () => {
        const s = await getStoredFilters();
        return (s[0]?.match_researchers || []).some((r) => r.id === 'r-researcher-test-1');
      },
      { timeout: 3000, interval: 100, timeoutMsg: 'Oxford selection did not persist' },
    );
    const chips = await getSelectedChipLabels('prioritize');
    expect(chips).toContain('Oxford Behavioural Lab');
    const stored = await getStoredFilters();
    expect((stored[0].match_researchers || []).map((r) => r.id)).toContain('r-researcher-test-1');

    await reopenPopup();
    await switchToSettings();
    await browser.pause(300);
    await browser.execute(() => {
      const card = document.querySelector('[data-filter-id]');
      card?.querySelector('button[aria-label="Expand filter"]')?.click();
    });
    await browser.pause(300);

    const chipsAfter = await getSelectedChipLabels('prioritize');
    expect(chipsAfter).toContain('Oxford Behavioural Lab');
  });

  it('adds a researcher chip to Blacklist list', async () => {
    const opened = await openPicker('blacklist');
    expect(opened).toBe(true);
    await browser.pause(200);
    await typeIntoPickerSearch('spammy');
    await browser.pause(150);
    await clickFirstSuggestion();

    await browser.waitUntil(
      async () => {
        const s = await getStoredFilters();
        return (s[0]?.ignore_researchers || []).some((r) => r.id === 'r-researcher-test-3');
      },
      { timeout: 3000, interval: 100, timeoutMsg: 'Spammy selection did not persist' },
    );
    const chips = await getSelectedChipLabels('blacklist');
    expect(chips).toContain('Spammy Research Co');
  });

  it('removes a chip by clicking it', async () => {
    // The whole chip is clickable to remove (× is decorative).
    const removed = await browser.execute(() => {
      const cards = document.querySelectorAll('[data-filter-id]');
      if (!cards.length) return false;
      const picker = cards[0].querySelectorAll('.researcher-picker')[1];
      const chip = picker?.querySelector('.chip');
      if (!chip) return false;
      chip.click();
      return true;
    });
    expect(removed).toBe(true);

    await browser.waitUntil(
      async () => {
        const s = await getStoredFilters();
        return !(s[0]?.ignore_researchers || []).some((r) => r.id === 'r-researcher-test-3');
      },
      { timeout: 3000, interval: 100, timeoutMsg: 'Spammy removal did not persist' },
    );
    const chips = await getSelectedChipLabels('blacklist');
    expect(chips).not.toContain('Spammy Research Co');
  });

  it('filter badges reflect researcher count when collapsed', async () => {
    // Collapse the filter by clicking the expand arrow again
    await browser.execute(() => {
      const card = document.querySelector('[data-filter-id]');
      card?.querySelector('button[aria-label="Collapse filter"]')?.click();
    });
    await browser.pause(300);
    const badges = await browser.execute(() => {
      const card = document.querySelector('[data-filter-id]');
      return [...card.querySelectorAll('span')]
        .map((s) => s.textContent?.trim() || '')
        .filter((t) => /^\d+\s*r$/.test(t));
    });
    expect(badges.length).toBeGreaterThan(0);
  });

  it('context menu ⋯ button exists on live study cards (when studies are present)', async () => {
    await switchToLive();
    await browser.pause(500);
    const info = await browser.execute(() => {
      const cards = document.querySelectorAll('.event.live');
      if (!cards.length) return { hasCards: false };
      const firstCard = cards[0];
      const menuBtn = firstCard.querySelector('.menu-trigger');
      return { hasCards: true, hasMenuBtn: !!menuBtn };
    });
    if (!info.hasCards) {
      console.log('    (no live studies available — skipping menu button check)');
      return;
    }
    expect(info.hasMenuBtn).toBe(true);
  });

  it('context menu opens and lists filter options when clicked', async () => {
    const opened = await browser.execute(() => {
      const cards = document.querySelectorAll('.event.live');
      if (!cards.length) return { skipped: true };
      const btn = cards[0].querySelector('.menu-trigger');
      if (!btn) return { skipped: true };
      btn.click();
      return { skipped: false };
    });
    if (opened.skipped) {
      console.log('    (no live studies — skipped)');
      return;
    }
    await browser.pause(250);
    const menu = await browser.execute(() => {
      const panel = document.querySelector('.menu-panel');
      if (!panel) return null;
      return {
        visible: true,
        items: [...panel.querySelectorAll('.menu-item')].map((b) => b.textContent?.trim() || ''),
      };
    });
    expect(menu).not.toBeNull();
    expect(menu.visible).toBe(true);
    const joined = menu.items.join(' | ').toLowerCase();
    expect(joined).toMatch(/prioritize researcher/);
    expect(joined).toMatch(/blacklist researcher/);
    expect(joined).toMatch(/copy study link/);
    expect(joined).toMatch(/send to telegram/);
  });

  it('context menu positions correctly relative to the trigger (not another card)', async () => {
    // Close any open menu cleanly so Svelte state is synced. The component's
    // outside-click listener fires on mousedown (not click), so we must
    // dispatch a mousedown event rather than calling .click().
    await browser.execute(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await browser.pause(200);

    const info = await browser.execute(() => {
      const cards = document.querySelectorAll('.event.live');
      if (cards.length < 1) return { skipped: true };
      const btn = cards[0].querySelector('.menu-trigger');
      if (!btn) return { skipped: true };
      const btnRect = btn.getBoundingClientRect();
      btn.click();
      return { skipped: false, btnRect: { top: btnRect.top, bottom: btnRect.bottom, left: btnRect.left, right: btnRect.right } };
    });
    if (info.skipped) {
      console.log('    (no live studies — skipped)');
      return;
    }
    await browser.pause(150);

    const positioning = await browser.execute(() => {
      const menu = document.querySelector('.menu-panel');
      if (!menu) return null;
      const r = menu.getBoundingClientRect();
      return {
        top: r.top, bottom: r.bottom, left: r.left, right: r.right,
        parentTag: menu.parentElement?.tagName ?? '',
        viewportWidth: window.innerWidth,
      };
    });
    expect(positioning).not.toBeNull();
    // Portal should have moved the menu under <body>.
    expect(positioning.parentTag).toBe('BODY');
    // Menu top should be within a few px of the trigger's bottom (or above if flipped).
    const expectedTopDown = info.btnRect.bottom + 4;
    const flippedCheck =
      Math.abs(positioning.top - expectedTopDown) <= 6 ||
      Math.abs(positioning.bottom - (info.btnRect.top - 4)) <= 6;
    expect(flippedCheck).toBe(true);
    // Menu right edge should be at or before the viewport right, and aligned
    // with the trigger's right edge (within the clamp margin).
    expect(positioning.right).toBeLessThanOrEqual(positioning.viewportWidth);
    expect(Math.abs(positioning.right - info.btnRect.right)).toBeLessThan(16);
  });

  it('menu position is unaffected by an ancestor card transform (hover regression)', async () => {
    // Close any open menu from the previous test via mousedown (matches the
    // component's outside-click listener).
    await browser.execute(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await browser.pause(200);

    const info = await browser.execute(() => {
      const cards = document.querySelectorAll('.event.live');
      if (cards.length < 2) return { skipped: true, reason: 'need at least 2 live cards' };
      // Apply the hover transform to the SECOND card explicitly (matches what
      // `.event-link:hover .event { transform: translateY(-1px) }` does). If
      // position:fixed is buggy (respects ancestor transform), opening the
      // menu on the FIRST card would snap to the second card's box.
      const secondCard = cards[1];
      secondCard.style.transform = 'translateY(-1px)';

      const firstBtn = cards[0].querySelector('.menu-trigger');
      if (!firstBtn) return { skipped: true, reason: 'no trigger' };
      const btnRect = firstBtn.getBoundingClientRect();
      firstBtn.click();
      return {
        skipped: false,
        btnRect: { top: btnRect.top, bottom: btnRect.bottom, left: btnRect.left, right: btnRect.right },
      };
    });
    if (info.skipped) {
      console.log(`    (skipped: ${info.reason})`);
      return;
    }
    await browser.pause(150);

    const pos = await browser.execute(() => {
      const menu = document.querySelector('.menu-panel');
      if (!menu) return null;
      const r = menu.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, right: r.right };
    });
    // Cleanup forced transform
    await browser.execute(() => {
      document.querySelectorAll('.event.live').forEach((c) => { c.style.transform = ''; });
    });

    expect(pos).not.toBeNull();
    // Menu must still anchor to the FIRST card's trigger — not drift to the
    // transformed second card.
    const anchoredBelow = Math.abs(pos.top - (info.btnRect.bottom + 4)) <= 6;
    const anchoredAbove = Math.abs(pos.bottom - (info.btnRect.top - 4)) <= 6;
    expect(anchoredBelow || anchoredAbove).toBe(true);
  });

  it('tolerates corrupted priorityFilters storage (mixed garbage)', async () => {
    // Seed storage with an array containing malformed entries + one old-
    // schema filter. The popup should recover and render normally.
    await browser.executeAsync((done) => {
      const api = (typeof browser !== 'undefined' && browser.storage) ? browser.storage : chrome.storage;
      const garbage = [
        null,
        'not an object',
        42,
        { id: 'legacy', name: 'Legacy', enabled: true,
          always_open_keywords: ['foo'],
          always_open_researchers: [{ id: 'r-legacy', name: 'Legacy Lab' }],
          ignore_keywords: 'not an array',
        },
        { not: 'a filter' },
      ];
      const result = api.local.set({ priorityFilters: garbage });
      if (result && typeof result.then === 'function') result.then(() => done(null), () => done(null));
      else done(null);
    });
    await reopenPopup();
    await switchToSettings();
    await browser.pause(400);

    // At minimum the settings panel loads and doesn't throw.
    const panelActive = await browser.execute(() => {
      return document.getElementById('panelSettings')?.classList.contains('active') ?? false;
    });
    expect(panelActive).toBe(true);

    // Even with corrupt storage, the popup must render without throwing.
    // Expand the first valid filter and verify the picker is visible.
    await browser.execute(() => {
      document.querySelector('[data-filter-id] button[aria-label="Expand filter"]')?.click();
    });
    await browser.pause(400);
    const pickerOk = await browser.execute(() => !!document.querySelector('.researcher-picker'));
    if (!pickerOk) {
      const dom = await browser.execute(() => ({
        panelActive: document.getElementById('panelSettings')?.classList.contains('active'),
        filterCount: document.querySelectorAll('[data-filter-id]').length,
        expandedCount: document.querySelectorAll('.filter-card .researcher-picker').length,
        firstFilterHTML: document.querySelector('[data-filter-id]')?.outerHTML?.slice(0, 400) ?? null,
      }));
      console.log('    DEBUG corrupted-storage state:', JSON.stringify(dom));
    }
    expect(pickerOk).toBe(true);
  });

  it('picker cap: adding > MAX researchers stops at the cap', async () => {
    // Seed >MAX researchers into IndexedDB and verify we can only add up to the cap.
    await clearResearchersAndFilters();
    const MAX = 50;
    const seedResult = await browser.executeAsync((max, done) => {
      const req = indexedDB.open('prolific-pulse');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('researchers', 'readwrite');
        const store = tx.objectStore('researchers');
        const now = new Date().toISOString();
        for (let i = 0; i < max + 5; i++) {
          store.put({
            id: `r-bulk-${i}`,
            name: `Researcher ${i}`, country: 'GB',
            first_seen_at: now, last_seen_at: now,
            study_count: 0, submission_count: 0,
          });
        }
        tx.oncomplete = () => { db.close(); done({ ok: true }); };
      };
      req.onerror = () => done({ ok: false });
    }, MAX);
    expect(seedResult.ok).toBe(true);

    await reopenPopup();
    await switchToSettings();
    await browser.pause(300);
    await ensureFreshFilter();

    // Directly write >MAX researchers into the filter via storage, then reopen
    // and check the normalizer capped it. Simpler than clicking 51 times.
    const storedBefore = await getStoredFilters();
    expect(storedBefore.length).toBeGreaterThan(0);
    const filterId = storedBefore[0].id;

    await browser.executeAsync((filterId, max, done) => {
      const api = (typeof browser !== 'undefined' && browser.storage) ? browser.storage : chrome.storage;
      const getResult = api.local.get('priorityFilters');
      const handle = (data) => {
        const filters = data.priorityFilters || [];
        const target = filters.find((f) => f.id === filterId);
        if (target) {
          target.match_researchers = [];
          for (let i = 0; i < max + 10; i++) {
            target.match_researchers.push({ id: `r-bulk-${i}`, name: `Researcher ${i}` });
          }
        }
        const set = api.local.set({ priorityFilters: filters });
        if (set && typeof set.then === 'function') set.then(() => done(null), () => done(null));
        else done(null);
      };
      if (getResult && typeof getResult.then === 'function') getResult.then(handle);
      else api.local.get('priorityFilters', handle);
    }, filterId, MAX);

    // Round-trip through the background's setPriorityFilters message —
    // that's the path that normalizes (cap applied there).
    await browser.executeAsync((done) => {
      const api = (typeof browser !== 'undefined' && browser.storage) ? browser.storage : chrome.storage;
      const getResult = api.local.get('priorityFilters');
      const handle = (data) => {
        const filters = data.priorityFilters || [];
        const runtime = (typeof browser !== 'undefined' && browser.runtime) ? browser.runtime : chrome.runtime;
        const send = runtime.sendMessage({ action: 'setPriorityFilters', filters });
        if (send && typeof send.then === 'function') send.then(() => done({ ok: true }), () => done({ ok: false }));
        else done({ ok: true });
      };
      if (getResult && typeof getResult.then === 'function') getResult.then(handle);
      else api.local.get('priorityFilters', handle);
    });
    await browser.pause(300);

    const storedAfter = await getStoredFilters();
    const target = storedAfter.find((f) => f && f.id === filterId);
    expect(target).toBeTruthy();
    expect(target.match_researchers.length).toBeLessThanOrEqual(MAX);
  });

  after(async () => {
    await clearResearchersAndFilters();
  });
});
