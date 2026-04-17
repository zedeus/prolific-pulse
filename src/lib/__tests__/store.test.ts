import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import * as store from '../store';
import type { Study } from '../types';
import type { SubmissionSnapshot } from '../normalize';

function makeStudy(id: string, name: string, overrides: Partial<Study> = {}): Study {
  return {
    id, name,
    study_type: 'STANDARD',
    date_created: '2024-01-01T00:00:00Z',
    published_at: '2024-01-01T00:00:00Z',
    total_available_places: 100,
    places_taken: 0,
    places_available: 100,
    reward: { amount: 5, currency: 'GBP' },
    average_reward_per_hour: { amount: 10, currency: 'GBP' },
    max_submissions_per_participant: 1,
    researcher: { id: 'r1', name: 'Dr Test', country: 'UK' },
    description: 'Test study',
    estimated_completion_time: 600,
    device_compatibility: ['desktop'],
    peripheral_requirements: [],
    maximum_allowed_time: 3600,
    average_completion_time_in_seconds: 500,
    is_confidential: false,
    is_ongoing_study: false,
    submission_started_at: null,
    pii_enabled: false,
    is_custom_screening: false,
    study_labels: [],
    ai_inferred_study_labels: [],
    previous_submission_count: 0,
    ...overrides,
  };
}

function makeSnapshot(id: string, status: string, overrides: Partial<SubmissionSnapshot> = {}): SubmissionSnapshot {
  return {
    submission_id: id,
    study_id: 'study1',
    study_name: 'Test Study',
    participant_id: 'p1',
    status,
    phase: status === 'RESERVED' || status === 'ACTIVE' ? 'submitting' : 'submitted',
    payload: {},
    ...overrides,
  };
}

beforeEach(async () => {
  await db.studiesLatest.clear();
  await db.studiesHistory.clear();
  await db.studiesActiveSnapshot.clear();
  await db.studyAvailabilityEvents.clear();
  await db.serviceState.clear();
  await db.submissions.clear();
});

// --- Service State ---

describe('setStudiesRefresh / getStudiesRefresh', () => {
  it('stores and retrieves refresh state', async () => {
    await store.setStudiesRefresh({
      observed_at: '2024-01-01T00:00:00Z',
      source: 'test',
      url: 'https://example.com',
      status_code: 200,
    });

    const state = await store.getStudiesRefresh();
    expect(state).not.toBeNull();
    expect(state!.last_studies_refresh_at).toBe('2024-01-01T00:00:00Z');
    expect(state!.last_studies_refresh_source).toBe('test');
    expect(state!.last_studies_refresh_url).toBe('https://example.com');
    expect(state!.last_studies_refresh_status).toBe(200);
  });

  it('returns null when no state exists', async () => {
    const state = await store.getStudiesRefresh();
    expect(state).toBeNull();
  });

  it('upserts on repeated calls', async () => {
    await store.setStudiesRefresh({ observed_at: 't1', source: 'first', url: 'u1', status_code: 200 });
    await store.setStudiesRefresh({ observed_at: 't2', source: 'second', url: 'u2', status_code: 201 });

    const state = await store.getStudiesRefresh();
    expect(state!.last_studies_refresh_source).toBe('second');
    expect(state!.last_studies_refresh_status).toBe(201);
  });
});

// --- Studies Storage ---

describe('storeNormalizedStudies', () => {
  it('stores studies in latest and history', async () => {
    const studies = [makeStudy('s1', 'Study 1'), makeStudy('s2', 'Study 2')];
    await store.storeNormalizedStudies(studies, '2024-01-01T00:00:00Z');

    const latest = await db.studiesLatest.toArray();
    expect(latest).toHaveLength(2);

    const history = await db.studiesHistory.toArray();
    expect(history).toHaveLength(2);
  });

  it('does nothing for empty array', async () => {
    await store.storeNormalizedStudies([], '2024-01-01T00:00:00Z');
    expect(await db.studiesLatest.count()).toBe(0);
  });

  it('updates latest on repeated store', async () => {
    await store.storeNormalizedStudies([makeStudy('s1', 'Old Name')], 't1');
    await store.storeNormalizedStudies([makeStudy('s1', 'New Name')], 't2');

    const latest = await db.studiesLatest.toArray();
    expect(latest).toHaveLength(1);
    expect(latest[0].name).toBe('New Name');

    // History should have both
    const history = await db.studiesHistory.toArray();
    expect(history).toHaveLength(2);
  });
});

