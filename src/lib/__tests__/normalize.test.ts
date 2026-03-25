import { describe, it, expect } from 'vitest';
import {
  normalizeStudy,
  normalizeStudiesResponse,
  normalizeSubmissionSnapshot,
  submissionPhaseFromStatus,
} from '../normalize';

describe('normalizeStudy', () => {
  it('flattens study_reward to reward', () => {
    const raw = { id: 's1', name: 'Test', study_reward: { amount: 2.5, currency: 'GBP' } };
    const study = normalizeStudy(raw);
    expect(study.reward).toEqual({ amount: 2.5, currency: 'GBP' });
  });

  it('flattens study_average_reward_per_hour to average_reward_per_hour', () => {
    const raw = { id: 's1', name: 'Test', study_average_reward_per_hour: { amount: 10, currency: 'GBP' } };
    const study = normalizeStudy(raw);
    expect(study.average_reward_per_hour).toEqual({ amount: 10, currency: 'GBP' });
  });

  it('falls back to reward if study_reward is absent', () => {
    const raw = { id: 's1', name: 'Test', reward: { amount: 3.0, currency: 'USD' } };
    const study = normalizeStudy(raw);
    expect(study.reward).toEqual({ amount: 3.0, currency: 'USD' });
  });

  it('flattens submissions_config.max_submissions_per_participant', () => {
    const raw = { id: 's1', name: 'Test', submissions_config: { max_submissions_per_participant: 5 } };
    const study = normalizeStudy(raw);
    expect(study.max_submissions_per_participant).toBe(5);
  });

  it('falls back to top-level max_submissions_per_participant', () => {
    const raw = { id: 's1', name: 'Test', max_submissions_per_participant: 3 };
    const study = normalizeStudy(raw);
    expect(study.max_submissions_per_participant).toBe(3);
  });

  it('flattens pii.enabled to pii_enabled', () => {
    const raw = { id: 's1', name: 'Test', pii: { enabled: true } };
    const study = normalizeStudy(raw);
    expect(study.pii_enabled).toBe(true);
  });

  it('falls back to top-level pii_enabled', () => {
    const raw = { id: 's1', name: 'Test', pii_enabled: true };
    const study = normalizeStudy(raw);
    expect(study.pii_enabled).toBe(true);
  });

  it('computes places_available from total - taken', () => {
    const raw = { id: 's1', name: 'Test', total_available_places: 100, places_taken: 30 };
    const study = normalizeStudy(raw);
    expect(study.places_available).toBe(70);
  });

  it('clamps places_available to 0 when negative', () => {
    const raw = { id: 's1', name: 'Test', total_available_places: 10, places_taken: 20 };
    const study = normalizeStudy(raw);
    expect(study.places_available).toBe(0);
  });

  it('defaults missing fields to safe values', () => {
    const study = normalizeStudy({});
    expect(study.id).toBe('');
    expect(study.name).toBe('');
    expect(study.reward).toEqual({ amount: 0, currency: '' });
    expect(study.places_available).toBe(0);
    expect(study.device_compatibility).toEqual([]);
    expect(study.study_labels).toEqual([]);
    expect(study.is_confidential).toBe(false);
    expect(study.pii_enabled).toBe(false);
  });

  it('extracts researcher fields', () => {
    const raw = { id: 's1', name: 'Test', researcher: { id: 'r1', name: 'Dr. Test', country: 'UK' } };
    const study = normalizeStudy(raw);
    expect(study.researcher).toEqual({ id: 'r1', name: 'Dr. Test', country: 'UK' });
  });

  it('filters non-string values from string arrays', () => {
    const raw = { id: 's1', name: 'Test', device_compatibility: ['desktop', 42, null, 'mobile'] };
    const study = normalizeStudy(raw);
    expect(study.device_compatibility).toEqual(['desktop', 'mobile']);
  });
});

describe('normalizeStudiesResponse', () => {
  it('normalizes all studies in results array', () => {
    const body = {
      results: [
        { id: 's1', name: 'Study 1', study_reward: { amount: 1, currency: 'GBP' }, total_available_places: 10, places_taken: 5 },
        { id: 's2', name: 'Study 2', study_reward: { amount: 2, currency: 'GBP' }, total_available_places: 20, places_taken: 0 },
      ],
    };
    const studies = normalizeStudiesResponse(body);
    expect(studies).toHaveLength(2);
    expect(studies[0].reward.amount).toBe(1);
    expect(studies[0].places_available).toBe(5);
    expect(studies[1].places_available).toBe(20);
  });

  it('throws on non-object body', () => {
    expect(() => normalizeStudiesResponse(null)).toThrow('not an object');
    expect(() => normalizeStudiesResponse('string')).toThrow('not an object');
  });

  it('throws on missing results array', () => {
    expect(() => normalizeStudiesResponse({})).toThrow('missing results');
    expect(() => normalizeStudiesResponse({ results: 'not array' })).toThrow('missing results');
  });

  it('handles empty results', () => {
    const studies = normalizeStudiesResponse({ results: [] });
    expect(studies).toEqual([]);
  });
});

