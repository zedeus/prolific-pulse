import type { SubmissionRecord } from '../db';
import {
  APPROVED_STATUS,
  AWAITING_REVIEW_STATUS,
  REJECTED_STATUS,
  RETURNED_STATUS,
  SCREENED_OUT_STATUS,
} from '../earnings';

import { makeRng, pick } from './rng';

// Box-Muller.
function gaussian(rng: () => number, mean: number, sd: number): number {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + sd * z;
}

const STUDY_TEMPLATES: readonly { name: string; meanSeconds: number; sdSeconds: number; meanRewardGBP: number; sdRewardGBP: number }[] = [
  { name: 'Quick opinion survey on daily habits',        meanSeconds: 180,  sdSeconds: 60,   meanRewardGBP: 0.50, sdRewardGBP: 0.15 },
  { name: 'LLM output rating — coding questions',        meanSeconds: 1800, sdSeconds: 600,  meanRewardGBP: 6.00, sdRewardGBP: 1.20 },
  { name: 'Visual attention task',                        meanSeconds: 900,  sdSeconds: 240,  meanRewardGBP: 3.00, sdRewardGBP: 0.80 },
  { name: 'Political attitudes questionnaire',            meanSeconds: 1200, sdSeconds: 300,  meanRewardGBP: 4.00, sdRewardGBP: 0.90 },
  { name: 'Moral dilemma decision-making',                meanSeconds: 600,  sdSeconds: 180,  meanRewardGBP: 2.00, sdRewardGBP: 0.40 },
  { name: 'Memory recall study',                          meanSeconds: 1500, sdSeconds: 420,  meanRewardGBP: 5.00, sdRewardGBP: 1.00 },
  { name: 'Product feedback — fintech prototype',         meanSeconds: 2400, sdSeconds: 720,  meanRewardGBP: 9.00, sdRewardGBP: 1.80 },
  { name: 'Image matching and categorisation',            meanSeconds: 600,  sdSeconds: 120,  meanRewardGBP: 2.50, sdRewardGBP: 0.40 },
  { name: 'Personality inventory (short form)',           meanSeconds: 480,  sdSeconds: 90,   meanRewardGBP: 1.80, sdRewardGBP: 0.30 },
  { name: 'Sleep and wellbeing longitudinal — week 3',    meanSeconds: 720,  sdSeconds: 180,  meanRewardGBP: 3.50, sdRewardGBP: 0.50 },
  { name: 'Advertising effectiveness — video',            meanSeconds: 900,  sdSeconds: 240,  meanRewardGBP: 3.25, sdRewardGBP: 0.60 },
  { name: 'Reaction time experiment',                     meanSeconds: 420,  sdSeconds: 90,   meanRewardGBP: 1.80, sdRewardGBP: 0.30 },
];

const RESEARCHERS: readonly { id: string; name: string }[] = [
  { id: 'r-001', name: 'Oxford Behavioural Lab' },
  { id: 'r-002', name: 'Prolific Research Team' },
  { id: 'r-003', name: 'Anthropic Evaluations' },
  { id: 'r-004', name: 'MIT Media Lab' },
  { id: 'r-005', name: 'King\'s College Psych' },
  { id: 'r-006', name: 'Acme Usability Studio' },
  { id: 'r-007', name: 'Stanford NLP Group' },
  { id: 'r-008', name: 'Dr A. Singh (UCL)' },
];

const STATUS_POOL: readonly string[] = [
  ...Array(80).fill(APPROVED_STATUS),
  ...Array(10).fill(AWAITING_REVIEW_STATUS),
  ...Array(4).fill(RETURNED_STATUS),
  ...Array(3).fill(REJECTED_STATUS),
  ...Array(3).fill(SCREENED_OUT_STATUS),
];

const RETURN_REASONS: readonly string[] = [
  'Submission timed out',
  'Did not complete required tasks',
  'Technical issues prevented completion',
  'Participant withdrew voluntarily',
];

const REJECTION_REASONS: readonly string[] = [
  'Failed attention check',
  'Invalid or nonsensical responses',
  'Responses did not meet quality standards',
  'Did not follow instructions',
];

const COUNTRIES: readonly string[] = ['US', 'GB', 'CA', 'DE', 'FR', 'AU', 'NL', 'SE', 'IT', 'FI'];
const INSTITUTIONS: readonly (string | null)[] = [null, null, null, 'stanford.edu', 'mit.edu', 'oxford.ac.uk', 'maze.design'];

export interface FakeDataOptions {
  count: number;
  /** Base seed (deterministic). Default 42. */
  seed?: number;
  /** Anchor "now" — submissions are spread before this point. Default: current time. */
  now?: Date;
  /** Total number of days the fake submissions span before `now`. Default: 240 (~8 months). */
  spanDays?: number;
  /** Fraction of submissions in non-primary currencies (GBP primary; USD/EUR sprinkled). Default 0.15. */
  foreignCurrencyFraction?: number;
}

