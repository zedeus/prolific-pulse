/**
 * Tests for Live panel filtering/sorting logic edge cases.
 * These mirror the filtering logic in LivePanel.svelte.
 */
import { describe, it, expect } from 'vitest';
import { parseDate } from '../format';
import {
  studyKeywordBlob,
  studyRewardMajor,
  studyHourlyRewardMajor,
  studyEstimatedMinutes,
  studyPlacesAvailable,
} from '../../entrypoints/background/domain';
import type { Study } from '../types';

function makeStudy(overrides: Partial<Study> = {}): Study {
  return {
    id: 'study-1',
    name: 'Test Study',
    study_type: 'SINGLE',
    date_created: '2025-01-01T00:00:00Z',
    published_at: '2025-01-01T12:00:00Z',
    total_available_places: 100,
    places_taken: 0,
    places_available: 100,
    reward: { amount: 500, currency: 'GBP' },
    average_reward_per_hour: { amount: 1200, currency: 'GBP' },
    max_submissions_per_participant: 1,
    researcher: { id: 'r1', name: 'Dr. Smith', country: 'GB' },
    description: 'A test study.',
    estimated_completion_time: 10,
    device_compatibility: ['desktop'],
    peripheral_requirements: [],
    maximum_allowed_time: 60,
    average_completion_time_in_seconds: 600,
    is_confidential: false,
    is_ongoing_study: false,
    pii_enabled: false,
    is_custom_screening: false,
    study_labels: ['survey'],
    ai_inferred_study_labels: [],
    previous_submission_count: 0,
    ...overrides,
  };
}

function getTimestamp(study: Study): number {
  const date = parseDate(study.published_at || study.date_created);
  return date ? date.getTime() : 0;
}

type SortKey = 'newest' | 'reward' | 'hourly' | 'places' | 'duration';

function sortStudies(studies: Study[], sortKey: SortKey): Study[] {
  return [...studies].sort((a, b) => {
    let aVal: number, bVal: number;
    switch (sortKey) {
      case 'reward':
        aVal = studyRewardMajor(a);
        bVal = studyRewardMajor(b);
        break;
      case 'hourly':
        aVal = studyHourlyRewardMajor(a);
        bVal = studyHourlyRewardMajor(b);
        break;
      case 'places':
        aVal = studyPlacesAvailable(a);
        bVal = studyPlacesAvailable(b);
        break;
      case 'duration':
        aVal = studyEstimatedMinutes(a);
        bVal = studyEstimatedMinutes(b);
        break;
      case 'newest':
      default:
        aVal = getTimestamp(a);
        bVal = getTimestamp(b);
        break;
    }
    const aFinite = Number.isFinite(aVal);
    const bFinite = Number.isFinite(bVal);
    if (aFinite && bFinite) {
      const diff = sortKey === 'duration' ? aVal - bVal : bVal - aVal;
      if (diff !== 0) return diff;
    } else if (aFinite !== bFinite) {
      return aFinite ? -1 : 1;
    }
    return (a.id || '').localeCompare(b.id || '');
  });
}

function filterStudies(
  studies: Study[],
  query: string,
  minReward: number | null,
  minHourly: number | null,
  maxDuration: number | null,
): Study[] {
  let result = [...studies];
  const q = query.trim().toLowerCase();

  if (q) {
    result = result.filter((s) => {
      const blob = studyKeywordBlob(s);
      const researcher = s.researcher?.name?.toLowerCase() || '';
      return blob.includes(q) || researcher.includes(q);
    });
  }

  if (minReward !== null && minReward > 0) {
    result = result.filter((s) => studyRewardMajor(s) >= minReward);
  }
  if (minHourly !== null && minHourly > 0) {
    result = result.filter((s) => studyHourlyRewardMajor(s) >= minHourly);
  }
  if (maxDuration !== null && maxDuration > 0) {
    result = result.filter((s) => {
      const d = studyEstimatedMinutes(s);
      return Number.isFinite(d) && d <= maxDuration;
    });
  }

  return result;
}

