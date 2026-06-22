import { describe, it, expect } from 'vitest';
import type { SubmissionRecord } from '../db';
import {
  categorizeStatus,
  computeStatusCounts,
  computeStatusStats,
  extractRejectionDetails,
  hasRejectionDetails,
  extractResearcherOptions,
  filterSubmissionsByDateRange,
  filterSubmissionsByResearcher,
  statusCategoryColorClass,
} from '../submission-analytics';

function makeSubmission(
  overrides: Partial<SubmissionRecord> = {},
): SubmissionRecord {
  return {
    submission_id: 'sub-1',
    study_id: 'study-1',
    study_name: 'Test Study',
    participant_id: 'part-1',
    status: 'APPROVED',
    phase: 'submitted',
    payload: {},
    observed_at: '2025-01-15T12:00:00Z',
    updated_at: '2025-01-15T12:00:00Z',
    ...overrides,
  };
}

describe('categorizeStatus', () => {
  it('categorizes APPROVED', () => {
    expect(categorizeStatus('APPROVED')).toBe('approved');
    expect(categorizeStatus('approved')).toBe('approved');
  });

  it('categorizes AWAITING REVIEW', () => {
    expect(categorizeStatus('AWAITING REVIEW')).toBe('awaiting_review');
    expect(categorizeStatus('awaiting review')).toBe('awaiting_review');
  });

  it('categorizes terminal negative statuses', () => {
    expect(categorizeStatus('RETURNED')).toBe('returned');
    expect(categorizeStatus('REJECTED')).toBe('rejected');
    expect(categorizeStatus('SCREENED OUT')).toBe('screened_out');
  });

  it('categorizes unknown as other', () => {
    expect(categorizeStatus('UNKNOWN')).toBe('other');
    expect(categorizeStatus('')).toBe('other');
  });
});

describe('statusCategoryColorClass', () => {
  it('returns color classes', () => {
    expect(statusCategoryColorClass('approved')).toContain('emerald');
    expect(statusCategoryColorClass('rejected')).toContain('rose');
    expect(statusCategoryColorClass('awaiting_review')).toContain('amber');
  });
});

describe('computeStatusCounts', () => {
  it('counts submissions by status', () => {
    const subs: SubmissionRecord[] = [
      makeSubmission({ submission_id: '1', status: 'APPROVED' }),
      makeSubmission({ submission_id: '2', status: 'APPROVED' }),
      makeSubmission({ submission_id: '3', status: 'AWAITING REVIEW' }),
      makeSubmission({ submission_id: '4', status: 'REJECTED' }),
      makeSubmission({ submission_id: '5', status: 'RETURNED' }),
      makeSubmission({ submission_id: '6', status: 'SCREENED OUT' }),
    ];

    const counts = computeStatusCounts(subs);

    expect(counts.approved).toBe(2);
    expect(counts.awaiting_review).toBe(1);
    expect(counts.rejected).toBe(1);
    expect(counts.returned).toBe(1);
    expect(counts.screened_out).toBe(1);
    expect(counts.total).toBe(6);
  });

  it('excludes submitting phase', () => {
    const subs: SubmissionRecord[] = [
      makeSubmission({ submission_id: '1', status: 'APPROVED', phase: 'submitted' }),
      makeSubmission({ submission_id: '2', status: 'ACTIVE', phase: 'submitting' }),
    ];

    const counts = computeStatusCounts(subs);
    expect(counts.total).toBe(1);
  });
});

describe('computeStatusStats', () => {
  it('computes approval rate from terminal submissions', () => {
    const subs: SubmissionRecord[] = [
      makeSubmission({ submission_id: '1', status: 'APPROVED' }),
      makeSubmission({ submission_id: '2', status: 'APPROVED' }),
      makeSubmission({ submission_id: '3', status: 'APPROVED' }),
      makeSubmission({ submission_id: '4', status: 'REJECTED' }),
      makeSubmission({ submission_id: '5', status: 'AWAITING REVIEW' }),
    ];

    const stats = computeStatusStats(subs);

    expect(stats.approval_rate).toBe(0.75);
    expect(stats.rejection_rate).toBe(0.25);
  });

  it('handles empty array', () => {
    const stats = computeStatusStats([]);
    expect(stats.approval_rate).toBe(0);
    expect(stats.total).toBe(0);
  });
});

