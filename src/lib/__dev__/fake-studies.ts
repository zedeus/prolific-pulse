import type { Study, Money } from '../types';
import type { StudyLatestRecord, StudyActiveSnapshotRecord } from '../db';
import { db } from '../db';
import { makeRng, pick } from './rng';
import { STATE_KEY } from '../constants';

function gaussian(rng: () => number, mean: number, sd: number): number {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + sd * z;
}

const STUDY_TEMPLATES: readonly {
  name: string;
  meanMinutes: number;
  sdMinutes: number;
  meanRewardGBP: number;
  sdRewardGBP: number;
  labels: string[];
}[] = [
  { name: 'Quick opinion survey on daily habits', meanMinutes: 3, sdMinutes: 1, meanRewardGBP: 0.50, sdRewardGBP: 0.15, labels: ['survey'] },
  { name: 'LLM output rating — coding questions', meanMinutes: 30, sdMinutes: 10, meanRewardGBP: 6.00, sdRewardGBP: 1.20, labels: ['ai', 'coding'] },
  { name: 'Visual attention task', meanMinutes: 15, sdMinutes: 4, meanRewardGBP: 3.00, sdRewardGBP: 0.80, labels: ['experiment'] },
  { name: 'Political attitudes questionnaire', meanMinutes: 20, sdMinutes: 5, meanRewardGBP: 4.00, sdRewardGBP: 0.90, labels: ['survey', 'politics'] },
  { name: 'Moral dilemma decision-making', meanMinutes: 10, sdMinutes: 3, meanRewardGBP: 2.00, sdRewardGBP: 0.40, labels: ['psychology'] },
  { name: 'Memory recall study', meanMinutes: 25, sdMinutes: 7, meanRewardGBP: 5.00, sdRewardGBP: 1.00, labels: ['experiment'] },
  { name: 'Product feedback — fintech prototype', meanMinutes: 40, sdMinutes: 12, meanRewardGBP: 9.00, sdRewardGBP: 1.80, labels: ['usability'] },
  { name: 'Image matching and categorisation', meanMinutes: 10, sdMinutes: 2, meanRewardGBP: 2.50, sdRewardGBP: 0.40, labels: ['experiment'] },
  { name: 'Personality inventory (short form)', meanMinutes: 8, sdMinutes: 1.5, meanRewardGBP: 1.80, sdRewardGBP: 0.30, labels: ['survey', 'psychology'] },
  { name: 'Sleep and wellbeing longitudinal — week 3', meanMinutes: 12, sdMinutes: 3, meanRewardGBP: 3.50, sdRewardGBP: 0.50, labels: ['longitudinal'] },
  { name: 'Advertising effectiveness — video', meanMinutes: 15, sdMinutes: 4, meanRewardGBP: 3.25, sdRewardGBP: 0.60, labels: ['marketing'] },
  { name: 'Reaction time experiment', meanMinutes: 7, sdMinutes: 1.5, meanRewardGBP: 1.80, sdRewardGBP: 0.30, labels: ['experiment'] },
  { name: 'Consumer preferences — luxury goods', meanMinutes: 18, sdMinutes: 4, meanRewardGBP: 4.50, sdRewardGBP: 0.90, labels: ['marketing', 'survey'] },
  { name: 'Language comprehension task', meanMinutes: 22, sdMinutes: 5, meanRewardGBP: 5.50, sdRewardGBP: 1.10, labels: ['linguistics'] },
  { name: 'Social media usage patterns', meanMinutes: 12, sdMinutes: 3, meanRewardGBP: 3.00, sdRewardGBP: 0.60, labels: ['survey'] },
];

const RESEARCHERS: readonly { id: string; name: string; country: string }[] = [
  { id: 'r-001', name: 'Oxford Behavioural Lab', country: 'United Kingdom' },
  { id: 'r-002', name: 'Prolific Research Team', country: 'United Kingdom' },
  { id: 'r-003', name: 'Anthropic Evaluations', country: 'United States' },
  { id: 'r-004', name: 'MIT Media Lab', country: 'United States' },
  { id: 'r-005', name: "King's College Psych", country: 'United Kingdom' },
  { id: 'r-006', name: 'Acme Usability Studio', country: 'Germany' },
  { id: 'r-007', name: 'Stanford NLP Group', country: 'United States' },
  { id: 'r-008', name: 'Dr A. Singh (UCL)', country: 'United Kingdom' },
  { id: 'r-009', name: 'Very Long Researcher Name That Should Truncate Properly', country: 'Australia' },
];

function makeMoney(amountMajor: number, currency = 'GBP'): Money {
  return { amount: Math.round(amountMajor * 100), currency };
}