describe('Live panel filter: edge cases', () => {
  describe('empty/malformed data', () => {
    it('handles empty studies array', () => {
      const result = filterStudies([], 'test', 5, 10, 30);
      expect(result).toEqual([]);
    });

    it('handles study with null reward', () => {
      const studies = [
        makeStudy({ id: 'a', reward: null as unknown as Study['reward'] }),
        makeStudy({ id: 'b', reward: { amount: 500, currency: 'GBP' } }),
      ];
      const result = filterStudies(studies, '', 1, null, null);
      expect(result.map((s) => s.id)).toEqual(['b']);
    });

    it('handles study with undefined reward', () => {
      const studies = [
        makeStudy({ id: 'a', reward: undefined as unknown as Study['reward'] }),
        makeStudy({ id: 'b', reward: { amount: 500, currency: 'GBP' } }),
      ];
      const result = filterStudies(studies, '', 1, null, null);
      expect(result.map((s) => s.id)).toEqual(['b']);
    });

    it('handles study with NaN duration', () => {
      const studies = [
        makeStudy({ id: 'a', estimated_completion_time: NaN }),
        makeStudy({ id: 'b', estimated_completion_time: 10 }),
      ];
      const result = filterStudies(studies, '', null, null, 15);
      expect(result.map((s) => s.id)).toEqual(['b']);
    });

    it('handles study with null researcher', () => {
      const studies = [
        makeStudy({ id: 'a', researcher: null as unknown as Study['researcher'] }),
        makeStudy({ id: 'b', researcher: { id: 'r1', name: 'Dr. Smith', country: 'GB' } }),
      ];
      const result = filterStudies(studies, 'smith', null, null, null);
      expect(result.map((s) => s.id)).toEqual(['b']);
    });

    it('handles study with empty name', () => {
      const studies = [
        makeStudy({ id: 'a', name: '', study_labels: [] }),
        makeStudy({ id: 'b', name: 'Survey Study', study_labels: [] }),
      ];
      const result = filterStudies(studies, 'survey', null, null, null);
      expect(result.map((s) => s.id)).toEqual(['b']);
    });
  });

  describe('search query edge cases', () => {
    it('whitespace-only query returns all studies', () => {
      const studies = [makeStudy({ id: 'a' }), makeStudy({ id: 'b' })];
      const result = filterStudies(studies, '   ', null, null, null);
      expect(result).toHaveLength(2);
    });

    it('empty query returns all studies', () => {
      const studies = [makeStudy({ id: 'a' }), makeStudy({ id: 'b' })];
      const result = filterStudies(studies, '', null, null, null);
      expect(result).toHaveLength(2);
    });

    it('case-insensitive search', () => {
      const studies = [
        makeStudy({ id: 'a', name: 'SURVEY ABOUT DOGS', study_labels: [] }),
        makeStudy({ id: 'b', name: 'cat study', study_labels: [] }),
      ];
      const result = filterStudies(studies, 'SuRvEy', null, null, null);
      expect(result.map((s) => s.id)).toEqual(['a']);
    });

    it('searches in description', () => {
      const studies = [
        makeStudy({ id: 'a', name: 'Study A', description: 'This is about psychology' }),
        makeStudy({ id: 'b', name: 'Study B', description: 'This is about math' }),
      ];
      const result = filterStudies(studies, 'psychology', null, null, null);
      expect(result.map((s) => s.id)).toEqual(['a']);
    });

    it('searches in study labels', () => {
      const studies = [
        makeStudy({ id: 'a', study_labels: ['coding', 'ai'] }),
        makeStudy({ id: 'b', study_labels: ['survey'] }),
      ];
      const result = filterStudies(studies, 'coding', null, null, null);
      expect(result.map((s) => s.id)).toEqual(['a']);
    });

    it('searches in researcher name', () => {
      const studies = [
        makeStudy({ id: 'a', researcher: { id: 'r1', name: 'Oxford Lab', country: 'GB' } }),
        makeStudy({ id: 'b', researcher: { id: 'r2', name: 'MIT', country: 'US' } }),
      ];
      const result = filterStudies(studies, 'oxford', null, null, null);
      expect(result.map((s) => s.id)).toEqual(['a']);
    });
  });

  describe('filter value edge cases', () => {
    it('minReward of 0 does not filter', () => {
      const studies = [makeStudy({ id: 'a', reward: { amount: 0, currency: 'GBP' } })];
      const result = filterStudies(studies, '', 0, null, null);
      expect(result).toHaveLength(1);
    });

    it('minReward of null does not filter', () => {
      const studies = [makeStudy({ id: 'a', reward: { amount: 100, currency: 'GBP' } })];
      const result = filterStudies(studies, '', null, null, null);
      expect(result).toHaveLength(1);
    });

    it('maxDuration of 0 does not filter', () => {
      const studies = [makeStudy({ id: 'a', estimated_completion_time: 10 })];
      const result = filterStudies(studies, '', null, null, 0);
      expect(result).toHaveLength(1);
    });

    it('negative filter values are treated as inactive', () => {
      const studies = [makeStudy({ id: 'a', reward: { amount: 100, currency: 'GBP' } })];
      const result = filterStudies(studies, '', -5, null, null);
      expect(result).toHaveLength(1);
    });
  });

  describe('extreme values', () => {
    it('handles very large reward', () => {
      const studies = [
        makeStudy({ id: 'a', reward: { amount: 100000000, currency: 'GBP' } }),
        makeStudy({ id: 'b', reward: { amount: 50000, currency: 'GBP' } }),
      ];
      const result = filterStudies(studies, '', 100, null, null);
      expect(result.map((s) => s.id)).toEqual(['a', 'b']);
    });

    it('handles zero reward', () => {
      const studies = [
        makeStudy({ id: 'a', reward: { amount: 0, currency: 'GBP' } }),
        makeStudy({ id: 'b', reward: { amount: 500, currency: 'GBP' } }),
      ];
      const result = filterStudies(studies, '', 1, null, null);
      expect(result.map((s) => s.id)).toEqual(['b']);
    });

    it('handles negative reward (malformed data)', () => {
      const studies = [
        makeStudy({ id: 'a', reward: { amount: -100, currency: 'GBP' } }),
        makeStudy({ id: 'b', reward: { amount: 500, currency: 'GBP' } }),
      ];
      const result = filterStudies(studies, '', 1, null, null);
      expect(result.map((s) => s.id)).toEqual(['b']);
    });

    it('handles zero duration', () => {
      const studies = [
        makeStudy({ id: 'a', estimated_completion_time: 0 }),
        makeStudy({ id: 'b', estimated_completion_time: 10 }),
      ];
      const result = filterStudies(studies, '', null, null, 5);
      expect(result.map((s) => s.id)).toEqual(['a']);
    });
  });
});