// --- Availability Reconciliation ---

describe('reconcileAvailability', () => {
  it('detects newly available studies', async () => {
    const studies = [makeStudy('s1', 'Study 1'), makeStudy('s2', 'Study 2')];
    const summary = await store.reconcileAvailability(studies, 't1');

    expect(summary.newly_available).toHaveLength(2);
    expect(summary.became_unavailable).toHaveLength(0);
    expect(summary.newly_available.map((s) => s.study_id).sort()).toEqual(['s1', 's2']);
  });

  it('detects became unavailable studies', async () => {
    await store.reconcileAvailability([makeStudy('s1', 'Study 1'), makeStudy('s2', 'Study 2')], 't1');
    const summary = await store.reconcileAvailability([makeStudy('s1', 'Study 1')], 't2');

    expect(summary.newly_available).toHaveLength(0);
    expect(summary.became_unavailable).toHaveLength(1);
    expect(summary.became_unavailable[0].study_id).toBe('s2');
  });

  it('detects no changes when same studies', async () => {
    const studies = [makeStudy('s1', 'Study 1')];
    await store.reconcileAvailability(studies, 't1');
    const summary = await store.reconcileAvailability(studies, 't2');

    expect(summary.newly_available).toHaveLength(0);
    expect(summary.became_unavailable).toHaveLength(0);
  });

  it('handles empty to empty', async () => {
    const summary = await store.reconcileAvailability([], 't1');
    expect(summary.newly_available).toHaveLength(0);
    expect(summary.became_unavailable).toHaveLength(0);
  });

  it('handles all studies disappearing', async () => {
    await store.reconcileAvailability([makeStudy('s1', 'A'), makeStudy('s2', 'B')], 't1');
    const summary = await store.reconcileAvailability([], 't2');

    expect(summary.became_unavailable).toHaveLength(2);
    expect(summary.newly_available).toHaveLength(0);
  });

  it('preserves first_seen_at across reconciliations', async () => {
    await store.reconcileAvailability([makeStudy('s1', 'Study 1')], 't1');
    await store.reconcileAvailability([makeStudy('s1', 'Study 1')], 't2');

    const snapshot = await db.studiesActiveSnapshot.get('s1');
    expect(snapshot!.first_seen_at).toBe('t1');
    expect(snapshot!.last_seen_at).toBe('t2');
  });

  it('creates availability events', async () => {
    await store.reconcileAvailability([makeStudy('s1', 'Study 1')], 't1');
    await store.reconcileAvailability([], 't2');

    const events = await db.studyAvailabilityEvents.toArray();
    expect(events).toHaveLength(2);
    expect(events[0].event_type).toBe('available');
    expect(events[1].event_type).toBe('unavailable');
  });

  it('sorts output by study_id', async () => {
    const studies = [makeStudy('z', 'Z'), makeStudy('a', 'A'), makeStudy('m', 'M')];
    const summary = await store.reconcileAvailability(studies, 't1');
    expect(summary.newly_available.map((s) => s.study_id)).toEqual(['a', 'm', 'z']);
  });

  it('skips studies with empty id', async () => {
    const studies = [makeStudy('', 'No ID'), makeStudy('s1', 'Valid')];
    const summary = await store.reconcileAvailability(studies, 't1');
    expect(summary.newly_available).toHaveLength(1);
    expect(summary.newly_available[0].study_id).toBe('s1');
  });
});

// --- Available Studies Query ---

describe('getCurrentAvailableStudies', () => {
  it('returns studies sorted by first_seen_at', async () => {
    await store.storeNormalizedStudies([makeStudy('s1', 'First')], 't1');
    await store.reconcileAvailability([makeStudy('s1', 'First')], 't1');

    await store.storeNormalizedStudies([makeStudy('s2', 'Second')], 't2');
    await store.reconcileAvailability([makeStudy('s1', 'First'), makeStudy('s2', 'Second')], 't2');

    const studies = await store.getCurrentAvailableStudies(100);
    expect(studies).toHaveLength(2);
    expect(studies[0].id).toBe('s1');
    expect(studies[1].id).toBe('s2');
    expect(studies[0].first_seen_at).toBe('t1');
    expect(studies[1].first_seen_at).toBe('t2');
  });

  it('respects limit', async () => {
    const studies = [makeStudy('s1', 'A'), makeStudy('s2', 'B'), makeStudy('s3', 'C')];
    await store.storeNormalizedStudies(studies, 't1');
    await store.reconcileAvailability(studies, 't1');

    const result = await store.getCurrentAvailableStudies(2);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no studies', async () => {
    const studies = await store.getCurrentAvailableStudies(100);
    expect(studies).toEqual([]);
  });

  it('excludes departed studies', async () => {
    const studies = [makeStudy('s1', 'A'), makeStudy('s2', 'B')];
    await store.storeNormalizedStudies(studies, 't1');
    await store.reconcileAvailability(studies, 't1');
    await store.reconcileAvailability([makeStudy('s1', 'A')], 't2');

    const result = await store.getCurrentAvailableStudies(100);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('s1');
  });
});