/** Deterministic for a given opts. */
export function generateFakeSubmissions(opts: FakeDataOptions): SubmissionRecord[] {
  const seed = opts.seed ?? 42;
  const now = opts.now ?? new Date();
  const spanDays = opts.spanDays ?? 240;
  const foreignFrac = opts.foreignCurrencyFraction ?? 0.15;
  const rng = makeRng(seed);

  const out: SubmissionRecord[] = [];
  const spanMs = spanDays * 86_400_000;

  for (let i = 0; i < opts.count; i++) {
    const template = pick(STUDY_TEMPLATES, rng);
    const researcher = pick(RESEARCHERS, rng);
    const status = pick(STATUS_POOL, rng);

    // Recency bias: cluster more submissions toward `now`.
    const tBias = Math.pow(rng(), 0.7);
    let startMs = now.getTime() - spanMs * (1 - tBias);
    const initialDow = new Date(startMs).getDay();
    if ((initialDow === 0 || initialDow === 6) && rng() < 0.5) {
      startMs += initialDow === 0 ? 86_400_000 : -86_400_000;
    }

    const startDate = new Date(startMs);
    const hour = Math.max(7, Math.min(23, Math.floor(gaussian(rng, 15, 4))));
    startDate.setHours(hour, Math.floor(rng() * 60), Math.floor(rng() * 60), 0);

    const duration = Math.round(Math.max(15, gaussian(rng, template.meanSeconds, template.sdSeconds)));
    const completedAt = new Date(startDate.getTime() + duration * 1000);

    const rewardGBP = Math.max(0.30, gaussian(rng, template.meanRewardGBP, template.sdRewardGBP));
    const rewardMinor = Math.round(rewardGBP * 100);
    const currency = rng() < foreignFrac ? pick(['USD', 'EUR'] as const, rng) : 'GBP';

    const studyId = `study-${Math.floor(rng() * 40) + 1}`;
    const country = pick(COUNTRIES, rng);
    const institution = pick(INSTITUTIONS, rng);
    const studyCode = status === APPROVED_STATUS ? `C${Math.floor(rng() * 1e8).toString(36).toUpperCase()}` : null;
    const hasBonus = status === APPROVED_STATUS && rng() > 0.85;

    const payload: Record<string, unknown> = {
      started_at: startDate.toISOString(),
      submission_reward: { amount: rewardMinor, currency },
      study_code: studyCode,
      is_trial_study: rng() > 0.95,
      submission_bonuses: hasBonus ? [{ amount: Math.round(rewardMinor * 0.2), currency }] : [],
      study: {
        id: studyId,
        name: template.name,
        is_trial_study: rng() > 0.95,
        researcher: {
          ...researcher,
          country,
          institution: institution ? { name: institution, logo: null, link: '' } : { name: null, logo: null, link: '' },
        },
      },
    };
    if (status === RETURNED_STATUS) {
      payload.returned_at = completedAt.toISOString();
      payload.return_reason = pick(RETURN_REASONS, rng);
    } else if (status === REJECTED_STATUS) {
      payload.returned_at = completedAt.toISOString();
      payload.rejection_message = pick(REJECTION_REASONS, rng);
    } else {
      payload.completed_at = completedAt.toISOString();
    }

    out.push({
      submission_id: `fake-${seed}-${i}`,
      study_id: studyId,
      study_name: template.name,
      participant_id: 'fake-participant',
      status,
      phase: 'submitted',
      payload,
      observed_at: completedAt.toISOString(),
      updated_at: completedAt.toISOString(),
    });
  }

  out.sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  return out;
}

// Fake submissions reference study ids `study-1`..`study-40`. Submissions don't carry study-type
// labels, so the earnings "by study type" view joins against observed study records. We seed
// labelled `studiesLatest` records for those ids here, leaving a handful unlabelled so the
// "Other" bucket is exercised too. Labels use the same vocabulary as formatStudyLabel().
const FAKE_STUDY_ID_COUNT = 40;
const FAKE_LABELLED_STUDY_COUNT = 34;
const FAKE_STUDY_TYPE_POOL: readonly string[] = [
  'survey', 'survey', 'survey', 'survey',
  'experiment', 'experiment', 'experiment',
  'interview', 'interview',
  'longitudinal',
  'data_collection',
  'decision_making_task',
];

async function seedFakeStudyTypes(): Promise<void> {
  const { db } = await import('../db');
  const now = new Date().toISOString();
  const records = [];
  for (let n = 1; n <= FAKE_LABELLED_STUDY_COUNT; n++) {
    const label = FAKE_STUDY_TYPE_POOL[(n - 1) % FAKE_STUDY_TYPE_POOL.length];
    const name = `Study ${n}`;
    records.push({
      study_id: `study-${n}`,
      name,
      payload: { id: `study-${n}`, name, study_labels: [label], ai_inferred_study_labels: [] },
      last_seen_at: now,
    });
  }
  await db.studiesLatest.bulkPut(records);
}

/** Exposed on `window.__ppDev.seed` by dev-helpers. */
export async function seedFakeSubmissions(count: number, seed?: number): Promise<number> {
  const { db } = await import('../db');
  await db.submissions.clear();
  const records = generateFakeSubmissions({ count, seed });
  // Chunks keep the main thread responsive during 10k+ inserts.
  const CHUNK = 2000;
  for (let i = 0; i < records.length; i += CHUNK) {
    await db.submissions.bulkAdd(records.slice(i, i + CHUNK));
  }
  await seedFakeStudyTypes();
  return records.length;
}

export async function clearFakeSubmissions(): Promise<void> {
  const { db } = await import('../db');
  await db.submissions.clear();
  const studyIds = Array.from({ length: FAKE_STUDY_ID_COUNT }, (_, i) => `study-${i + 1}`);
  await db.studiesLatest.bulkDelete(studyIds);
}
