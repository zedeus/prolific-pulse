import { navigateToPopup } from '../helpers/popup-dom.js';

function switchToSettings() {
  return browser.execute(() => {
    document.querySelector('button[data-tab="settings"]')?.click();
  });
}

async function getToggleState(id) {
  return browser.execute((id) => {
    const el = document.getElementById(id);
    return el ? el.checked : null;
  }, id);
}

async function clickToggle(id) {
  return browser.execute((id) => {
    const el = document.getElementById(id);
    if (el) { el.click(); }
  }, id);
}

async function getInputValue(id) {
  return browser.execute((id) => {
    const el = document.getElementById(id);
    return el ? el.value : null;
  }, id);
}

async function setInputValue(id, value) {
  return browser.execute((id, value) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, id, String(value));
}

async function setRangeValue(id, value) {
  return browser.execute((id, value) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, id, String(value));
}

async function getLabelText(id) {
  return browser.execute((id) => {
    const el = document.getElementById(id);
    return el ? el.textContent : null;
  }, id);
}

async function isElementVisible(selector) {
  return browser.execute((selector) => {
    const el = document.querySelector(selector);
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }, selector);
}

async function reopenPopup() {
  await browser.url('about:blank');
  await browser.pause(500);
  await navigateToPopup();
  await browser.pause(1000);
  await switchToSettings();
  await browser.pause(300);
}

async function expandFirstFilter() {
  await browser.execute(() => {
    const card = document.querySelector('[data-filter-id]');
    if (card) {
      const btn = card.querySelector('button[aria-label="Expand filter"]');
      if (btn) btn.click();
    }
  });
  await browser.pause(300);
}

/** Ensure at least one priority filter exists, expanding it if needed. */
async function ensureFilterExists() {
  const hasFilter = await browser.execute(() => {
    return document.querySelectorAll('[data-filter-id]').length > 0;
  });
  if (!hasFilter) {
    // Click "+ Add" to create a filter
    await browser.execute(() => {
      const btn = document.getElementById('addFilterButton');
      if (btn) btn.click();
    });
    await browser.pause(500);
  }
  // Expand first filter if collapsed
  const isExpanded = await browser.execute(() => {
    const toggle = document.getElementById('priorityFilterEnabledToggle-0');
    return !!toggle;
  });
  if (!isExpanded) {
    // Click the expand arrow of the first filter
    await expandFirstFilter();
  }
}