// --- Availability Events Query ---

describe('getRecentAvailabilityEvents', () => {
  it('returns events in reverse order', async () => {
    await store.reconcileAvailability([makeStudy('s1', 'A')], 't1');
    await store.reconcileAvailability([makeStudy('s1', 'A'), makeStudy('s2', 'B')], 't2');

    const events = await store.getRecentAvailabilityEvents(10);
    expect(events).toHaveLength(2);
    // Most recent first
    expect(events[0].study_id).toBe('s2');
    expect(events[0].event_type).toBe('available');
  });

  it('enriches events with study data', async () => {
    await store.storeNormalizedStudies([makeStudy('s1', 'A', { reward: { amount: 5, currency: 'GBP' } })], 't1');
    await store.reconcileAvailability([makeStudy('s1', 'A')], 't1');

    const events = await store.getRecentAvailabilityEvents(10);
    expect(events[0].reward.amount).toBe(5);
  });

  it('handles missing study data gracefully', async () => {
    // Create event without storing the study in studiesLatest
    await db.studyAvailabilityEvents.add({
      study_id: 'orphan', study_name: 'Orphan', event_type: 'available', observed_at: 't1',
    });

    const events = await store.getRecentAvailabilityEvents(10);
    expect(events).toHaveLength(1);
    expect(events[0].reward).toEqual({ amount: 0, currency: '' });
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await store.reconcileAvailability([makeStudy(`s${i}`, `Study ${i}`)], `t${i}`);
      await store.reconcileAvailability([], `t${i}b`);
    }

    const events = await store.getRecentAvailabilityEvents(3);
    expect(events).toHaveLength(3);
  });
});

// --- Submissions ---

