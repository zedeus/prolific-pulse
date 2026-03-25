import { defineProxy } from 'comctx';
import type {
  SyncState,
  Settings,
  DashboardData,
  DashboardLimits,
  PriorityFilter,
  RefreshPolicy,
  InterceptedResponse,
} from './types';

export class BackgroundService {
  async getState(): Promise<SyncState | null> {
    return null;
  }
  async getSettings(): Promise<Settings> {
    return {} as Settings;
  }
  async getDashboardData(_limits: DashboardLimits): Promise<DashboardData> {
    return {} as DashboardData;
  }
  async setAutoOpen(_enabled: boolean): Promise<void> {}
  async setPriorityFilter(_filter: PriorityFilter): Promise<Settings> {
    return {} as Settings;
  }
  async setRefreshDelays(_policy: RefreshPolicy): Promise<Settings> {
    return {} as Settings;
  }
  async clearDebugLogs(): Promise<void> {}
  async reportInterceptedResponse(_data: InterceptedResponse): Promise<void> {}

  onDashboardUpdate(_callback: (update: { trigger: string; observed_at: string }) => void): void {}
}

export const [provideBackground, injectBackground] = defineProxy(
  () => new BackgroundService(),
  { namespace: 'prolific-pulse', heartbeatCheck: false },
);

export class OffscreenService {
  async playSound(_soundPath: string, _normalizedVolume: number): Promise<void> {}
}

export const [provideOffscreen, injectOffscreen] = defineProxy(
  () => new OffscreenService(),
  { namespace: 'prolific-pulse-offscreen', heartbeatCheck: false },
);
