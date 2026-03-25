import type { Study, Money, Researcher } from './types';
import { normalizeSubmissionStatus } from './format';

// Phase mapping: matches Go submissionStatusPhase map in stores.go
const SUBMISSION_STATUS_PHASE: Record<string, 'submitting' | 'submitted'> = {
  'RESERVED': 'submitting',
  'ACTIVE': 'submitting',
  'AWAITING REVIEW': 'submitted',
  'APPROVED': 'submitted',
  'REJECTED': 'submitted',
  'SCREENED OUT': 'submitted',
  'RETURNED': 'submitted',
};

export function submissionPhaseFromStatus(status: string): 'submitting' | 'submitted' {
  const normalized = normalizeSubmissionStatus(status);
  return SUBMISSION_STATUS_PHASE[normalized] ?? 'submitting';
}

// Study normalization: port of normalizeStudiesResponse from studies_parser.go

function extractMoney(raw: unknown): Money {
  if (raw && typeof raw === 'object') {
    const m = raw as Record<string, unknown>;
    return {
      amount: typeof m.amount === 'number' ? m.amount : 0,
      currency: typeof m.currency === 'string' ? m.currency : '',
    };
  }
  return { amount: 0, currency: '' };
}

function extractResearcher(raw: unknown): Researcher {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    return {
      id: typeof r.id === 'string' ? r.id : '',
      name: typeof r.name === 'string' ? r.name : '',
      country: typeof r.country === 'string' ? r.country : '',
    };
  }
  return { id: '', name: '', country: '' };
}

function extractStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Normalize a raw Prolific API study object into the flattened Study shape.
 * Matches the Go normalizeStudiesResponse logic in studies_parser.go.
 */
export function normalizeStudy(raw: Record<string, unknown>): Study {
  const totalAvailablePlaces = typeof raw.total_available_places === 'number' ? raw.total_available_places : 0;
  const placesTaken = typeof raw.places_taken === 'number' ? raw.places_taken : 0;
  const placesAvailable = Math.max(0, totalAvailablePlaces - placesTaken);

  const submissionsConfig = raw.submissions_config as Record<string, unknown> | undefined;
  const pii = raw.pii as Record<string, unknown> | undefined;

  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    name: typeof raw.name === 'string' ? raw.name : '',
    study_type: typeof raw.study_type === 'string' ? raw.study_type : '',
    date_created: typeof raw.date_created === 'string' ? raw.date_created : '',
    published_at: typeof raw.published_at === 'string' ? raw.published_at : '',
    total_available_places: totalAvailablePlaces,
    places_taken: placesTaken,
    places_available: placesAvailable,
    reward: extractMoney(raw.study_reward ?? raw.reward),
    average_reward_per_hour: extractMoney(raw.study_average_reward_per_hour ?? raw.average_reward_per_hour),
    max_submissions_per_participant: typeof submissionsConfig?.max_submissions_per_participant === 'number'
      ? submissionsConfig.max_submissions_per_participant
      : (typeof raw.max_submissions_per_participant === 'number' ? raw.max_submissions_per_participant : 0),
    researcher: extractResearcher(raw.researcher),
    description: typeof raw.description === 'string' ? raw.description : '',
    estimated_completion_time: typeof raw.estimated_completion_time === 'number' ? raw.estimated_completion_time : 0,
    device_compatibility: extractStringArray(raw.device_compatibility),
    peripheral_requirements: extractStringArray(raw.peripheral_requirements),
    maximum_allowed_time: typeof raw.maximum_allowed_time === 'number' ? raw.maximum_allowed_time : 0,
    average_completion_time_in_seconds: typeof raw.average_completion_time_in_seconds === 'number' ? raw.average_completion_time_in_seconds : 0,
    is_confidential: typeof raw.is_confidential === 'boolean' ? raw.is_confidential : false,
    is_ongoing_study: typeof raw.is_ongoing_study === 'boolean' ? raw.is_ongoing_study : false,
    submission_started_at: typeof raw.submission_started_at === 'string' ? raw.submission_started_at : null,
    pii_enabled: typeof pii?.enabled === 'boolean'
      ? pii.enabled
      : (typeof raw.pii_enabled === 'boolean' ? raw.pii_enabled : false),
    study_labels: extractStringArray(raw.study_labels),
    ai_inferred_study_labels: extractStringArray(raw.ai_inferred_study_labels),
    previous_submission_count: typeof raw.previous_submission_count === 'number' ? raw.previous_submission_count : 0,
  };
}

/**
 * Normalize a raw Prolific studies API response body.
 * Expects { results: [...] } shape.
 */
export function normalizeStudiesResponse(body: unknown): Study[] {
  if (!body || typeof body !== 'object') {
    throw new Error('studies payload is not an object');
  }
  const envelope = body as Record<string, unknown>;
  if (!Array.isArray(envelope.results)) {
    throw new Error('studies payload missing results array');
  }
  return (envelope.results as Record<string, unknown>[]).map(normalizeStudy);
}

// Submission normalization: port of normalizeSubmissionSnapshot from handlers.go

export interface SubmissionSnapshot {
  submission_id: string;
  study_id: string;
  study_name: string;
  participant_id: string;
  status: string;
  phase: 'submitting' | 'submitted';
  payload: Record<string, unknown>;
}

function parseStudyIDFromSubmissionURL(studyURL: string): string {
  try {
    const parsed = new URL(studyURL.trim());
    return parsed.searchParams.get('STUDY_ID')?.trim()
      || parsed.searchParams.get('study_id')?.trim()
      || '';
  } catch {
    return '';
  }
}

function buildSubmissionSnapshot(
  submissionID: string,
  status: string,
  participantID: string,
  studyID: string,
  studyName: string,
  payload: Record<string, unknown>,
): SubmissionSnapshot {
  submissionID = submissionID.trim();
  if (!submissionID) throw new Error('submission response missing id');

  status = normalizeSubmissionStatus(status);
  if (!status) throw new Error('submission response missing status');

  participantID = participantID.trim();
  studyID = studyID.trim() || 'unknown';
  studyName = studyName.trim() || 'Unknown Study';

  return {
    submission_id: submissionID,
    study_id: studyID,
    study_name: studyName,
    participant_id: participantID,
    status,
    phase: submissionPhaseFromStatus(status),
    payload: payload && typeof payload === 'object' ? payload : {},
  };
}

/**
 * Normalize a submission API response body (reserve, transition, or participant list item).
 * Handles both single submission responses and participant list items since they share the same shape.
 */
export function normalizeSubmissionSnapshot(body: unknown): SubmissionSnapshot {
  const parsed = body as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('submission response is not an object');
  }

  let participantID = String(parsed.participant_id ?? '').trim();
  if (!participantID) {
    participantID = String(parsed.participant ?? '').trim();
  }

  let studyID = String(parsed.study_id ?? '').trim();
  if (!studyID) {
    const study = parsed.study as Record<string, unknown> | undefined;
    studyID = String(study?.id ?? '').trim();
  }
  if (!studyID) {
    studyID = parseStudyIDFromSubmissionURL(String(parsed.study_url ?? ''));
  }

  const study = parsed.study as Record<string, unknown> | undefined;
  const studyName = String(study?.name ?? '').trim();

  return buildSubmissionSnapshot(
    String(parsed.id ?? ''),
    String(parsed.status ?? ''),
    participantID,
    studyID,
    studyName,
    parsed as Record<string, unknown>,
  );
}