describe('upsertSubmission', () => {
  it('inserts a new submission', async () => {
    await store.upsertSubmission(makeSnapshot('sub1', 'RESERVED'), 't1');

    const records = await db.submissions.toArray();
    expect(records).toHaveLength(1);
    expect(records[0].submission_id).toBe('sub1');
    expect(records[0].phase).toBe('submitting');
  });

  it('updates status and phase on conflict', async () => {
    await store.upsertSubmission(makeSnapshot('sub1', 'RESERVED'), 't1');
    await store.upsertSubmission(makeSnapshot('sub1', 'APPROVED'), 't2');

    const records = await db.submissions.toArray();
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('APPROVED');
    expect(records[0].phase).toBe('submitted');
  });

  it('preserves better study_name', async () => {
    await store.upsertSubmission(makeSnapshot('sub1', 'RESERVED', { study_name: 'Real Name' }), 't1');
    await store.upsertSubmission(makeSnapshot('sub1', 'ACTIVE', { study_name: 'Unknown Study' }), 't2');

    const records = await db.submissions.toArray();
    expect(records[0].study_name).toBe('Real Name');
  });

  it('preserves better study_id', async () => {
    await store.upsertSubmission(makeSnapshot('sub1', 'RESERVED', { study_id: 'real_id' }), 't1');
    await store.upsertSubmission(makeSnapshot('sub1', 'ACTIVE', { study_id: 'unknown' }), 't2');

    const records = await db.submissions.toArray();
    expect(records[0].study_id).toBe('real_id');
  });

  it('preserves payload with completed_at when new lacks it', async () => {
    const oldPayload = { completed_at: '2024-01-01', data: 'old' };
    const newPayload = { data: 'new' };

    await store.upsertSubmission(makeSnapshot('sub1', 'APPROVED', { payload: oldPayload }), 't1');
    await store.upsertSubmission(makeSnapshot('sub1', 'APPROVED', { payload: newPayload }), 't2');

    const records = await db.submissions.toArray();
    expect((records[0].payload as any).completed_at).toBe('2024-01-01');
  });

  it('preserves payload with returned_at when new lacks it', async () => {
    const oldPayload = { returned_at: '2024-01-01' };
    const newPayload = {};

    await store.upsertSubmission(makeSnapshot('sub1', 'RETURNED', { payload: oldPayload }), 't1');
    await store.upsertSubmission(makeSnapshot('sub1', 'RETURNED', { payload: newPayload }), 't2');

    const records = await db.submissions.toArray();
    expect((records[0].payload as any).returned_at).toBe('2024-01-01');
  });

  it('replaces payload when new also has timestamps', async () => {
    const oldPayload = { completed_at: '2024-01-01' };
    const newPayload = { completed_at: '2024-01-02', extra: true };

    await store.upsertSubmission(makeSnapshot('sub1', 'APPROVED', { payload: oldPayload }), 't1');
    await store.upsertSubmission(makeSnapshot('sub1', 'APPROVED', { payload: newPayload }), 't2');

    const records = await db.submissions.toArray();
    expect((records[0].payload as any).completed_at).toBe('2024-01-02');
  });

  it('preserves observed_at for same-phase submitted entries', async () => {
    await store.upsertSubmission(makeSnapshot('sub1', 'APPROVED'), 't1');
    await store.upsertSubmission(makeSnapshot('sub1', 'APPROVED'), 't2');

    const records = await db.submissions.toArray();
    expect(records[0].observed_at).toBe('t1');
  });

  it('updates observed_at on phase change', async () => {
    await store.upsertSubmission(makeSnapshot('sub1', 'RESERVED'), 't1');
    await store.upsertSubmission(makeSnapshot('sub1', 'APPROVED'), 't2');

    const records = await db.submissions.toArray();
    expect(records[0].observed_at).toBe('t2');
  });

  it('throws on empty status', async () => {
    await expect(store.upsertSubmission(makeSnapshot('sub1', ''), 't1')).rejects.toThrow('missing status');
  });

  it('replaces a codeless CSV stub by signature (name + started_at + reward)', async () => {
    // Prolific RETURNED rows in the CSV export have no Completion Code.
    await db.submissions.add({
      submission_id: 'csv:image-matching-study:2026-01-01T10:00:00.000Z',
      study_id: 'csv:image-matching-study',
      study_name: 'Image Matching Study',
      participant_id: 'csv-import',
      status: 'RETURNED',
      phase: 'submitted',
      payload: {
        started_at: '2026-01-01T10:00:00.000Z',
        submission_reward: { amount: 267, currency: 'GBP' },
      },
      observed_at: '2026-01-01T10:00:00.000Z',
      updated_at: '2026-01-01T10:00:00.000Z',
    });
    await store.upsertSubmission(makeSnapshot('live-id-x', 'RETURNED', {
      study_id: 'real-uuid-2',
      study_name: 'Image Matching Study',
      // Live payload uses microsecond precision; signature rounds to seconds.
      payload: {
        started_at: '2026-01-01T10:00:00.123000Z',
        submission_reward: { amount: 267, currency: 'GBP' },
      },
    }), '2026-01-02T00:00:00Z');

    expect(await db.submissions.get('csv:image-matching-study:2026-01-01T10:00:00.000Z')).toBeUndefined();
    expect(await db.submissions.get('live-id-x')).toBeDefined();
  });

  it('does not delete unrelated CSV rows when signatures differ', async () => {
    await db.submissions.add({
      submission_id: 'csv:other-study:2026-01-01T10:00:00.000Z',
      study_id: 'csv:other-study',
      study_name: 'Other Study',
      participant_id: 'csv-import',
      status: 'APPROVED',
      phase: 'submitted',
      payload: {
        started_at: '2026-01-01T10:00:00.000Z',
        submission_reward: { amount: 500, currency: 'GBP' },
      },
      observed_at: '2026-01-01T10:00:00.000Z',
      updated_at: '2026-01-01T10:00:00.000Z',
    });
    await store.upsertSubmission(makeSnapshot('live-id-y', 'APPROVED', {
      study_name: 'Different Study',
      payload: {
        started_at: '2026-01-01T10:00:00.000Z',
        submission_reward: { amount: 500, currency: 'GBP' },
      },
    }), '2026-01-02T00:00:00Z');
    expect(await db.submissions.get('csv:other-study:2026-01-01T10:00:00.000Z')).toBeDefined();
  });

  it('replaces a CSV-imported stub when the matching live response arrives', async () => {
    await db.submissions.add({
      submission_id: 'csv:CABC1234',
      study_id: 'csv:image-matching-study',
      study_name: 'Image Matching Study',
      participant_id: 'csv-import',
      status: 'APPROVED',
      phase: 'submitted',
      payload: { completion_code: 'CABC1234', started_at: '2026-01-01T10:00:00Z' },
      observed_at: '2026-01-01T10:05:00Z',
      updated_at: '2026-01-01T10:05:00Z',
    });
    await store.upsertSubmission(makeSnapshot('live-id-1', 'APPROVED', {
      study_id: 'real-uuid-1',
      study_name: 'Image Matching Study',
      payload: { study_code: 'CABC1234', started_at: '2026-01-01T10:00:00Z', completed_at: '2026-01-01T10:05:00Z' },
    }), '2026-01-02T00:00:00Z');

    expect(await db.submissions.get('csv:CABC1234')).toBeUndefined();
    const live = await db.submissions.get('live-id-1');
    expect(live?.study_id).toBe('real-uuid-1');
  });
});

