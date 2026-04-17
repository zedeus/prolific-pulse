#!/usr/bin/env node
// Generate a fake Prolific submission-history CSV for import testing.
// Usage: node scripts/gen-fake-csv.mjs [count] [out-path] [seed]
// Defaults: 5000 rows, ./fake-submissions-<count>.csv, seed 42.

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const count = Number(process.argv[2] ?? 5000);
const outPath = resolve(process.argv[3] ?? `fake-submissions-${count}.csv`);
const seed = Number(process.argv[4] ?? 42);

function makeRng(s) {
  s = s >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = makeRng(seed);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
function gaussian(mean, sd) {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + sd * z;
}

const STUDY_TEMPLATES = [
  { name: 'Quick opinion survey on daily habits',        meanSeconds: 180,  sdSeconds: 60,   meanRewardGBP: 0.50, sdRewardGBP: 0.15 },
  { name: 'LLM output rating — coding questions',         meanSeconds: 1800, sdSeconds: 600,  meanRewardGBP: 6.00, sdRewardGBP: 1.20 },
  { name: 'Visual attention task',                         meanSeconds: 900,  sdSeconds: 240,  meanRewardGBP: 3.00, sdRewardGBP: 0.80 },
  { name: 'Political attitudes questionnaire',             meanSeconds: 1200, sdSeconds: 300,  meanRewardGBP: 4.00, sdRewardGBP: 0.90 },
  { name: 'Moral dilemma decision-making',                 meanSeconds: 600,  sdSeconds: 180,  meanRewardGBP: 2.00, sdRewardGBP: 0.40 },
  { name: 'Memory recall study',                           meanSeconds: 1500, sdSeconds: 420,  meanRewardGBP: 5.00, sdRewardGBP: 1.00 },
  { name: 'Product feedback — fintech prototype',          meanSeconds: 2400, sdSeconds: 720,  meanRewardGBP: 9.00, sdRewardGBP: 1.80 },
  { name: 'Image matching and categorisation',             meanSeconds: 600,  sdSeconds: 120,  meanRewardGBP: 2.50, sdRewardGBP: 0.40 },
  { name: 'Personality inventory (short form)',            meanSeconds: 480,  sdSeconds: 90,   meanRewardGBP: 1.80, sdRewardGBP: 0.30 },
  { name: 'Sleep and wellbeing longitudinal — week 3',     meanSeconds: 720,  sdSeconds: 180,  meanRewardGBP: 3.50, sdRewardGBP: 0.50 },
  { name: 'Advertising effectiveness — video',             meanSeconds: 900,  sdSeconds: 240,  meanRewardGBP: 3.25, sdRewardGBP: 0.60 },
  { name: 'Reaction time experiment',                      meanSeconds: 420,  sdSeconds: 90,   meanRewardGBP: 1.80, sdRewardGBP: 0.30 },
  { name: 'Production of Danish vowels',                   meanSeconds: 720,  sdSeconds: 210,  meanRewardGBP: 4.50, sdRewardGBP: 0.90 },
  { name: 'Study about sustainability',                    meanSeconds: 540,  sdSeconds: 150,  meanRewardGBP: 2.20, sdRewardGBP: 0.50 },
  { name: 'Test an online shopping experience',            meanSeconds: 600,  sdSeconds: 200,  meanRewardGBP: 2.30, sdRewardGBP: 0.40 },
  { name: 'Project Atlas - LibreOffice Experience Study',  meanSeconds: 300,  sdSeconds: 90,   meanRewardGBP: 5.80, sdRewardGBP: 0.60 },
  { name: 'Application usage study',                       meanSeconds: 240,  sdSeconds: 80,   meanRewardGBP: 7.50, sdRewardGBP: 0.80 },
  { name: 'En Kort Enkät',                                 meanSeconds: 360,  sdSeconds: 90,   meanRewardGBP: 0.40, sdRewardGBP: 0.10 },
];

// Weighted status pool mirrors fake-submissions.ts.
const STATUSES = [
  ...Array(80).fill('APPROVED'),
  ...Array(10).fill('AWAITING REVIEW'),
  ...Array(4).fill('RETURNED'),
  ...Array(3).fill('REJECTED'),
  ...Array(3).fill('SCREENED OUT'),
];

// Completion code: 8 uppercase alphanumerics (Prolific-like, starts with C).
const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function completionCode() {
  let s = 'C';
  for (let i = 0; i < 7; i++) s += CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)];
  return s;
}

