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

  // ── Priority filter toggle ────────────────────────────────────

  it('should enable priority filter toggle', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    const initialState = await getToggleState('priorityFilterEnabledToggle');

    await clickToggle('priorityFilterEnabledToggle');
    await browser.pause(1000);

    const afterToggle = await getToggleState('priorityFilterEnabledToggle');
    expect(afterToggle).toBe(!initialState);
  });

  it('should persist priority filter toggle across popup reopen', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    // Enable
    const initialState = await getToggleState('priorityFilterEnabledToggle');
    if (!initialState) {
      await clickToggle('priorityFilterEnabledToggle');
      await browser.pause(1000);
    }
    const enabled = await getToggleState('priorityFilterEnabledToggle');
    expect(enabled).toBe(true);

    // Reopen
    await reopenPopup();
    const persisted = await getToggleState('priorityFilterEnabledToggle');
    expect(persisted).toBe(true);
  });

  // ── Priority filter number inputs ─────────────────────────────

  it('should change min reward and persist', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    await setInputValue('priorityMinRewardInput', '3.5');
    await browser.pause(1500); // Wait for debounced persist

    const value = await getInputValue('priorityMinRewardInput');
    expect(parseFloat(value)).toBeCloseTo(3.5, 1);

    await reopenPopup();
    const persisted = await getInputValue('priorityMinRewardInput');
    expect(parseFloat(persisted)).toBeCloseTo(3.5, 1);
  });

  it('should change min hourly reward and persist', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    await setInputValue('priorityMinHourlyInput', '8');
    await browser.pause(1500);

    const value = await getInputValue('priorityMinHourlyInput');
    expect(parseFloat(value)).toBe(8);

    await reopenPopup();
    const persisted = await getInputValue('priorityMinHourlyInput');
    expect(parseFloat(persisted)).toBe(8);
  });

  it('should change max ETA and persist', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    await setInputValue('priorityMaxEtaInput', '45');
    await browser.pause(1500);

    const value = await getInputValue('priorityMaxEtaInput');
    expect(parseInt(value)).toBe(45);

    await reopenPopup();
    const persisted = await getInputValue('priorityMaxEtaInput');
    expect(parseInt(persisted)).toBe(45);
  });

  it('should change min places and persist', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    await setInputValue('priorityMinPlacesInput', '3');
    await browser.pause(1500);

    const value = await getInputValue('priorityMinPlacesInput');
    expect(parseInt(value)).toBe(3);

    await reopenPopup();
    const persisted = await getInputValue('priorityMinPlacesInput');
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

    // Debug: check state
    const debug = await browser.execute(() => {
      const saveBtn = document.getElementById('refreshCadenceSaveButton');
      const revertBtn = document.getElementById('refreshCadenceRevertButton');
      const avgInput = document.getElementById('refreshAverageDelayInput');
      const avgLabel = document.getElementById('refreshAverageDelayValue');
      return {
        saveBtnExists: !!saveBtn,
        saveBtnVisible: saveBtn ? saveBtn.offsetParent !== null : false,
        saveBtnText: saveBtn ? saveBtn.textContent : null,
        revertBtnExists: !!revertBtn,
        avgInputValue: avgInput ? avgInput.value : null,
        avgLabelText: avgLabel ? avgLabel.textContent : null,
      };
    });
    console.log('DEBUG save test state:', JSON.stringify(debug));

    // The save button MUST be visible
    expect(debug.saveBtnVisible).toBe(true);

    // Debug: check button state before clicking
    const beforeClick = await browser.execute(() => {
      const container = document.getElementById('refreshCadenceActions');
      const btn = document.getElementById('refreshCadenceSaveButton');
      return {
        containerDisplay: container ? window.getComputedStyle(container).display : 'no-container',
        containerClasses: container ? container.className : '',
        btnExists: !!btn,
        btnDisplay: btn ? window.getComputedStyle(btn).display : 'no-btn',
        btnVisible: btn ? btn.offsetParent !== null : false,
      };
    });
    console.log('DEBUG before save click:', JSON.stringify(beforeClick));

    // Click save — use WebdriverIO native click instead of programmatic .click()
    const saveBtn = await $('#refreshCadenceSaveButton');
    if (await saveBtn.isDisplayed()) {
      await saveBtn.click();
    }
    await browser.pause(3000);

    // Check what the save handler sent
    const saveLog = await browser.execute(() => window.__ppSaveLog);
    const saveResult = await browser.execute(() => window.__ppSaveResult);
    console.log('DEBUG save log:', JSON.stringify(saveLog));
    console.log('DEBUG save result:', JSON.stringify(saveResult));

    // After save, buttons should disappear
    const afterSave = await browser.execute(() => {
      const container = document.getElementById('refreshCadenceActions');
      const btn = document.getElementById('refreshCadenceSaveButton');
      return {
        containerClasses: container ? container.className : '',
        containerDisplay: container ? window.getComputedStyle(container).display : '',
        btnVisible: btn ? btn.offsetParent !== null : false,
      };
    });
    console.log('DEBUG after save click:', JSON.stringify(afterSave));
    const saveGoneAfterSave = !afterSave.btnVisible;
    expect(saveGoneAfterSave).toBe(true);

    // Reopen popup and verify persistence
    await reopenPopup();

    // Wait for settings to load
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

    // Click revert — use WebdriverIO native click
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

  // ── Alert sound toggle ────────────────────────────────────────

  it('should toggle alert sound and persist', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    // Ensure priority filter is enabled first
    const pfEnabled = await getToggleState('priorityFilterEnabledToggle');
    if (!pfEnabled) {
      await clickToggle('priorityFilterEnabledToggle');
      await browser.pause(1000);
    }

    const initialState = await getToggleState('priorityAlertSoundToggle');
    await clickToggle('priorityAlertSoundToggle');
    await browser.pause(1500);

    const afterToggle = await getToggleState('priorityAlertSoundToggle');
    expect(afterToggle).toBe(!initialState);

    await reopenPopup();
    const persisted = await getToggleState('priorityAlertSoundToggle');
    expect(persisted).toBe(!initialState);

    // Restore
    if (persisted !== initialState) {
      await clickToggle('priorityAlertSoundToggle');
      await browser.pause(500);
    }
  });

  // ── Reset all test values to defaults ─────────────────────────

  it('should restore default values', async () => {
    await navigateToPopup();
    await switchToSettings();
    await browser.pause(300);

    // Reset priority filter values to defaults
    await setInputValue('priorityMinRewardInput', '0');
    await setInputValue('priorityMinHourlyInput', '10');
    await setInputValue('priorityMaxEtaInput', '20');
    await setInputValue('priorityMinPlacesInput', '1');
    await browser.pause(1500);

    const minReward = await getInputValue('priorityMinRewardInput');
    expect(parseFloat(minReward)).toBe(0);
  });
});