describe('Settings', () => {
  // ── Auto-open toggle ──────────────────────────────────────────

  it('should toggle auto-open off and persist', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    const initialState = await getToggleState('autoOpenToggle');
    expect(initialState).toBe(true);

    await clickToggle('autoOpenToggle');
    await browser.pause(1000);

    const afterToggle = await getToggleState('autoOpenToggle');
    expect(afterToggle).toBe(false);

    // Reopen popup — should persist
    await reopenPopup();
    const persisted = await getToggleState('autoOpenToggle');
    expect(persisted).toBe(false);

    // Restore
    await clickToggle('autoOpenToggle');
    await browser.pause(500);
  });

  // ── Priority filter add/enable/delete ─────────────────────────

  it('should add a priority filter and enable it', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    await ensureFilterExists();

    const toggleState = await getToggleState('priorityFilterEnabledToggle-0');
    if (!toggleState) {
      await clickToggle('priorityFilterEnabledToggle-0');
      await browser.pause(1000);
    }

    const enabled = await getToggleState('priorityFilterEnabledToggle-0');
    expect(enabled).toBe(true);
  });

  it('should persist priority filter toggle across popup reopen', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    await ensureFilterExists();

    // Enable
    const initialState = await getToggleState('priorityFilterEnabledToggle-0');
    if (!initialState) {
      await clickToggle('priorityFilterEnabledToggle-0');
      await browser.pause(1000);
    }
    const enabled = await getToggleState('priorityFilterEnabledToggle-0');
    expect(enabled).toBe(true);

    // Reopen
    await reopenPopup();

    // Expand filter
    await expandFirstFilter();

    const persisted = await getToggleState('priorityFilterEnabledToggle-0');
    expect(persisted).toBe(true);
  });

  // ── Priority filter number inputs ─────────────────────────────

  it('should change min reward and persist', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    await ensureFilterExists();

    await setInputValue('priorityMinRewardInput-0', '3.5');
    await browser.pause(1500); // Wait for debounced persist

    const value = await getInputValue('priorityMinRewardInput-0');
    expect(parseFloat(value)).toBeCloseTo(3.5, 1);

    await reopenPopup();

    // Expand filter
    await expandFirstFilter();

    const persisted = await getInputValue('priorityMinRewardInput-0');
    expect(parseFloat(persisted)).toBeCloseTo(3.5, 1);
  });

  it('should change min hourly reward and persist', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    await ensureFilterExists();

    await setInputValue('priorityMinHourlyInput-0', '8');
    await browser.pause(1500);

    const value = await getInputValue('priorityMinHourlyInput-0');
    expect(parseFloat(value)).toBe(8);

    await reopenPopup();

    await expandFirstFilter();

    const persisted = await getInputValue('priorityMinHourlyInput-0');
    expect(parseFloat(persisted)).toBe(8);
  });

  it('should change max ETA and persist', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    await ensureFilterExists();

    await setInputValue('priorityMaxEtaInput-0', '45');
    await browser.pause(1500);

    const value = await getInputValue('priorityMaxEtaInput-0');
    expect(parseInt(value)).toBe(45);

    await reopenPopup();

    await expandFirstFilter();

    const persisted = await getInputValue('priorityMaxEtaInput-0');
    expect(parseInt(persisted)).toBe(45);
  });

  it('should change min places and persist', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    await ensureFilterExists();

    await setInputValue('priorityMinPlacesInput-0', '3');
    await browser.pause(1500);

    const value = await getInputValue('priorityMinPlacesInput-0');
    expect(parseInt(value)).toBe(3);

    await reopenPopup();

    await expandFirstFilter();

    const persisted = await getInputValue('priorityMinPlacesInput-0');
    expect(parseInt(persisted)).toBe(3);
  });

  // ── Refresh rate sliders ──────────────────────────────────────

  it('should change minimum delay slider and show updated label', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    await setRangeValue('refreshMinDelayInput', '5');
    await browser.pause(300);

    const label = await getLabelText('refreshMinDelayValue');
    expect(label).toBe('5s');
  });

  it('should change average delay slider and show updated label', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    await setRangeValue('refreshAverageDelayInput', '15');
    await browser.pause(300);

    const label = await getLabelText('refreshAverageDelayValue');
    expect(label).toBe('15s');
  });

  it('should show save/revert buttons after slider change', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    // Read current value and change to something different
    const currentAvg = await getInputValue('refreshAverageDelayInput');
    const newAvg = parseInt(currentAvg) === 20 ? '40' : '20';
    await setRangeValue('refreshAverageDelayInput', newAvg);
    await browser.pause(500);

    // Save button must exist and be visible
    const saveBtn = await browser.execute(() => {
      const btn = document.getElementById('refreshCadenceSaveButton');
      if (!btn) return { exists: false };
      return { exists: true, visible: btn.offsetParent !== null, text: btn.textContent };
    });
    expect(saveBtn.exists).toBe(true);
    expect(saveBtn.visible).toBe(true);
    expect(saveBtn.text).toContain('Save');

    // Revert button must also exist
    const revertBtn = await browser.execute(() => {
      const btn = document.getElementById('refreshCadenceRevertButton');
      return btn ? { exists: true, visible: btn.offsetParent !== null } : { exists: false };
    });
    expect(revertBtn.exists).toBe(true);
    expect(revertBtn.visible).toBe(true);
  });

  it('should save refresh rate and persist across popup reopen', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    // Read current value and change to something distinctly different
    const currentAvg = await getInputValue('refreshAverageDelayInput');
    const targetAvg = parseInt(currentAvg) === 25 ? 35 : 25;
    await setRangeValue('refreshAverageDelayInput', String(targetAvg));
    await browser.pause(500);

    // Verify the label updated
    const labelBefore = await getLabelText('refreshAverageDelayValue');
    expect(labelBefore).toBe(targetAvg + 's');

    // The save button MUST be visible
    const debug = await browser.execute(() => {
      const saveBtn = document.getElementById('refreshCadenceSaveButton');
      return {
        saveBtnExists: !!saveBtn,
        saveBtnVisible: saveBtn ? saveBtn.offsetParent !== null : false,
      };
    });
    expect(debug.saveBtnVisible).toBe(true);

    // Click save
    const saveBtn = await $('#refreshCadenceSaveButton');
    if (await saveBtn.isDisplayed()) {
      await saveBtn.click();
    }
    await browser.pause(3000);

    // After save, buttons should disappear
    const afterSave = await browser.execute(() => {
      const btn = document.getElementById('refreshCadenceSaveButton');
      return { btnVisible: btn ? btn.offsetParent !== null : false };
    });
    expect(afterSave.btnVisible).toBe(false);

    // Reopen popup and verify persistence
    await reopenPopup();
    await browser.pause(2000);

    const sliderVal = await getInputValue('refreshAverageDelayInput');
    const labelVal = await getLabelText('refreshAverageDelayValue');

    expect(parseInt(sliderVal)).toBe(targetAvg);
    expect(labelVal).toBe(targetAvg + 's');
  });

  it('should revert refresh rate changes', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    // Read current average delay
    const originalVal = await getInputValue('refreshAverageDelayInput');

    // Change it
    const newVal = parseInt(originalVal) === 15 ? '20' : '15';
    await setRangeValue('refreshAverageDelayInput', newVal);
    await browser.pause(500);

    // Click revert
    const revertBtn = await $('#refreshCadenceRevertButton');
    await revertBtn.click();
    await browser.pause(500);

    // Value should be back to original
    const afterRevert = await getInputValue('refreshAverageDelayInput');
    expect(afterRevert).toBe(originalVal);

    // Buttons should be gone
    const saveGone = await browser.execute(() => {
      const btn = document.getElementById('refreshCadenceSaveButton');
      return !btn || btn.offsetParent === null;
    });
    expect(saveGone).toBe(true);
  });

  // ── Alert sound select ────────────────────────────────────────

  it('should change alert sound type and persist', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    await ensureFilterExists();

    // Ensure filter is enabled
    const pfEnabled = await getToggleState('priorityFilterEnabledToggle-0');
    if (!pfEnabled) {
      await clickToggle('priorityFilterEnabledToggle-0');
      await browser.pause(1000);
    }

    // Change sound to 'chime'
    await browser.execute(() => {
      const select = document.getElementById('priorityAlertSoundTypeSelect-0');
      if (select) {
        (select as HTMLSelectElement).value = 'chime';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await browser.pause(1500);

    const value = await getInputValue('priorityAlertSoundTypeSelect-0');
    expect(value).toBe('chime');

    await reopenPopup();

    await expandFirstFilter();

    const persisted = await getInputValue('priorityAlertSoundTypeSelect-0');
    expect(persisted).toBe('chime');
  });

  // ── Reset all test values to defaults ─────────────────────────

  it('should restore default values', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    await ensureFilterExists();

    // Reset priority filter values to defaults
    await setInputValue('priorityMinRewardInput-0', '0');
    await setInputValue('priorityMinHourlyInput-0', '0');
    await setInputValue('priorityMaxEtaInput-0', '240');
    await setInputValue('priorityMinPlacesInput-0', '1');
    await browser.pause(1500);

    const minReward = await getInputValue('priorityMinRewardInput-0');
    expect(parseFloat(minReward)).toBe(0);
  });
});