describe('Live panel sort: edge cases', () => {
  it('sorts by reward with NaN values (NaN goes to end)', () => {
    const studies = [
      makeStudy({ id: 'a', reward: null as unknown as Study['reward'] }),
      makeStudy({ id: 'b', reward: { amount: 1000, currency: 'GBP' } }),
      makeStudy({ id: 'c', reward: { amount: 500, currency: 'GBP' } }),
    ];
    const sorted = sortStudies(studies, 'reward');
    expect(sorted.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by hourly with NaN values', () => {
    const studies = [
      makeStudy({ id: 'a', average_reward_per_hour: null as unknown as Study['average_reward_per_hour'] }),
      makeStudy({ id: 'b', average_reward_per_hour: { amount: 2000, currency: 'GBP' } }),
      makeStudy({ id: 'c', average_reward_per_hour: { amount: 1000, currency: 'GBP' } }),
    ];
    const sorted = sortStudies(studies, 'hourly');
    expect(sorted.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by duration with NaN values (NaN goes to end)', () => {
    const studies = [
      makeStudy({ id: 'a', estimated_completion_time: NaN }),
      makeStudy({ id: 'b', estimated_completion_time: 5 }),
      makeStudy({ id: 'c', estimated_completion_time: 10 }),
    ];
    const sorted = sortStudies(studies, 'duration');
    expect(sorted.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by places with NaN values', () => {
    const studies = [
      makeStudy({ id: 'a', places_available: NaN, total_available_places: NaN }),
      makeStudy({ id: 'b', places_available: 100 }),
      makeStudy({ id: 'c', places_available: 50 }),
    ];
    const sorted = sortStudies(studies, 'places');
    expect(sorted.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by newest with missing timestamps', () => {
    const studies = [
      makeStudy({ id: 'a', published_at: '', date_created: '' }),
      makeStudy({ id: 'b', published_at: '2025-01-02T00:00:00Z' }),
      makeStudy({ id: 'c', published_at: '2025-01-01T00:00:00Z' }),
    ];
    const sorted = sortStudies(studies, 'newest');
    expect(sorted.map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('stable sort on equal values (falls back to ID)', () => {
    const studies = [
      makeStudy({ id: 'c', reward: { amount: 500, currency: 'GBP' } }),
      makeStudy({ id: 'a', reward: { amount: 500, currency: 'GBP' } }),
      makeStudy({ id: 'b', reward: { amount: 500, currency: 'GBP' } }),
    ];
    const sorted = sortStudies(studies, 'reward');
    expect(sorted.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('Live panel: layout-hostile strings', () => {
  it('handles very long study name in search', () => {
    const longName = 'A'.repeat(200);
    const studies = [makeStudy({ id: 'a', name: longName })];
    const result = filterStudies(studies, 'AAAA', null, null, null);
    expect(result).toHaveLength(1);
  });

  it('handles emoji in study name', () => {
    const studies = [makeStudy({ id: 'a', name: 'Survey about 🎉 parties' })];
    const result = filterStudies(studies, '🎉', null, null, null);
    expect(result).toHaveLength(1);
  });

  it('handles special characters in search', () => {
    const studies = [makeStudy({ id: 'a', name: 'Study <script>alert(1)</script>' })];
    const result = filterStudies(studies, '<script>', null, null, null);
    expect(result).toHaveLength(1);
  });
});
