import type { SubmissionRecord } from './db';
import { normalizeSubmissionStatus, parseDate } from './format';
import {
  APPROVED_STATUS,
  AWAITING_REVIEW_STATUS,
  RETURNED_STATUS,
  REJECTED_STATUS,
  SCREENED_OUT_STATUS,
  extractStartedAt,
  extractCompletedAt,
} from './earnings';

export type StatusCategory = 'approved' | 'awaiting_review' | 'returned' | 'rejected' | 'screened_out' | 'other';

export interface StatusCounts {
  approved: number;
  awaiting_review: number;
  returned: number;
  rejected: number;
  screened_out: number;
  other: number;
  total: number;
}

export interface StatusStats extends StatusCounts {
  approval_rate: number;
  rejection_rate: number;
  return_rate: number;
}

export function categorizeStatus(status: string): StatusCategory {
  const upper = normalizeSubmissionStatus(status);
  switch (upper) {
    case APPROVED_STATUS: return 'approved';
    case AWAITING_REVIEW_STATUS: return 'awaiting_review';
    case RETURNED_STATUS: return 'returned';
    case REJECTED_STATUS: return 'rejected';
    case SCREENED_OUT_STATUS: return 'screened_out';
    default: return 'other';
  }
}

export function statusCategoryLabel(cat: StatusCategory): string {
  switch (cat) {
    case 'approved': return 'Approved';
    case 'awaiting_review': return 'Awaiting review';
    case 'returned': return 'Returned';
    case 'rejected': return 'Rejected';
    case 'screened_out': return 'Screened out';
    case 'other': return 'Other';
  }
}

export function statusCategoryColorClass(cat: StatusCategory): string {
  switch (cat) {
    case 'approved': return 'text-emerald-600 dark:text-emerald-400';
    case 'awaiting_review': return 'text-amber-600 dark:text-amber-400';
    case 'returned': return 'text-rose-600 dark:text-rose-400';
    case 'rejected': return 'text-rose-600 dark:text-rose-400';
    case 'screened_out': return 'text-orange-600 dark:text-orange-400';
    case 'other': return 'text-base-content/50';
  }
}

export function statusColorClass(status: string): string {
  return statusCategoryColorClass(categorizeStatus(status));
}

export function computeStatusCounts(submissions: SubmissionRecord[]): StatusCounts {
  const counts: StatusCounts = {
    approved: 0,
    awaiting_review: 0,
    returned: 0,
    rejected: 0,
    screened_out: 0,
    other: 0,
    total: 0,
  };

  for (const s of submissions) {
    if (s.phase !== 'submitted') continue;
    const cat = categorizeStatus(s.status);
    counts[cat]++;
    counts.total++;
  }

  return counts;
}

export function computeStatusStats(submissions: SubmissionRecord[]): StatusStats {
  const counts = computeStatusCounts(submissions);
  const terminal = counts.approved + counts.returned + counts.rejected + counts.screened_out;

  return {
    ...counts,
    approval_rate: terminal > 0 ? counts.approved / terminal : 0,
    rejection_rate: terminal > 0 ? counts.rejected / terminal : 0,
    return_rate: terminal > 0 ? counts.returned / terminal : 0,
  };
}

export interface TimeToApprovalStats {
  count: number;
  mean_seconds: number;
  median_seconds: number;
  min_seconds: number;
  max_seconds: number;
}

export function computeTimeToApproval(submissions: SubmissionRecord[]): TimeToApprovalStats | null {
  const durations: number[] = [];

  for (const s of submissions) {
    if (s.phase !== 'submitted') continue;
    if (categorizeStatus(s.status) !== 'approved') continue;

    const started = extractStartedAt(s);
    const completed = extractCompletedAt(s);
    if (!started || !completed) continue;

    const seconds = (completed.getTime() - started.getTime()) / 1000;
    if (seconds > 0 && seconds < 86400 * 30) durations.push(seconds);
  }

  if (durations.length === 0) return null;

  durations.sort((a, b) => a - b);
  const sum = durations.reduce((a, b) => a + b, 0);

  return {
    count: durations.length,
    mean_seconds: sum / durations.length,
    median_seconds: durations[Math.floor(durations.length / 2)],
    min_seconds: durations[0],
    max_seconds: durations[durations.length - 1],
  };
}

