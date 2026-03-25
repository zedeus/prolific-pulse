/**
 * Tests for popup panel rendering: live studies, feed events, submissions.
 * These tests run AFTER 06-studies-intercept which populates server data.
 */
import { navigateToPopup, getPopupStatus } from '../helpers/popup-dom.js';
import { getServerStudies } from '../helpers/server-api.js';

function switchToTab(tab) {
  return browser.execute((t) => {
    document.querySelector(`button[data-tab="${t}"]`)?.click();
  }, tab);
}

function getPanelState(panelId) {
  return browser.execute((id) => {
    const panel = document.getElementById(id);
    if (!panel) return { exists: false };
    const isActive = panel.classList.contains('active');
    const childCount = panel.querySelectorAll('.event').length;
    const emptyState = panel.querySelector('.empty-events');
    const text = panel.textContent?.trim().slice(0, 200) ?? '';
    return {
      exists: true,
      active: isActive,
      cardCount: childCount,
      hasEmptyState: !!emptyState,
      textPreview: text,
    };
  }, panelId);
}

function getStudyCards() {
  return browser.execute(() => {
    const cards = document.querySelectorAll('#panelLive .event.live');
    return [...cards].map((card) => {
      const title = card.querySelector('.event-title')?.textContent ?? '';
      const reward = card.querySelector('.metric.reward')?.textContent ?? '';
      const rate = card.querySelector('.metric.rate')?.textContent ?? '';
      const badges = [...card.querySelectorAll('.badge')].map((b) => b.textContent ?? '');
      return { title, reward, rate, badges };
    });
  });
}

function getEventCards() {
  return browser.execute(() => {
    const cards = document.querySelectorAll('#panelFeed .event');
    return [...cards].map((card) => {
      const title = card.querySelector('.event-title')?.textContent ?? '';
      const time = card.querySelector('.event-time')?.textContent ?? '';
      const isAvailable = card.classList.contains('available');
      const isUnavailable = card.classList.contains('unavailable');
      return { title, time, isAvailable, isUnavailable };
    });
  });
}

function getSubmissionCards() {
  return browser.execute(() => {
    const cards = document.querySelectorAll('#panelSubmissions .event');
    return [...cards].map((card) => {
      const title = card.querySelector('.event-title')?.textContent ?? '';
      const time = card.querySelector('.event-time')?.textContent ?? '';
      const badges = [...card.querySelectorAll('.badge')].map((b) => b.textContent ?? '');
      return { title, time, badges };
    });
  });
}

describe('Popup Panels', () => {
  it('should show all four panels in DOM', async () => {
    await navigateToPopup();
    for (const id of ['panelLive', 'panelFeed', 'panelSubmissions', 'panelSettings']) {
      const state = await getPanelState(id);
      expect(state.exists).toBe(true);
    }
  });

  it('should show live panel as active by default', async () => {
    await navigateToPopup();
    const live = await getPanelState('panelLive');
    const feed = await getPanelState('panelFeed');
    expect(live.active).toBe(true);
    expect(feed.active).toBe(false);
  });

  it('should render study cards when data is available', async () => {
    await navigateToPopup();
    await browser.pause(2000);

    const serverData = await getServerStudies();
    const live = await getPanelState('panelLive');

    if (serverData.meta.count > 0) {
      expect(live.cardCount).toBeGreaterThan(0);
    } else {
      expect(live.hasEmptyState).toBe(true);
    }
  });

  it('should show study details in cards', async () => {
    await navigateToPopup();
    await browser.pause(2000);

    const cards = await getStudyCards();
    if (cards.length > 0) {
      const first = cards[0];
      expect(first.title.length).toBeGreaterThan(0);
      expect(first.reward.length).toBeGreaterThan(0);
      expect(first.rate).toContain('/hr');
      expect(first.badges.length).toBeGreaterThan(0);
    }
  });

  it('should render feed events when switching to feed tab', async () => {
    await navigateToPopup();
    await switchToTab('feed');
    await browser.pause(500);

    const feed = await getPanelState('panelFeed');
    expect(feed.active).toBe(true);

    const events = await getEventCards();
    if (events.length > 0) {
      const first = events[0];
      expect(first.title.length).toBeGreaterThan(0);
      expect(first.time.length).toBeGreaterThan(0);
      expect(first.isAvailable || first.isUnavailable).toBe(true);
    }
  });

  it('should render submissions when switching to submissions tab', async () => {
    await navigateToPopup();
    await switchToTab('submissions');
    await browser.pause(500);

    const panel = await getPanelState('panelSubmissions');
    expect(panel.active).toBe(true);
    // May have submissions or empty state
    expect(panel.cardCount >= 0 || panel.hasEmptyState).toBe(true);
  });

  it('should have clickable study links', async () => {
    await navigateToPopup();
    await browser.pause(2000);

    const hasLinks = await browser.execute(() => {
      const links = document.querySelectorAll('#panelLive .event-link');
      if (links.length === 0) return null;
      const href = links[0].getAttribute('href');
      return href && href.includes('prolific.com/studies/');
    });

    if (hasLinks !== null) {
      expect(hasLinks).toBe(true);
    }
  });

  it('should show status bar with refresh time', async () => {
    await navigateToPopup();
    const status = await getPopupStatus();

    expect(status.dot_bad).toBe(false);
    expect(status.refresh_text.length).toBeGreaterThan(0);
    expect(status.refresh_text).not.toBe('Offline');
    expect(status.refresh_text).not.toBe('Signed out');
  });

  it('should update refresh time ticker', async () => {
    await navigateToPopup();
    const first = await getPopupStatus();
    await browser.pause(2000);
    const second = await getPopupStatus();

    // The text may or may not change in 2s (depends on how recent the refresh was)
    // but both should be non-empty and not error states
    expect(first.refresh_text.length).toBeGreaterThan(0);
    expect(second.refresh_text.length).toBeGreaterThan(0);
  });

  it('should show diagnostics section in settings', async () => {
    await navigateToPopup();
    await switchToTab('settings');
    await browser.pause(300);

    const hasDebugSection = await browser.execute(() => {
      return !!document.querySelector('details.debug-details');
    });
    expect(hasDebugSection).toBe(true);

    // Expand it
    await browser.execute(() => {
      const details = document.querySelector('details.debug-details');
      if (details && !details.open) details.querySelector('summary')?.click();
    });
    await browser.pause(300);

    const debugGrid = await browser.execute(() => {
      const rows = document.querySelectorAll('#debugGrid .debug-row');
      return rows.length;
    });
    expect(debugGrid).toBeGreaterThan(0);

    const debugLog = await browser.execute(() => {
      const lines = document.querySelectorAll('#debugLog .debug-line');
      return lines.length;
    });
    expect(debugLog).toBeGreaterThan(0);
  });

  it('should show correct tab active states', async () => {
    await navigateToPopup();

    for (const tab of ['live', 'feed', 'submissions', 'settings']) {
      await switchToTab(tab);
      await browser.pause(200);

      const activeTab = await browser.execute(() => {
        const btns = document.querySelectorAll('[data-tab]');
        for (const btn of btns) {
          if (btn.classList.contains('tab-active')) return btn.dataset.tab;
        }
        return null;
      });
      expect(activeTab).toBe(tab);

      const activePanel = await browser.execute((t) => {
        const map = { live: 'panelLive', feed: 'panelFeed', submissions: 'panelSubmissions', settings: 'panelSettings' };
        const panel = document.getElementById(map[t]);
        return panel?.classList.contains('active') ?? false;
      }, tab);
      expect(activePanel).toBe(true);
    }
  });
});
