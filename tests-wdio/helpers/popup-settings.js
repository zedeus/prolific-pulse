/**
 * Ensure at least one priority filter exists, expanding the first one.
 */
async function ensureFilterExpanded() {
  // Click settings tab
  await (await $('button[data-tab="settings"]')).click();
  await browser.pause(300);

  // Create filter if none exist
  const hasFilter = await browser.execute(() => {
    return document.querySelectorAll('[data-filter-id]').length > 0;
  });
  if (!hasFilter) {
    await browser.execute(() => {
      const btn = document.getElementById('addFilterButton');
      if (btn) btn.click();
    });
    await browser.pause(500);
  }

  // Expand first filter if collapsed
  await browser.execute(() => {
    const card = document.querySelector('[data-filter-id]');
    if (card) {
      const btn = card.querySelector('button[aria-label="Expand filter"], button[aria-label="Collapse filter"]');
      if (btn) btn.click();
    }
  });
  await browser.pause(300);
}

/**
 * Toggle the first priority filter enabled checkbox.
 */
export async function togglePriorityFilter(enable = true) {
  await ensureFilterExpanded();
  const checkbox = await $('#priorityFilterEnabledToggle-0');
  const isChecked = await checkbox.isSelected();
  if (enable && !isChecked) await checkbox.click();
  else if (!enable && isChecked) await checkbox.click();
  await browser.pause(500);
}

/**
 * Fill first priority filter fields. Switches to settings tab first.
 */
export async function setPriorityFilter({
  minReward,
  minHourly,
  maxEta,
  minPlaces,
} = {}) {
  await ensureFilterExpanded();
  if (minReward !== undefined) {
    await (await $('#priorityMinRewardInput-0')).setValue(String(minReward));
  }
  if (minHourly !== undefined) {
    await (await $('#priorityMinHourlyInput-0')).setValue(String(minHourly));
  }
  if (maxEta !== undefined) {
    await (await $('#priorityMaxEtaInput-0')).setValue(String(maxEta));
  }
  if (minPlaces !== undefined) {
    await (await $('#priorityMinPlacesInput-0')).setValue(String(minPlaces));
  }
}
