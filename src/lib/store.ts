import { db } from './db';
import { nowIso } from './format';
import type {
  StudyLatestRecord,
  StudyActiveSnapshotRecord,
  SubmissionRecord,
} from './db';
import type {
  Study,
  StudyEvent,
  Submission,
  StudiesRefreshState,
} from './types';
import type { SubmissionSnapshot } from './normalize';

// --- Service State ---

interface StudiesRefreshUpdate {
  observed_at: string;
  source: string;
  url: string;
  status_code: number;
}

export async function setStudiesRefresh(update: StudiesRefreshUpdate): Promise<void> {
  await db.serviceState.put({
    id: 1,
    last_studies_refresh_at: update.observed_at,
    last_studies_refresh_source: update.source,
    last_studies_refresh_url: update.url,
    last_studies_refresh_status: update.status_code,
    updated_at: nowIso(),
  });
}

export async function getStudiesRefresh(): Promise<StudiesRefreshState | null> {
  const row = await db.serviceState.get(1);
  if (!row || !row.last_studies_refresh_at) return null;
  return {
    last_studies_refresh_at: row.last_studies_refresh_at,
    last_studies_refresh_source: row.last_studies_refresh_source,
    last_studies_refresh_url: row.last_studies_refresh_url,
    last_studies_refresh_status: row.last_studies_refresh_status,
  };
}

// --- Studies ---

export async function storeNormalizedStudies(studies: Study[], observedAt: string): Promise<void> {
  if (studies.length === 0) return;

  await db.transaction('rw', [db.studiesHistory, db.studiesLatest], async () => {
    const historyRecords = studies.map((study) => ({
      study_id: study.id,
      observed_at: observedAt,
      payload: study as unknown as Record<string, unknown>,
    }));
    await db.studiesHistory.bulkAdd(historyRecords);

    const latestRecords: StudyLatestRecord[] = studies.map((study) => ({
      study_id: study.id,
      name: study.name,
      payload: study as unknown as Record<string, unknown>,
      last_seen_at: observedAt,
    }));
    await db.studiesLatest.bulkPut(latestRecords);
  });
}

interface StudyChange {
  study_id: string;
  name: string;
}

export interface AvailabilitySummary {
  observed_at: string;
  newly_available: StudyChange[];
  became_unavailable: StudyChange[];
}

/**
 * Compare current studies against the active snapshot to detect availability changes.
 * Port of StudiesStore.ReconcileAvailability from stores.go:400-487.
 */
export async function reconcileAvailability(studies: Study[], observedAt: string): Promise<AvailabilitySummary> {
  const currentMap = new Map<string, string>();
  for (const study of studies) {
    if (study.id) currentMap.set(study.id, study.name);
  }

  const summary: AvailabilitySummary = {
    observed_at: observedAt,
    newly_available: [],
    became_unavailable: [],
  };

  await db.transaction('rw', [db.studiesActiveSnapshot, db.studyAvailabilityEvents], async () => {
    const previousEntries = await db.studiesActiveSnapshot.toArray();
    const previousMap = new Map<string, { name: string; first_seen_at: string }>();
    for (const entry of previousEntries) {
      previousMap.set(entry.study_id, { name: entry.name, first_seen_at: entry.first_seen_at });
    }

    const newEvents: { study_id: string; study_name: string; event_type: 'available' | 'unavailable'; observed_at: string }[] = [];
    for (const [id, name] of currentMap) {
      if (!previousMap.has(id)) {
        summary.newly_available.push({ study_id: id, name });
        newEvents.push({ study_id: id, study_name: name, event_type: 'available', observed_at: observedAt });
      }
    }
    for (const [id, prev] of previousMap) {
      if (!currentMap.has(id)) {
        summary.became_unavailable.push({ study_id: id, name: prev.name });
        newEvents.push({ study_id: id, study_name: prev.name, event_type: 'unavailable', observed_at: observedAt });
      }
    }
    if (newEvents.length > 0) {
      await db.studyAvailabilityEvents.bulkAdd(newEvents);
    }

    const departedIDs = [...previousMap.keys()].filter((id) => !currentMap.has(id));
    if (departedIDs.length > 0) {
      await db.studiesActiveSnapshot.bulkDelete(departedIDs);
    }

    const upsertRecords: StudyActiveSnapshotRecord[] = [];
    for (const [id, name] of currentMap) {
      const prev = previousMap.get(id);
      upsertRecords.push({
        study_id: id,
        name,
        first_seen_at: prev?.first_seen_at ?? observedAt,
        last_seen_at: observedAt,
      });
    }
    if (upsertRecords.length > 0) {
      await db.studiesActiveSnapshot.bulkPut(upsertRecords);
    }
  });

  // Sort for deterministic output (matches Go sort)
  summary.newly_available.sort((a, b) => a.study_id.localeCompare(b.study_id));
  summary.became_unavailable.sort((a, b) => a.study_id.localeCompare(b.study_id));

  return summary;
}

