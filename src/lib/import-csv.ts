import type { SubmissionRecord } from './db';
import { normalizeSubmissionStatus, nowIso } from './format';

// ──────────────────────────────────────────────────────────────
// Currency-symbol prefix lookup. Order matters — match longer prefixes first.
// ──────────────────────────────────────────────────────────────
const SYMBOL_TO_CURRENCY: readonly [string, string][] = [
  ['CA$', 'CAD'],
  ['A$', 'AUD'],
  ['C$', 'CAD'],
  ['NZ$', 'NZD'],
  ['HK$', 'HKD'],
  ['S$', 'SGD'],
  ['R$', 'BRL'],
  ['kr', 'SEK'], // ambiguous (SEK/NOK/DKK); default SEK
  ['zł', 'PLN'],
  ['£', 'GBP'],
  ['€', 'EUR'],
  ['¥', 'JPY'],
  ['₹', 'INR'],
  ['₽', 'RUB'],
  ['$', 'USD'],
];

/** Parse a money cell like `$7.50`, `£2.67`, `CA$10.00`, `kr50,00`. Returns `null` if unparseable. */
export function parseMoneyCell(raw: string): { amount_minor: number; currency: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let currency = '';
  let rest = trimmed;
  for (const [symbol, code] of SYMBOL_TO_CURRENCY) {
    if (trimmed.startsWith(symbol)) {
      currency = code;
      rest = trimmed.slice(symbol.length);
      break;
    }
  }
  if (!currency) {
    // Maybe a trailing 3-letter code (e.g. "7.50 USD")
    const m = /^([\d.,\s]+)\s*([A-Z]{3})$/.exec(trimmed);
    if (!m) return null;
    rest = m[1];
    currency = m[2];
  }
  // Normalise European decimal commas → dots, drop spaces.
  const numeric = rest.replace(/\s/g, '').replace(/,(\d{1,2})$/, '.$1').replace(/,/g, '');
  const amount = Number(numeric);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return { amount_minor: Math.round(amount * 100), currency };
}

// ──────────────────────────────────────────────────────────────
// Minimal RFC-4180-ish CSV tokeniser.
// ──────────────────────────────────────────────────────────────
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ──────────────────────────────────────────────────────────────
// Date parsing. CSV timestamps are naive UTC (Prolific stores UTC).
// ──────────────────────────────────────────────────────────────
/** `2026-03-25 16:10:53.160000` → `2026-03-25T16:10:53.160Z`. Returns `null` if unparseable. */
export function parseCsvTimestamp(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  // Accept both space and 'T' separators; truncate >3 fractional digits.
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?/.exec(s);
  if (!match) return null;
  const [, date, time, frac = ''] = match;
  const ms = frac ? frac.slice(0, 3).padEnd(3, '0') : '000';
  const iso = `${date}T${time}.${ms}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : iso;
}

// ──────────────────────────────────────────────────────────────
// Main import
// ──────────────────────────────────────────────────────────────
export interface CsvImportResult {
  records: SubmissionRecord[];
  errors: { row: number; reason: string }[];
  /** Rows where the submission had no timestamps at all (skipped). */
  skippedNoTime: number;
}

export const CSV_IMPORT_SOURCE = 'csv-import';
export const CSV_SUBMISSION_ID_PREFIX = 'csv:';

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'unknown';
}

/** Parse a Prolific CSV export into SubmissionRecord[]. Never throws on per-row issues. */
export function parseProlificCsv(text: string): CsvImportResult {
  const rows = parseCsv(text);
  if (rows.length === 0) return { records: [], errors: [], skippedNoTime: 0 };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {
    study: header.indexOf('study'),
    reward: header.indexOf('reward'),
    bonus: header.indexOf('bonus'),
    startedAt: header.indexOf('started at'),
    completedAt: header.indexOf('completed at'),
    code: header.indexOf('completion code'),
    status: header.indexOf('status'),
  };
  if (idx.study < 0 || idx.reward < 0 || idx.status < 0) {
    return {
      records: [],
      errors: [{ row: 0, reason: 'Missing required column (Study, Reward, or Status)' }],
      skippedNoTime: 0,
    };
  }

  const out: SubmissionRecord[] = [];
  const errors: CsvImportResult['errors'] = [];
  let skippedNoTime = 0;
  const importedAt = nowIso();

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((c) => c.trim() === '')) continue;

    const studyName = (row[idx.study] ?? '').trim();
    if (!studyName) { errors.push({ row: r, reason: 'Missing study name' }); continue; }

    const status = normalizeSubmissionStatus(row[idx.status] ?? '');
    if (!status) { errors.push({ row: r, reason: 'Missing status' }); continue; }

    const reward = parseMoneyCell(row[idx.reward] ?? '');
    const bonus = idx.bonus >= 0 ? parseMoneyCell(row[idx.bonus] ?? '') : null;
    const startedAt = idx.startedAt >= 0 ? parseCsvTimestamp(row[idx.startedAt] ?? '') : null;
    const completedAt = idx.completedAt >= 0 ? parseCsvTimestamp(row[idx.completedAt] ?? '') : null;
    const completionCode = idx.code >= 0 ? (row[idx.code] ?? '').trim() : '';

    if (!startedAt && !completedAt) {
      skippedNoTime++;
      continue;
    }

    const payload: Record<string, unknown> = {
      study: { name: studyName },
      _source: CSV_IMPORT_SOURCE,
    };
    if (reward) payload.submission_reward = { amount: reward.amount_minor, currency: reward.currency };
    if (bonus && bonus.amount_minor > 0) {
      payload.bonus_payments = [{ amount: bonus.amount_minor, currency: bonus.currency }];
    }
    if (startedAt) payload.started_at = startedAt;
    // RETURNED/REJECTED submissions use returned_at; everything else uses completed_at.
    if (completedAt) {
      if (status === 'RETURNED' || status === 'REJECTED') payload.returned_at = completedAt;
      else payload.completed_at = completedAt;
    } else if (startedAt && (status === 'RETURNED' || status === 'REJECTED')) {
      // No completion time in CSV — fall back so the row still has a timestamp.
      payload.returned_at = startedAt;
    }
    if (completionCode) payload.completion_code = completionCode;

    const observedAt = completedAt ?? startedAt ?? importedAt;
    const submissionId = completionCode
      ? `${CSV_SUBMISSION_ID_PREFIX}${completionCode}`
      : `${CSV_SUBMISSION_ID_PREFIX}${slugify(studyName)}:${startedAt ?? completedAt ?? String(r)}`;

    out.push({
      submission_id: submissionId,
      study_id: `${CSV_SUBMISSION_ID_PREFIX}${slugify(studyName)}`,
      study_name: studyName,
      participant_id: CSV_IMPORT_SOURCE,
      status,
      phase: 'submitted',
      payload,
      observed_at: observedAt,
      updated_at: importedAt,
    });
  }

  return { records: out, errors, skippedNoTime };
}