describe('getCurrentSubmissions', () => {
  it('returns all submissions ordered by observed_at DESC', async () => {
    await store.upsertSubmission(makeSnapshot('sub1', 'RESERVED'), 't1');
    await store.upsertSubmission(makeSnapshot('sub2', 'APPROVED'), 't2');
    await store.upsertSubmission(makeSnapshot('sub3', 'ACTIVE'), 't3');

    const results = await store.getCurrentSubmissions(100, 'all');
    expect(results).toHaveLength(3);
    expect(results[0].submission_id).toBe('sub3');
    expect(results[2].submission_id).toBe('sub1');
  });

  it('filters by phase', async () => {
    await store.upsertSubmission(makeSnapshot('sub1', 'RESERVED'), 't1');
    await store.upsertSubmission(makeSnapshot('sub2', 'APPROVED'), 't2');

    const submitting = await store.getCurrentSubmissions(100, 'submitting');
    expect(submitting).toHaveLength(1);
    expect(submitting[0].submission_id).toBe('sub1');

    const submitted = await store.getCurrentSubmissions(100, 'submitted');
    expect(submitted).toHaveLength(1);
    expect(submitted[0].submission_id).toBe('sub2');
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await store.upsertSubmission(makeSnapshot(`sub${i}`, 'RESERVED'), `t${i}`);
    }

    const results = await store.getCurrentSubmissions(3, 'all');
    expect(results).toHaveLength(3);
  });

  it('secondary sort by submission_id DESC on tie', async () => {
    await store.upsertSubmission(makeSnapshot('a', 'RESERVED'), 't1');
    await store.upsertSubmission(makeSnapshot('b', 'ACTIVE'), 't1');
    await store.upsertSubmission(makeSnapshot('c', 'RESERVED'), 't1');

    const results = await store.getCurrentSubmissions(100, 'all');
    expect(results.map((r) => r.submission_id)).toEqual(['c', 'b', 'a']);
  });

  it('returns empty array when no submissions', async () => {
    const results = await store.getCurrentSubmissions(100, 'all');
    expect(results).toEqual([]);
  });
});

