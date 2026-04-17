import type { SubmissionRecord } from '../db';
import {
  APPROVED_STATUS,
  AWAITING_REVIEW_STATUS,
  REJECTED_STATUS,
  RETURNED_STATUS,
  SCREENED_OUT_STATUS,
} from '../earnings';

// Mulberry32 seeded PRNG.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

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
    const payload: Record<string, unknown> = {
      started_at: startDate.toISOString(),
      submission_reward: { amount: rewardMinor, currency },
      study: { id: studyId, name: template.name, researcher },
    };
    if (status === RETURNED_STATUS || status === REJECTED_STATUS) {
      payload.returned_at = completedAt.toISOString();
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
  return records.length;
}

export async function clearFakeSubmissions(): Promise<void> {
  const { db } = await import('../db');
  await db.submissions.clear();
}