/**
 * Get recent availability events enriched with study data.
 * Port of StudiesStore.GetRecentAvailabilityEvents from stores.go:489-532.
 */
export async function getRecentAvailabilityEvents(limit: number): Promise<StudyEvent[]> {
  limit = clamp(limit, 50, 1000);

  const eventRecords = await db.studyAvailabilityEvents
    .orderBy('row_id')
    .reverse()
    .limit(limit)
    .toArray();

  // Batch load related studies to avoid N+1 queries
  const studyIds = [...new Set(eventRecords.map((r) => r.study_id))];
  const studyRecords = await db.studiesLatest
    .where('study_id')
    .anyOf(studyIds)
    .toArray();
  const studyMap = new Map(studyRecords.map((r) => [r.study_id, r.payload as unknown as Study]));

  return eventRecords.map((record) => {
    const study = studyMap.get(record.study_id);
    return {
      row_id: record.row_id!,
      study_id: record.study_id,
      study_name: record.study_name,
      event_type: record.event_type,
      observed_at: record.observed_at,
      reward: study?.reward ?? { amount: 0, currency: '' },
      average_reward_per_hour: study?.average_reward_per_hour ?? { amount: 0, currency: '' },
      estimated_completion_time: study?.estimated_completion_time ?? 0,
      total_available_places: study?.total_available_places ?? 0,
      places_available: study?.places_available ?? 0,
    };
  });
}

/**
 * Get currently available studies sorted by first_seen_at.
 * Port of StudiesStore.GetCurrentAvailableStudies from stores.go:534-573.
 */
export async function getCurrentAvailableStudies(limit: number): Promise<Study[]> {
  limit = clamp(limit, 200, 2000);

  const snapshots = await db.studiesActiveSnapshot.toArray();

  // Batch load related studies to avoid N+1 queries
  const snapshotIds = snapshots.map((s) => s.study_id);
  const latestRecords = await db.studiesLatest
    .where('study_id')
    .anyOf(snapshotIds)
    .toArray();
  const latestMap = new Map(latestRecords.map((r) => [r.study_id, r.payload as unknown as Study]));

  const joined: { snapshot: StudyActiveSnapshotRecord; study: Study }[] = [];
  for (const snapshot of snapshots) {
    const study = latestMap.get(snapshot.study_id);
    if (!study) continue;
    joined.push({ snapshot, study });
  }

  // Sort: first_seen_at ASC, published_at ASC, date_created ASC, study_id ASC
  joined.sort((a, b) => {
    const cmp1 = a.snapshot.first_seen_at.localeCompare(b.snapshot.first_seen_at);
    if (cmp1 !== 0) return cmp1;
    const cmp2 = (a.study.published_at ?? '').localeCompare(b.study.published_at ?? '');
    if (cmp2 !== 0) return cmp2;
    const cmp3 = (a.study.date_created ?? '').localeCompare(b.study.date_created ?? '');
    if (cmp3 !== 0) return cmp3;
    return a.snapshot.study_id.localeCompare(b.snapshot.study_id);
  });

  return joined.slice(0, limit).map(({ snapshot, study }) => ({
    ...study,
    first_seen_at: snapshot.first_seen_at,
  }));
}

