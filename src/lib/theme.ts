import { browser } from 'wxt/browser';

const KEY = 'themePreference';

export type Theme = 'dark' | 'light';

export function applyThemeAttr(dark: boolean): void {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export async function readInitialTheme(): Promise<Theme> {
  const data = await browser.storage.local.get(KEY);
  const pref = data[KEY];
  if (pref === 'dark' || pref === 'light') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export async function writeThemePref(dark: boolean): Promise<void> {
  await browser.storage.local.set({ [KEY]: dark ? 'dark' : 'light' });
}

/** Subscribe to OS theme changes only while no explicit override is stored. Returns cleanup. */
export function watchSystemTheme(onSystemChange: (dark: boolean) => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = async (e: MediaQueryListEvent) => {
    const data = await browser.storage.local.get(KEY);
    if (!data[KEY]) onSystemChange(e.matches);
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
