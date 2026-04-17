import { seedFakeSubmissions, clearFakeSubmissions } from './fake-submissions';

declare global {
  interface Window {
    __ppDev?: {
      seed: (count: number, seed?: number) => Promise<number>;
      clear: () => Promise<void>;
    };
  }
}

export function attachDevHelpers(): void {
  if (typeof window === 'undefined') return;
  window.__ppDev = {
    seed: seedFakeSubmissions,
    clear: clearFakeSubmissions,
  };
}
