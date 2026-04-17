import { describe, it, expect } from 'vitest';
import {
  parseMoneyCell,
  parseCsvTimestamp,
  parseCsv,
  parseProlificCsv,
} from '../import-csv';
import { extractSubmissionReward, extractStartedAt, extractCompletedAt } from '../earnings';

// ── money ─────────────────────────────────────────────────────

describe('parseMoneyCell', () => {
  it('parses USD, GBP, EUR symbol prefixes', () => {
    expect(parseMoneyCell('$7.50')).toEqual({ amount_minor: 750, currency: 'USD' });
    expect(parseMoneyCell('£2.67')).toEqual({ amount_minor: 267, currency: 'GBP' });
    expect(parseMoneyCell('€4.20')).toEqual({ amount_minor: 420, currency: 'EUR' });
  });

  it('parses compound currency prefixes', () => {
    expect(parseMoneyCell('CA$10.00')).toEqual({ amount_minor: 1000, currency: 'CAD' });
    expect(parseMoneyCell('A$5.25')).toEqual({ amount_minor: 525, currency: 'AUD' });
  });

  it('handles trailing currency code', () => {
    expect(parseMoneyCell('7.50 USD')).toEqual({ amount_minor: 750, currency: 'USD' });
  });

  it('handles European decimal comma', () => {
    expect(parseMoneyCell('kr50,25')).toEqual({ amount_minor: 5025, currency: 'SEK' });
  });

  it('returns null for empty or unparseable input', () => {
    expect(parseMoneyCell('')).toBeNull();
    expect(parseMoneyCell('free')).toBeNull();
  });

  it('rejects negative values', () => {
    expect(parseMoneyCell('-$1.00')).toBeNull();
  });
});

// ── timestamps ────────────────────────────────────────────────

describe('parseCsvTimestamp', () => {
  it('converts naive timestamp with microseconds to UTC ISO', () => {
    expect(parseCsvTimestamp('2026-03-25 16:10:53.160000')).toBe('2026-03-25T16:10:53.160Z');
  });

  it('accepts timestamps without fractional seconds', () => {
    expect(parseCsvTimestamp('2026-03-25 16:10:53')).toBe('2026-03-25T16:10:53.000Z');
  });

  it('returns null for empty or invalid', () => {
    expect(parseCsvTimestamp('')).toBeNull();
    expect(parseCsvTimestamp('not a date')).toBeNull();
  });
});

// ── CSV tokeniser ─────────────────────────────────────────────

describe('parseCsv', () => {
  it('handles quoted fields with commas', () => {
    const rows = parseCsv('a,b,c\n"one, two",3,"x"\n');
    expect(rows).toEqual([['a', 'b', 'c'], ['one, two', '3', 'x']]);
  });

  it('handles doubled quotes as escape', () => {
    const rows = parseCsv('a\n"she said ""hi"""\n');
    expect(rows).toEqual([['a'], ['she said "hi"']]);
  });

  it('handles CRLF newlines', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([['a', 'b'], ['1', '2']]);
  });
});

// ── end-to-end on the real fixture shape ──────────────────────

describe('parseProlificCsv', () => {
  const fixture = `Study,Reward,Bonus,Started At,Completed At,Completion Code,Status
Project Atlas - LibreOffice Experience Study,$7.50,$0.00,2026-03-25 16:10:53.160000,2026-03-25 16:15:55.062000,CF5A4DW1,APPROVED
Image Matching Study,£2.67,£0.00,2026-03-25 02:52:58.886000,2026-03-25 02:58:41.890000,C1NBJPRN,APPROVED
Application usage study,$10.00,$0.00,2026-03-12 20:22:47.856000,2026-03-12 20:26:45.506000,CYCY4QY9,APPROVED
Production of Danish vowels,$6.00,$0.00,2026-02-27 23:21:20.237000,,,RETURNED
study about sustainability (3),£1.80,£0.00,,,,RETURNED
`;

  it('imports approved rows with full timestamps and currency', () => {
    const { records, errors, skippedNoTime } = parseProlificCsv(fixture);
    expect(errors).toEqual([]);
    expect(skippedNoTime).toBe(1); // "study about sustainability" has no times
    expect(records.length).toBe(4); // 3 approved + 1 returned-with-started-at

    const approved = records.filter((r) => r.status === 'APPROVED');
    expect(approved.length).toBe(3);

    const first = approved[0];
    const reward = extractSubmissionReward(first);
    expect(reward).toEqual({ amount: 750, currency: 'USD' });
    expect(extractStartedAt(first)?.toISOString()).toBe('2026-03-25T16:10:53.160Z');
    expect(extractCompletedAt(first)?.toISOString()).toBe('2026-03-25T16:15:55.062Z');
    expect(first.submission_id).toBe('csv:CF5A4DW1');
  });

  it('RETURNED row without completed_at uses started_at via extractCompletedAt fallback', () => {
    const { records } = parseProlificCsv(fixture);
    const returned = records.find((r) => r.status === 'RETURNED');
    expect(returned).toBeDefined();
    // returned_at in payload → extractCompletedAt returns the started_at we set
    expect(extractCompletedAt(returned!)).not.toBeNull();
  });

  it('generates deterministic submission_ids so re-imports dedupe cleanly', () => {
    const a = parseProlificCsv(fixture);
    const b = parseProlificCsv(fixture);
    expect(a.records.map((r) => r.submission_id)).toEqual(b.records.map((r) => r.submission_id));
  });

  it('falls back to synthesized id when completion code is empty', () => {
    const csv = `Study,Reward,Bonus,Started At,Completed At,Completion Code,Status
Anonymous study,$1.00,$0.00,2026-01-01 10:00:00,,,RETURNED
`;
    const { records } = parseProlificCsv(csv);
    expect(records.length).toBe(1);
    expect(records[0].submission_id).toMatch(/^csv:anonymous-study:/);
  });

  it('reports missing-column errors instead of crashing', () => {
    const { records, errors } = parseProlificCsv('wrong,header,shape\nfoo,bar,baz');
    expect(records).toEqual([]);
    expect(errors.length).toBe(1);
    expect(errors[0].reason).toMatch(/column/i);
  });

  it('captures bonus when non-zero', () => {
    const csv = `Study,Reward,Bonus,Started At,Completed At,Completion Code,Status
Bonus study,$5.00,$2.50,2026-01-01 10:00:00,2026-01-01 10:30:00,CODE1,APPROVED
`;
    const { records } = parseProlificCsv(csv);
    const payload = records[0].payload as { bonus_payments?: { amount: number; currency: string }[] };
    expect(payload.bonus_payments).toEqual([{ amount: 250, currency: 'USD' }]);
  });

  it('skips rows with no timestamps at all', () => {
    const csv = `Study,Reward,Bonus,Started At,Completed At,Completion Code,Status
No-times study,$1.00,$0.00,,,,RETURNED
`;
    const { records, skippedNoTime } = parseProlificCsv(csv);
    expect(records).toEqual([]);
    expect(skippedNoTime).toBe(1);
  });
});