function generateStudy(rng: () => number, index: number, publishedAt: Date): Study {
  const template = pick(STUDY_TEMPLATES, rng);
  const researcher = pick(RESEARCHERS, rng);

  const durationMinutes = Math.max(1, Math.round(gaussian(rng, template.meanMinutes, template.sdMinutes)));
  const rewardMajor = Math.max(0.10, gaussian(rng, template.meanRewardGBP, template.sdRewardGBP));
  const hourlyMajor = (rewardMajor / durationMinutes) * 60;

  const totalPlaces = Math.max(1, Math.round(gaussian(rng, 50, 30)));
  const placesTaken = Math.floor(rng() * totalPlaces * 0.7);
  const placesAvailable = totalPlaces - placesTaken;

  const studyId = `study-fake-${String(index).padStart(6, '0')}`;

  return {
    id: studyId,
    name: template.name,
    study_type: 'single',
    date_created: publishedAt.toISOString(),
    published_at: publishedAt.toISOString(),
    total_available_places: totalPlaces,
    places_taken: placesTaken,
    places_available: placesAvailable,
    reward: makeMoney(rewardMajor),
    average_reward_per_hour: makeMoney(hourlyMajor),
    max_submissions_per_participant: 1,
    researcher: {
      id: researcher.id,
      name: researcher.name,
      country: researcher.country,
    },
    description: `This is a study about ${template.name.toLowerCase()}. Participants will complete tasks related to the topic.`,
    estimated_completion_time: durationMinutes,
    device_compatibility: ['desktop', 'mobile', 'tablet'],
    peripheral_requirements: [],
    maximum_allowed_time: durationMinutes * 3,
    average_completion_time_in_seconds: durationMinutes * 60,
    is_confidential: false,
    is_ongoing_study: false,
    pii_enabled: false,
    is_custom_screening: false,
    study_labels: template.labels,
    ai_inferred_study_labels: [],
    previous_submission_count: 0,
    first_seen_at: publishedAt.toISOString(),
  };
}

export interface FakeStudiesOptions {
  count: number;
  seed?: number;
  now?: Date;
}

function generateFakeStudies(options: FakeStudiesOptions): Study[] {
  const { count, seed = 42, now = new Date() } = options;
  const rng = makeRng(seed);
  const studies: Study[] = [];

  for (let i = 0; i < count; i++) {
    const hoursAgo = rng() * 24;
    const publishedAt = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
    studies.push(generateStudy(rng, i, publishedAt));
  }

  return studies;
}

export async function seedFakeStudies(count: number, seed = 42): Promise<number> {
  const studies = generateFakeStudies({ count, seed });
  const now = new Date().toISOString();

  const latestRecords: StudyLatestRecord[] = studies.map((s) => ({
    study_id: s.id,
    name: s.name,
    payload: s as unknown as Record<string, unknown>,
    last_seen_at: now,
  }));

  const snapshotRecords: StudyActiveSnapshotRecord[] = studies.map((s) => ({
    study_id: s.id,
    name: s.name,
    first_seen_at: s.first_seen_at || now,
    last_seen_at: now,
  }));

  await db.transaction('rw', [db.studiesLatest, db.studiesActiveSnapshot, db.serviceState], async () => {
    await db.studiesLatest.bulkPut(latestRecords);
    await db.studiesActiveSnapshot.bulkPut(snapshotRecords);
    // Seed service state so the popup shows as "logged in"
    await db.serviceState.put({
      id: 1,
      last_studies_refresh_at: now,
      last_studies_refresh_source: 'fake-studies',
      updated_at: now,
    });
  });

  // Also seed the sync state in browser storage so auth check passes
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = typeof browser !== 'undefined' ? browser : (typeof (globalThis as any).chrome !== 'undefined' ? (globalThis as any).chrome : null);
  const storage = b && (b as { storage?: { local?: { set: (items: Record<string, unknown>) => Promise<void> } } }).storage?.local;
  if (storage) {
    await storage.set({ [STATE_KEY]: { token_ok: true, token_auth_required: false } });
  }

  return studies.length;
}

export async function clearFakeStudies(): Promise<void> {
  await db.transaction('rw', [db.studiesLatest, db.studiesActiveSnapshot, db.serviceState], async () => {
    await db.studiesLatest.where('study_id').startsWith('study-fake-').delete();
    await db.studiesActiveSnapshot.where('study_id').startsWith('study-fake-').delete();
    // Clear service state to reset to "logged out"
    await db.serviceState.delete(1);
  });

  // Clear sync state in browser storage
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = typeof browser !== 'undefined' ? browser : (typeof (globalThis as any).chrome !== 'undefined' ? (globalThis as any).chrome : null);
  const storage = b && (b as { storage?: { local?: { remove: (keys: string[]) => Promise<void> } } }).storage?.local;
  if (storage) {
    await storage.remove([STATE_KEY]);
  }
}