function pad(n, w = 2) { return String(n).padStart(w, '0'); }
// `2026-03-25 16:10:53.160000` — naive UTC, space separator, microseconds.
function formatTs(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.` +
    `${pad(d.getUTCMilliseconds(), 3)}000`;
}

function formatMoney(amount, currency) {
  const symbol = currency === 'GBP' ? '£' : '$';
  return `${symbol}${amount.toFixed(2)}`;
}

function csvEscape(s) {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const now = new Date();
const spanMs = 240 * 86_400_000;

const rows = [];
for (let i = 0; i < count; i++) {
  const template = pick(STUDY_TEMPLATES);
  const status = pick(STATUSES);

  const tBias = Math.pow(rng(), 0.7);
  let startMs = now.getTime() - spanMs * (1 - tBias);
  const dow = new Date(startMs).getDay();
  if ((dow === 0 || dow === 6) && rng() < 0.5) {
    startMs += dow === 0 ? 86_400_000 : -86_400_000;
  }
  const startDate = new Date(startMs);
  const hour = Math.max(7, Math.min(23, Math.floor(gaussian(15, 4))));
  startDate.setUTCHours(hour, Math.floor(rng() * 60), Math.floor(rng() * 60), Math.floor(rng() * 1000));

  const duration = Math.round(Math.max(15, gaussian(template.meanSeconds, template.sdSeconds)));
  const completedAt = new Date(startDate.getTime() + duration * 1000);

  const rewardGBP = Math.max(0.30, gaussian(template.meanRewardGBP, template.sdRewardGBP));
  const reward = Math.round(rewardGBP * 100) / 100;
  const currency = rng() < 0.15 ? 'USD' : 'GBP';

  const hasBonus = rng() < 0.04;
  const bonus = hasBonus ? Math.max(0.10, gaussian(1.5, 1.0)) : 0;
  const bonusRounded = Math.round(bonus * 100) / 100;

  const isReturned = status === 'RETURNED' || status === 'REJECTED' || status === 'SCREENED OUT';
  const showCompletion = !isReturned || rng() < 0.2; // rare: some returned rows still have completion
  const code = (status === 'APPROVED' || status === 'AWAITING REVIEW') ? completionCode() : (showCompletion ? completionCode() : '');

  // Match the real-CSV pattern: RETURNED rows often have empty completed_at + code.
  const completedCell = (status === 'RETURNED' && rng() < 0.7) ? '' : formatTs(completedAt);
  const startedCell = (status === 'RETURNED' && rng() < 0.05) ? '' : formatTs(startDate);
  // Ensure at least one timestamp is present (the importer skips rows with neither).
  const finalStarted = startedCell || formatTs(startDate);

  rows.push([
    csvEscape(template.name),
    formatMoney(reward, currency),
    formatMoney(bonusRounded, currency),
    finalStarted,
    completedCell,
    code,
    status,
  ]);
}

// Sort oldest→newest, matching the feel of a real export.
rows.sort((a, b) => (a[3] || a[4]).localeCompare(b[3] || b[4]));

const header = 'Study,Reward,Bonus,Started At,Completed At,Completion Code,Status\n';
const body = rows.map((r) => r.join(',')).join('\n') + '\n';
writeFileSync(outPath, header + body, 'utf8');

console.log(`Wrote ${rows.length} rows to ${outPath}`);
