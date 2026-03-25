import type { Study, PriorityFilter, Money } from '../../lib/types';
import { moneyMajorValue, studyUrlFromId } from '../../lib/format';

function extractStudiesResults(payload: unknown): Study[] | null {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as Record<string, unknown>).results)) {
    return null;
  }
  return (payload as Record<string, unknown>).results as Study[];
}

export function extractStudyID(study: Study | null | undefined): string {
  return study?.id?.trim() ?? '';
}

function studyHourlyRewardMajor(study: Study | null | undefined): number {
  const s = study as any;
  const hourly = s && typeof s === 'object'
    ? (s.study_average_reward_per_hour || s.average_reward_per_hour)
    : null;
  return moneyMajorValue(hourly as Money | null | undefined);
}

function studyRewardMajor(study: Study | null | undefined): number {
  const s = study as any;
  const reward = s && typeof s === 'object'
    ? (s.study_reward || s.reward)
    : null;
  return moneyMajorValue(reward as Money | null | undefined);
}

function studyEstimatedMinutes(study: Study | null | undefined): number {
  const s = study as any;
  const minutes = Number(s && (s.estimated_completion_time || s.average_completion_time));
  if (!Number.isFinite(minutes)) {
    return NaN;
  }
  return minutes;
}

function studyPlacesAvailable(study: Study | null | undefined): number {
  const explicit = Number(study && study.places_available);
  if (Number.isFinite(explicit)) {
    return explicit;
  }
  const total = Number(study && study.total_available_places);
  const taken = Number(study && study.places_taken);
  if (!Number.isFinite(total)) {
    return NaN;
  }
  if (!Number.isFinite(taken)) {
    return total;
  }
  return Math.max(0, total - taken);
}

function studyKeywordBlob(study: Study | null | undefined): string {
  const labels = Array.isArray(study?.study_labels) ? study!.study_labels : [];
  const inferred = Array.isArray(study?.ai_inferred_study_labels) ? study!.ai_inferred_study_labels : [];
  return [
    study && study.name ? study.name : '',
    study && study.description ? study.description : '',
    ...labels,
    ...inferred,
  ].join(' ').toLowerCase();
}

function hasAnyPriorityKeywordMatch(keywordBlob: string, keywords: string[]): boolean {
  if (!Array.isArray(keywords) || !keywords.length) {
    return false;
  }
  return keywords.some((keyword) => keywordBlob.includes(keyword));
}

export function studyMatchesPriorityFilter(study: Study, filter: PriorityFilter): boolean {
  const keywordBlob = studyKeywordBlob(study);
  if (hasAnyPriorityKeywordMatch(keywordBlob, filter.ignore_keywords)) {
    return false;
  }
  if (hasAnyPriorityKeywordMatch(keywordBlob, filter.always_open_keywords)) {
    return true;
  }

  const reward = studyRewardMajor(study);
  if (!Number.isFinite(reward) || reward < filter.minimum_reward_major) {
    return false;
  }

  const hourly = studyHourlyRewardMajor(study);
  if (!Number.isFinite(hourly) || hourly < filter.minimum_hourly_reward_major) {
    return false;
  }

  const estimatedMinutes = studyEstimatedMinutes(study);
  if (!Number.isFinite(estimatedMinutes) || estimatedMinutes > filter.maximum_estimated_minutes) {
    return false;
  }

  const placesAvailable = studyPlacesAvailable(study);
  if (!Number.isFinite(placesAvailable) || placesAvailable < filter.minimum_places_available) {
    return false;
  }
  return true;
}

export function parseStudyIDFromProlificURL(rawURL: string | null | undefined): string {
  if (!rawURL || typeof rawURL !== 'string') {
    return '';
  }
  try {
    const parsed = new URL(rawURL);
    const match = parsed.pathname.match(/^\/studies\/([^/]+)\/?$/);
    if (!match || !match[1]) {
      return '';
    }
    return decodeURIComponent(match[1]);
  } catch {
    return '';
  }
}

export function studyURLFromID(studyID: string | null | undefined): string {
  const id = typeof studyID === 'string' ? studyID.trim() : '';
  if (!id) return '';
  return studyUrlFromId(id);
}

export function parseTimestampMS(value: unknown, fallbackMS: number = Date.now()): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  const parsed = Date.parse(String(value || ''));
  if (Number.isFinite(parsed)) {
    return parsed;
  }
  return fallbackMS;
}

function normalizeStudyIDList(rawStudyIDs: unknown): string[] {
  if (!Array.isArray(rawStudyIDs) || !rawStudyIDs.length) {
    return [];
  }
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const rawStudyID of rawStudyIDs) {
    const studyID = typeof rawStudyID === 'string' ? rawStudyID.trim() : '';
    if (!studyID || seen.has(studyID)) {
      continue;
    }
    seen.add(studyID);
    unique.push(studyID);
  }
  return unique;
}