describe('extractRejectionDetails', () => {
  it('extracts return_reason', () => {
    const payload = { return_reason: 'Did not follow instructions' };
    const details = extractRejectionDetails(payload);
    expect(details.return_reason).toBe('Did not follow instructions');
  });

  it('extracts rejection_message', () => {
    const payload = { rejection_message: 'Failed attention check' };
    const details = extractRejectionDetails(payload);
    expect(details.rejection_message).toBe('Failed attention check');
  });

  it('falls back to alternative field names', () => {
    const payload = { rejection_reason: 'Bad data' };
    const details = extractRejectionDetails(payload);
    expect(details.return_reason).toBe('Bad data');
  });

  it('returns nulls for missing fields', () => {
    const details = extractRejectionDetails({});
    expect(details.return_reason).toBeNull();
    expect(details.rejection_message).toBeNull();
  });
});

describe('hasRejectionDetails', () => {
  it('returns true when details present', () => {
    expect(hasRejectionDetails({ return_reason: 'x', rejection_message: null, rejection_category: null, researcher_message: null })).toBe(true);
  });

  it('returns false when all null', () => {
    expect(hasRejectionDetails({ return_reason: null, rejection_message: null, rejection_category: null, researcher_message: null })).toBe(false);
  });
});

describe('extractResearcherOptions', () => {
  it('extracts unique researchers with counts', () => {
    const subs: SubmissionRecord[] = [
      makeSubmission({
        submission_id: '1',
        payload: { study: { researcher: { id: 'r1', name: 'Alice Lab' } } },
      }),
      makeSubmission({
        submission_id: '2',
        payload: { study: { researcher: { id: 'r1', name: 'Alice Lab' } } },
      }),
      makeSubmission({
        submission_id: '3',
        payload: { study: { researcher: { id: 'r2', name: 'Bob Research' } } },
      }),
    ];

    const opts = extractResearcherOptions(subs);

    expect(opts).toHaveLength(2);
    expect(opts[0]).toEqual({ id: 'r1', name: 'Alice Lab', count: 2 });
    expect(opts[1]).toEqual({ id: 'r2', name: 'Bob Research', count: 1 });
  });
});

describe('filterSubmissionsByDateRange', () => {
  const subs: SubmissionRecord[] = [
    makeSubmission({ submission_id: '1', observed_at: '2025-01-10T12:00:00Z' }),
    makeSubmission({ submission_id: '2', observed_at: '2025-01-15T12:00:00Z' }),
    makeSubmission({ submission_id: '3', observed_at: '2025-01-20T12:00:00Z' }),
  ];

  it('filters by start date', () => {
    const result = filterSubmissionsByDateRange(subs, {
      start: new Date('2025-01-14'),
      end: null,
    });
    expect(result).toHaveLength(2);
  });

  it('filters by end date', () => {
    const result = filterSubmissionsByDateRange(subs, {
      start: null,
      end: new Date('2025-01-16'),
    });
    expect(result).toHaveLength(2);
  });

  it('filters by both dates', () => {
    const result = filterSubmissionsByDateRange(subs, {
      start: new Date('2025-01-14'),
      end: new Date('2025-01-16'),
    });
    expect(result).toHaveLength(1);
  });

  it('returns all when no range', () => {
    const result = filterSubmissionsByDateRange(subs, { start: null, end: null });
    expect(result).toHaveLength(3);
  });
});

