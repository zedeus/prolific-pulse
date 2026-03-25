import type { Study } from '../../lib/types';
import { extractStudiesResults, normalizeStudyIDList } from './domain';

export interface RawSnapshotEvent {
  mode: 'full' | 'delta';
  trigger: string;
  observedAt?: string;
  studies: Study[];
  removedStudyIDs: string[];
}

export interface StudiesRefreshMessage {
  data?: {
    source?: string;
    newly_available_studies?: Study[];
    became_unavailable_study_ids?: string[];
  };
}

export interface FullSnapshotContext {
  normalizedURL?: string;
  observedAt?: string;
}

export function extractPrioritySnapshotEventFromStudiesRefreshMessage(
  parsed: StudiesRefreshMessage | null | undefined,
  nowIso: () => string,
  extractObservedAtFn?: ((parsed: StudiesRefreshMessage | null | undefined) => string) | null,
): RawSnapshotEvent {
  const observedAt = typeof extractObservedAtFn === 'function'
    ? extractObservedAtFn(parsed)
    : nowIso();
  const data = parsed && typeof parsed.data === 'object' && parsed.data
    ? parsed.data
    : {} as NonNullable<StudiesRefreshMessage['data']>;
  const source = typeof data.source === 'string' ? data.source.trim() : '';
  const studies = Array.isArray(data.newly_available_studies)
    ? data.newly_available_studies
    : [];
  const removedStudyIDs = normalizeStudyIDList(data.became_unavailable_study_ids);
  const triggerParts = [
    'service.ws.studies_refresh_event',
    source ? `source=${source}` : '',
    observedAt ? `observed_at=${observedAt}` : '',
  ].filter(Boolean);
  return {
    mode: 'delta',
    trigger: triggerParts.join(' '),
    observedAt,
    studies,
    removedStudyIDs,
  };
}

export function toFullSnapshotEvent(
  parsed: unknown,
  context: FullSnapshotContext | null | undefined,
  nowIso: () => string,
): RawSnapshotEvent | null {
  const studies = extractStudiesResults(parsed);
  if (!studies) {
    return null;
  }
  return {
    mode: 'full',
    trigger: context && context.normalizedURL
      ? String(context.normalizedURL)
      : 'studies.response.capture',
    observedAt: context && context.observedAt ? context.observedAt : nowIso(),
    studies,
    removedStudyIDs: [],
  };
}