describe('submissionPhaseFromStatus', () => {
  it('maps RESERVED to submitting', () => {
    expect(submissionPhaseFromStatus('RESERVED')).toBe('submitting');
  });

  it('maps ACTIVE to submitting', () => {
    expect(submissionPhaseFromStatus('ACTIVE')).toBe('submitting');
  });

  it('maps AWAITING REVIEW to submitted', () => {
    expect(submissionPhaseFromStatus('AWAITING REVIEW')).toBe('submitted');
  });

  it('maps APPROVED to submitted', () => {
    expect(submissionPhaseFromStatus('APPROVED')).toBe('submitted');
  });

  it('maps RETURNED to submitted', () => {
    expect(submissionPhaseFromStatus('RETURNED')).toBe('submitted');
  });

  it('maps SCREENED OUT to submitted', () => {
    expect(submissionPhaseFromStatus('SCREENED OUT')).toBe('submitted');
  });

  it('handles underscores in status', () => {
    expect(submissionPhaseFromStatus('AWAITING_REVIEW')).toBe('submitted');
    expect(submissionPhaseFromStatus('screened_out')).toBe('submitted');
  });

  it('handles hyphens in status', () => {
    expect(submissionPhaseFromStatus('AWAITING-REVIEW')).toBe('submitted');
  });

  it('defaults unknown statuses to submitting', () => {
    expect(submissionPhaseFromStatus('UNKNOWN')).toBe('submitting');
    expect(submissionPhaseFromStatus('')).toBe('submitting');
  });

  it('is case-insensitive', () => {
    expect(submissionPhaseFromStatus('reserved')).toBe('submitting');
    expect(submissionPhaseFromStatus('Approved')).toBe('submitted');
  });
});

describe('normalizeSubmissionSnapshot', () => {
  it('extracts basic fields', () => {
    const body = { id: 'sub1', status: 'RESERVED', participant_id: 'p1', study_id: 'st1', study: { name: 'Test' } };
    const snapshot = normalizeSubmissionSnapshot(body);
    expect(snapshot.submission_id).toBe('sub1');
    expect(snapshot.status).toBe('RESERVED');
    expect(snapshot.phase).toBe('submitting');
    expect(snapshot.participant_id).toBe('p1');
    expect(snapshot.study_id).toBe('st1');
    expect(snapshot.study_name).toBe('Test');
  });

  it('falls back to study.id when study_id is empty', () => {
    const body = { id: 'sub1', status: 'ACTIVE', study: { id: 'st2', name: 'Test' } };
    const snapshot = normalizeSubmissionSnapshot(body);
    expect(snapshot.study_id).toBe('st2');
  });

  it('falls back to participant when participant_id is empty', () => {
    const body = { id: 'sub1', status: 'ACTIVE', participant: 'p2', study: { name: 'Test' } };
    const snapshot = normalizeSubmissionSnapshot(body);
    expect(snapshot.participant_id).toBe('p2');
  });

  it('defaults study_id to unknown', () => {
    const body = { id: 'sub1', status: 'ACTIVE', study: { name: 'Test' } };
    const snapshot = normalizeSubmissionSnapshot(body);
    expect(snapshot.study_id).toBe('unknown');
  });

  it('defaults study_name to Unknown Study', () => {
    const body = { id: 'sub1', status: 'ACTIVE' };
    const snapshot = normalizeSubmissionSnapshot(body);
    expect(snapshot.study_name).toBe('Unknown Study');
  });

  it('throws on missing id', () => {
    expect(() => normalizeSubmissionSnapshot({ status: 'ACTIVE' })).toThrow('missing id');
  });

  it('throws on missing status', () => {
    expect(() => normalizeSubmissionSnapshot({ id: 'sub1' })).toThrow('missing status');
  });

  it('throws on non-object body', () => {
    expect(() => normalizeSubmissionSnapshot(null)).toThrow();
  });

  it('normalizes status with underscores', () => {
    const body = { id: 'sub1', status: 'awaiting_review', study: { name: 'Test' } };
    const snapshot = normalizeSubmissionSnapshot(body);
    expect(snapshot.status).toBe('AWAITING REVIEW');
    expect(snapshot.phase).toBe('submitted');
  });

  it('extracts study_id from study_url as fallback', () => {
    const body = {
      id: 'sub1',
      status: 'ACTIVE',
      study: { name: 'Test' },
      study_url: 'https://example.com/study?STUDY_ID=abc123',
    };
    const snapshot = normalizeSubmissionSnapshot(body);
    expect(snapshot.study_id).toBe('abc123');
  });

  it('extracts fields from participant list item', () => {
    const item = {
      id: 'sub1',
      status: 'APPROVED',
      participant_id: 'p1',
      study: { id: 'st1', name: 'Study X' },
    };
    const snapshot = normalizeSubmissionSnapshot(item);
    expect(snapshot.submission_id).toBe('sub1');
    expect(snapshot.status).toBe('APPROVED');
    expect(snapshot.phase).toBe('submitted');
    expect(snapshot.study_id).toBe('st1');
    expect(snapshot.study_name).toBe('Study X');
  });
});