export interface RejectionDetails {
  return_reason: string | null;
  rejection_message: string | null;
  rejection_category: string | null;
  researcher_message: string | null;
}

export function extractRejectionDetails(payload: unknown): RejectionDetails {
  const p = payload as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') {
    return { return_reason: null, rejection_message: null, rejection_category: null, researcher_message: null };
  }

  const extract = (key: string): string | null => {
    const v = p[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
    return null;
  };

  return {
    return_reason: extract('return_reason') || extract('rejection_reason'),
    rejection_message: extract('rejection_message') || extract('message'),
    rejection_category: extract('rejection_category') || extract('rejection_type'),
    researcher_message: extract('researcher_message') || extract('feedback'),
  };
}

export function hasRejectionDetails(details: RejectionDetails): boolean {
  return !!(details.return_reason || details.rejection_message || details.rejection_category || details.researcher_message);
}

export interface ResearcherOption {
  id: string;
  name: string;
  count: number;
}

export function extractResearcherOptions(submissions: SubmissionRecord[]): ResearcherOption[] {
  const map = new Map<string, { name: string; count: number }>();

  for (const s of submissions) {
    const p = s.payload as Record<string, unknown> | undefined;
    const study = p?.study as Record<string, unknown> | undefined;
    const researcher = study?.researcher as Record<string, unknown> | undefined;

    const id = String(researcher?.id ?? '').trim();
    if (!id) continue;

    const name = String(researcher?.name ?? '').trim() || id;
    const existing = map.get(id);
    if (existing) {
      existing.count++;
    } else {
      map.set(id, { name, count: 1 });
    }
  }

  return [...map.entries()]
    .map(([id, { name, count }]) => ({ id, name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export interface DateRange {
  start: Date | null;
  end: Date | null;
}

export function filterSubmissionsByDateRange(
  submissions: SubmissionRecord[],
  range: DateRange,
): SubmissionRecord[] {
  if (!range.start && !range.end) return submissions;

  return submissions.filter((s) => {
    const d = parseDate(s.observed_at);
    if (!d) return false;
    if (range.start && d < range.start) return false;
    if (range.end && d > range.end) return false;
    return true;
  });
}

export function filterSubmissionsByResearcher(
  submissions: SubmissionRecord[],
  researcherId: string | null,
): SubmissionRecord[] {
  if (!researcherId) return submissions;

  return submissions.filter((s) => {
    const p = s.payload as Record<string, unknown> | undefined;
    const study = p?.study as Record<string, unknown> | undefined;
    const researcher = study?.researcher as Record<string, unknown> | undefined;
    const id = String(researcher?.id ?? '').trim();
    return id === researcherId;
  });
}

export interface SubmissionMeta {
  researcher_country: string | null;
  institution_name: string | null;
  study_code: string | null;
  is_trial: boolean;
  bonuses: { amount: number; currency: string }[];
}

export function extractSubmissionMeta(payload: unknown): SubmissionMeta {
  const p = payload as Record<string, unknown> | undefined;
  const study = p?.study as Record<string, unknown> | undefined;
  const researcher = study?.researcher as Record<string, unknown> | undefined;
  const institution = researcher?.institution as Record<string, unknown> | undefined;

  const bonuses: { amount: number; currency: string }[] = [];
  const rawBonuses = p?.submission_bonuses;
  if (Array.isArray(rawBonuses)) {
    for (const b of rawBonuses) {
      if (b && typeof b === 'object' && 'amount' in b && 'currency' in b) {
        const amount = Number((b as Record<string, unknown>).amount);
        const currency = String((b as Record<string, unknown>).currency ?? '');
        if (Number.isFinite(amount) && amount > 0 && currency) {
          bonuses.push({ amount, currency });
        }
      }
    }
  }

  return {
    researcher_country: typeof researcher?.country === 'string' && researcher.country.trim() ? researcher.country.trim() : null,
    institution_name: typeof institution?.name === 'string' && institution.name.trim() ? institution.name.trim() : null,
    study_code: typeof p?.study_code === 'string' && p.study_code.trim() ? p.study_code.trim() : null,
    is_trial: study?.is_trial_study === true,
    bonuses,
  };
}

export function hasSubmissionMeta(meta: SubmissionMeta): boolean {
  return !!(meta.researcher_country || meta.institution_name || meta.study_code || meta.is_trial || meta.bonuses.length);
}