describe('filterSubmissionsByResearcher', () => {
  const subs: SubmissionRecord[] = [
    makeSubmission({
      submission_id: '1',
      payload: { study: { researcher: { id: 'r1', name: 'Alice' } } },
    }),
    makeSubmission({
      submission_id: '2',
      payload: { study: { researcher: { id: 'r2', name: 'Bob' } } },
    }),
  ];

  it('filters by researcher id', () => {
    const result = filterSubmissionsByResearcher(subs, 'r1');
    expect(result).toHaveLength(1);
    expect(result[0].submission_id).toBe('1');
  });

  it('returns all when null', () => {
    const result = filterSubmissionsByResearcher(subs, null);
    expect(result).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────────
// Adversarial tests: hostile inputs that shouldn't crash
// ────────────────────────────────────────────────────────────────

describe('adversarial: computeStatusStats edge cases', () => {
  it('handles only pending submissions (0 terminal → no div by zero)', () => {
    const subs: SubmissionRecord[] = [
      makeSubmission({ submission_id: '1', status: 'AWAITING REVIEW' }),
      makeSubmission({ submission_id: '2', status: 'AWAITING REVIEW' }),
    ];
    const stats = computeStatusStats(subs);
    expect(stats.approval_rate).toBe(0);
    expect(stats.rejection_rate).toBe(0);
    expect(Number.isFinite(stats.approval_rate)).toBe(true);
  });

  it('handles weird status casing/whitespace', () => {
    const subs: SubmissionRecord[] = [
      makeSubmission({ submission_id: '1', status: '  approved  ' }),
      makeSubmission({ submission_id: '2', status: 'APPROVED' }),
      makeSubmission({ submission_id: '3', status: 'Approved' }),
    ];
    const stats = computeStatusStats(subs);
    expect(stats.approved).toBe(3);
  });

  it('handles unknown status gracefully', () => {
    const subs: SubmissionRecord[] = [
      makeSubmission({ submission_id: '1', status: 'UNKNOWN_STATUS_XYZ' }),
      makeSubmission({ submission_id: '2', status: '' }),
    ];
    const stats = computeStatusStats(subs);
    expect(stats.other).toBe(2);
    expect(stats.total).toBe(2);
  });
});

describe('adversarial: extractRejectionDetails with hostile payloads', () => {
  it('handles null payload', () => {
    const details = extractRejectionDetails(null);
    expect(details.return_reason).toBeNull();
  });

  it('handles non-object payload', () => {
    const details = extractRejectionDetails('not an object');
    expect(details.return_reason).toBeNull();
  });

  it('handles nested null values', () => {
    const details = extractRejectionDetails({
      return_reason: null,
      rejection_message: undefined,
    });
    expect(details.return_reason).toBeNull();
    expect(details.rejection_message).toBeNull();
  });

  it('handles whitespace-only strings', () => {
    const details = extractRejectionDetails({
      return_reason: '   ',
      rejection_message: '\t\n',
    });
    expect(details.return_reason).toBeNull();
    expect(details.rejection_message).toBeNull();
  });
});

describe('adversarial: extractResearcherOptions with bad data', () => {
  it('handles missing researcher object', () => {
    const subs: SubmissionRecord[] = [
      makeSubmission({ submission_id: '1', payload: { study: {} } }),
      makeSubmission({ submission_id: '2', payload: {} }),
    ];
    const opts = extractResearcherOptions(subs);
    expect(opts).toHaveLength(0);
  });

  it('handles empty researcher id', () => {
    const subs: SubmissionRecord[] = [
      makeSubmission({
        submission_id: '1',
        payload: { study: { researcher: { id: '', name: 'Test' } } },
      }),
    ];
    const opts = extractResearcherOptions(subs);
    expect(opts).toHaveLength(0);
  });

  it('handles whitespace researcher id', () => {
    const subs: SubmissionRecord[] = [
      makeSubmission({
        submission_id: '1',
        payload: { study: { researcher: { id: '  ', name: 'Test' } } },
      }),
    ];
    const opts = extractResearcherOptions(subs);
    expect(opts).toHaveLength(0);
  });
});

describe('adversarial: filterSubmissionsByDateRange edge cases', () => {
  it('handles submissions with invalid observed_at', () => {
    const subs: SubmissionRecord[] = [
      makeSubmission({ submission_id: '1', observed_at: 'not-a-date' }),
      makeSubmission({ submission_id: '2', observed_at: '' }),
      makeSubmission({ submission_id: '3', observed_at: '2025-01-15T12:00:00Z' }),
    ];
    const result = filterSubmissionsByDateRange(subs, {
      start: new Date('2025-01-14'),
      end: new Date('2025-01-16'),
    });
    expect(result).toHaveLength(1);
    expect(result[0].submission_id).toBe('3');
  });
});

describe('adversarial: categorizeStatus edge cases', () => {
  it('handles null-ish input without crashing', () => {
    expect(categorizeStatus('')).toBe('other');
  });
});