describe('importSubmissions', () => {
  function makeRecord(id: string) {
    return {
      submission_id: id,
      study_id: `study-${id}`,
      study_name: `Study ${id}`,
      participant_id: 'csv-import',
      status: 'APPROVED',
      phase: 'submitted' as const,
      payload: { started_at: '2026-01-01T10:00:00Z', completed_at: '2026-01-01T10:05:00Z' },
      observed_at: '2026-01-01T10:05:00Z',
      updated_at: '2026-01-01T10:05:00Z',
    };
  }

  it('adds all records when DB is empty', async () => {
    const summary = await store.importSubmissions([makeRecord('a'), makeRecord('b')]);
    expect(summary).toEqual({ added: 2, skipped_existing: 0, total: 2 });
    expect(await db.submissions.count()).toBe(2);
  });

  it('skips records whose submission_id already exists', async () => {
    await store.importSubmissions([makeRecord('a'), makeRecord('b')]);
    const summary = await store.importSubmissions([makeRecord('a'), makeRecord('c')]);
    expect(summary).toEqual({ added: 1, skipped_existing: 1, total: 2 });
    expect(await db.submissions.count()).toBe(3);
  });

  it('is a no-op on empty input', async () => {
    expect(await store.importSubmissions([])).toEqual({ added: 0, skipped_existing: 0, total: 0 });
  });

  it('does not overwrite an existing record when the same id re-appears', async () => {
    const original = { ...makeRecord('a'), study_name: 'Original' };
    await db.submissions.add(original);
    const changed = { ...makeRecord('a'), study_name: 'Changed in CSV' };
    await store.importSubmissions([changed]);
    const kept = await db.submissions.get('a');
    expect(kept?.study_name).toBe('Original');
  });

  it('skips CSV rows whose completion_code matches an existing submission', async () => {
    await db.submissions.add({
      ...makeRecord('live-1'),
      study_id: 'real-uuid-1',
      study_name: 'Widgets',
      payload: { started_at: '2026-01-01T10:00:00Z', completion_code: 'CABC1234' },
    });
    const csvDupe = {
      ...makeRecord('csv:CABC1234'),
      study_id: 'csv:widgets',
      study_name: 'Widgets',
      payload: { started_at: '2026-01-01T10:00:00Z', completion_code: 'CABC1234' },
    };
    const csvNew = {
      ...makeRecord('csv:CXYZ9999'),
      study_id: 'csv:other',
      study_name: 'Other',
      payload: { started_at: '2026-01-02T10:00:00Z', completion_code: 'CXYZ9999' },
    };
    const summary = await store.importSubmissions([csvDupe, csvNew]);
    expect(summary).toEqual({ added: 1, skipped_existing: 1, total: 2 });
    expect(await db.submissions.count()).toBe(2);
  });

  it('skips CSV rows whose completion_code matches a live submission\'s study_code', async () => {
    await db.submissions.add({
      ...makeRecord('live-1'),
      study_id: 'real-uuid-1',
      study_name: 'Widgets',
      payload: { started_at: '2026-01-01T10:00:00Z', study_code: 'CLIVECODE' },
    });
    const csvRow = {
      ...makeRecord('csv:CLIVECODE'),
      study_id: 'csv:widgets',
      study_name: 'Widgets',
      payload: { started_at: '2026-01-01T10:00:00Z', completion_code: 'CLIVECODE' },
    };
    const summary = await store.importSubmissions([csvRow]);
    expect(summary).toEqual({ added: 0, skipped_existing: 1, total: 1 });
    expect(await db.submissions.count()).toBe(1);
  });

  it('signature-dedupes a codeless CSV row against an existing live submission', async () => {
    await db.submissions.add({
      submission_id: 'live-1',
      study_id: 'real-uuid',
      study_name: 'Some Study',
      participant_id: 'p',
      status: 'RETURNED',
      phase: 'submitted',
      // Live payload — no study_code, microsecond timestamp.
      payload: {
        started_at: '2026-02-25T08:42:19.447000Z',
        submission_reward: { amount: 234, currency: 'USD' },
      },
      observed_at: '2026-02-25T08:42:19.447Z',
      updated_at: '2026-02-25T08:42:19.447Z',
    });
    const csvRow = {
      submission_id: 'csv:some-study:2026-02-25T08:42:19.447Z',
      study_id: 'csv:some-study',
      study_name: 'Some Study',
      participant_id: 'csv-import',
      status: 'RETURNED',
      phase: 'submitted' as const,
      payload: {
        started_at: '2026-02-25T08:42:19.447Z',
        submission_reward: { amount: 234, currency: 'USD' },
      },
      observed_at: '2026-02-25T08:42:19.447Z',
      updated_at: '2026-04-17T01:00:00.000Z',
    };
    const summary = await store.importSubmissions([csvRow]);
    expect(summary).toEqual({ added: 0, skipped_existing: 1, total: 1 });
  });

  it('dedupes duplicate completion_codes within a single import batch', async () => {
    const a = {
      ...makeRecord('csv:DUPE1'),
      payload: { started_at: '2026-01-01T10:00:00Z', completion_code: 'DUPE1' },
    };
    const b = {
      ...makeRecord('csv:DUPE1-other'),
      payload: { started_at: '2026-01-02T10:00:00Z', completion_code: 'DUPE1' },
    };
    const summary = await store.importSubmissions([a, b]);
    expect(summary).toEqual({ added: 1, skipped_existing: 1, total: 2 });
  });
});