interface StudiesSnapshot {
  studyIDs: Set<string>;
  studiesByID: Map<string, Study>;
}

function buildPriorityStudiesSnapshotFromStudies(studies: Study[] | unknown): StudiesSnapshot {
  const studiesByID = new Map<string, Study>();
  if (Array.isArray(studies)) {
    for (const study of studies) {
      const studyID = extractStudyID(study);
      if (!studyID || studiesByID.has(studyID)) {
        continue;
      }
      studiesByID.set(studyID, study);
    }
  }
  return {
    studyIDs: new Set(studiesByID.keys()),
    studiesByID,
  };
}

function sortPriorityStudies(studies: Study[]): Study[] {
  return studies.slice().sort((a, b) => {
    const hourlyDiff = studyHourlyRewardMajor(b) - studyHourlyRewardMajor(a);
    if (Number.isFinite(hourlyDiff) && hourlyDiff !== 0) {
      return hourlyDiff;
    }
    const placesDiff = studyPlacesAvailable(b) - studyPlacesAvailable(a);
    if (Number.isFinite(placesDiff) && placesDiff !== 0) {
      return placesDiff;
    }
    const aID = extractStudyID(a);
    const bID = extractStudyID(b);
    return aID.localeCompare(bID);
  });
}

export interface NormalizedSnapshotEvent {
  mode: 'full' | 'delta';
  trigger: string;
  observedAtMS: number;
  studies: Study[];
  removedStudyIDs: string[];
}

export interface SnapshotState {
  initialized: boolean;
  knownStudyIDs: Set<string>;
}

interface SnapshotEvaluationResult {
  event: NormalizedSnapshotEvent;
  nextSnapshot: SnapshotState;
  newlySeenStudies: Study[];
  newPriorityStudies: Study[];
  isBaseline: boolean;
}

export function normalizePrioritySnapshotEvent(event: unknown): NormalizedSnapshotEvent {
  const e = event as Record<string, unknown> | null | undefined;
  const mode = e && e.mode === 'delta' ? 'delta' as const : 'full' as const;
  return {
    mode,
    trigger: String((e && e.trigger) || 'unknown'),
    observedAtMS: parseTimestampMS(e && (e.observedAtMS ?? e.observedAt)),
    studies: Array.isArray(e?.studies) ? e!.studies as Study[] : [],
    removedStudyIDs: normalizeStudyIDList(e && e.removedStudyIDs),
  };
}

export function evaluatePrioritySnapshotEvent(
  previousSnapshot: SnapshotState | null | undefined,
  rawEvent: unknown,
  filter: PriorityFilter | null | undefined,
): SnapshotEvaluationResult {
  const event = normalizePrioritySnapshotEvent(rawEvent);
  const priorStudyIDs = previousSnapshot && previousSnapshot.knownStudyIDs instanceof Set
    ? new Set(previousSnapshot.knownStudyIDs)
    : new Set<string>();
  const wasInitialized = previousSnapshot && previousSnapshot.initialized === true;

  let nextStudyIDs = new Set(priorStudyIDs);
  const newlySeenStudies: Study[] = [];

  if (event.mode === 'delta') {
    for (const removedStudyID of event.removedStudyIDs) {
      nextStudyIDs.delete(removedStudyID);
    }

    const addedSnapshot = buildPriorityStudiesSnapshotFromStudies(event.studies);
    for (const [studyID, study] of addedSnapshot.studiesByID.entries()) {
      if (!nextStudyIDs.has(studyID)) {
        newlySeenStudies.push(study);
      }
      nextStudyIDs.add(studyID);
    }
  } else {
    const fullSnapshot = buildPriorityStudiesSnapshotFromStudies(event.studies);
    nextStudyIDs = fullSnapshot.studyIDs;
    for (const [studyID, study] of fullSnapshot.studiesByID.entries()) {
      if (!priorStudyIDs.has(studyID)) {
        newlySeenStudies.push(study);
      }
    }
  }

  const isBaseline = event.mode === 'full' && !wasInitialized;
  const newPriorityStudies = !isBaseline && filter && filter.enabled
    ? sortPriorityStudies(newlySeenStudies.filter((study) => studyMatchesPriorityFilter(study, filter)))
    : [];

  return {
    event,
    nextSnapshot: {
      initialized: true,
      knownStudyIDs: nextStudyIDs,
    },
    newlySeenStudies,
    newPriorityStudies,
    isBaseline,
  };
}

interface RawSnapshotEvent {
  mode: 'full' | 'delta';
  trigger: string;
  observedAt?: string;
  studies: Study[];
  removedStudyIDs: string[];
}

interface FullSnapshotContext {
  normalizedURL?: string;
  observedAt?: string;
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