// --- Submissions ---

/**
 * Upsert a submission with smart merge logic.
 * Port of SubmissionsStore.UpsertSnapshot from stores.go:157-256.
 */
export async function upsertSubmission(snapshot: SubmissionSnapshot, observedAt: string): Promise<void> {
  // snapshot.status is already normalized by buildSubmissionSnapshot
  const status = snapshot.status;
  if (!status) throw new Error('missing status');
  const phase = snapshot.phase;

  const studyID = snapshot.study_id;
  const studyName = snapshot.study_name;
  const participantID = snapshot.participant_id;
  const payload = snapshot.payload && typeof snapshot.payload === 'object' ? snapshot.payload : {};
  const updatedAt = nowIso();

  await db.transaction('rw', db.submissions, async () => {
    const existing = await db.submissions.get(snapshot.submission_id);

    if (!existing) {
      const record: SubmissionRecord = {
        submission_id: snapshot.submission_id,
        study_id: studyID,
        study_name: studyName,
        participant_id: participantID,
        status,
        phase,
        payload,
        observed_at: observedAt,
        updated_at: updatedAt,
      };
      await db.submissions.add(record);
      return;
    }

    // Merge logic matching Go UPSERT ON CONFLICT
    const mergedStudyID = (studyID && studyID !== 'unknown') ? studyID : existing.study_id;
    const mergedStudyName = (studyName && studyName !== 'Unknown Study') ? studyName : existing.study_name;
    const mergedParticipantID = participantID || existing.participant_id;

    // Preserve payload when: both phases are 'submitted', old has completed_at/returned_at, new doesn't
    let mergedPayload = payload;
    if (existing.phase === phase && phase === 'submitted') {
      const oldPayload = existing.payload as Record<string, unknown>;
      const oldHasTimestamp = oldPayload.returned_at != null || oldPayload.completed_at != null;
      const newHasTimestamp = payload.returned_at != null || payload.completed_at != null;
      if (oldHasTimestamp && !newHasTimestamp) {
        mergedPayload = existing.payload;
      }
    }

    // Preserve observed_at when both phases are 'submitted'
    const mergedObservedAt = (existing.phase === phase && phase === 'submitted')
      ? existing.observed_at
      : observedAt;

    await db.submissions.put({
      submission_id: snapshot.submission_id,
      study_id: mergedStudyID,
      study_name: mergedStudyName,
      participant_id: mergedParticipantID,
      status,
      phase,
      payload: mergedPayload,
      observed_at: mergedObservedAt,
      updated_at: updatedAt,
    });
  });
}

/**
 * Get current submissions, optionally filtered by phase.
 * Port of SubmissionsStore.GetCurrentSubmissions from stores.go:258-330.
 */
export async function getCurrentSubmissions(limit: number, phase: 'all' | 'submitting' | 'submitted'): Promise<Submission[]> {
  limit = clamp(limit, 200, 2000);

  let records: SubmissionRecord[];

  if (phase === 'all') {
    records = await db.submissions.toArray();
  } else {
    records = await db.submissions
      .where('phase')
      .equals(phase)
      .toArray();
  }

  records.sort((a, b) => {
    const cmp = b.observed_at.localeCompare(a.observed_at);
    if (cmp !== 0) return cmp;
    return b.submission_id.localeCompare(a.submission_id);
  });

  records = records.slice(0, limit);

  return records.map((r) => ({
    submission_id: r.submission_id,
    study_id: r.study_id,
    study_name: r.study_name,
    participant_id: r.participant_id || undefined,
    status: r.status,
    phase: r.phase,
    observed_at: r.observed_at,
    updated_at: r.updated_at,
    payload: r.payload,
  }));
}

// --- Helpers ---

function clamp(value: number, fallback: number, max: number): number {
  if (value <= 0) return fallback;
  if (value > max) return max;
  return value;
}
