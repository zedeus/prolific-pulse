import Dexie, { type EntityTable } from 'dexie';

export interface StudyLatestRecord {
  study_id: string;
  name: string;
  payload: Record<string, unknown>;
  last_seen_at: string;
}

export interface StudyHistoryRecord {
  row_id?: number;
  study_id: string;
  observed_at: string;
  payload: Record<string, unknown>;
}

export interface StudyActiveSnapshotRecord {
  study_id: string;
  name: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface StudyAvailabilityEventRecord {
  row_id?: number;
  study_id: string;
  study_name: string;
  event_type: 'available' | 'unavailable';
  observed_at: string;
}

export interface ServiceStateRecord {
  id: number;
  last_studies_refresh_at?: string;
  last_studies_refresh_source?: string;
  last_studies_refresh_url?: string;
  last_studies_refresh_status?: number;
  updated_at: string;
}

export interface SubmissionRecord {
  submission_id: string;
  study_id: string;
  study_name: string;
  participant_id: string;
  status: string;
  phase: 'submitting' | 'submitted';
  payload: Record<string, unknown>;
  observed_at: string;
  updated_at: string;
}

export interface ResearcherRecord {
  id: string;
  name: string;
  country: string;
  first_seen_at: string;
  last_seen_at: string;
  study_count: number;
  submission_count: number;
}

class ProlificPulseDB extends Dexie {
  studiesLatest!: EntityTable<StudyLatestRecord, 'study_id'>;
  studiesHistory!: EntityTable<StudyHistoryRecord, 'row_id'>;
  studiesActiveSnapshot!: EntityTable<StudyActiveSnapshotRecord, 'study_id'>;
  studyAvailabilityEvents!: EntityTable<StudyAvailabilityEventRecord, 'row_id'>;
  serviceState!: EntityTable<ServiceStateRecord, 'id'>;
  submissions!: EntityTable<SubmissionRecord, 'submission_id'>;
  researchers!: EntityTable<ResearcherRecord, 'id'>;

  constructor() {
    super('prolific-pulse');
    this.version(1).stores({
      studiesLatest: 'study_id',
      studiesHistory: '++row_id, study_id, observed_at',
      studiesActiveSnapshot: 'study_id',
      studyAvailabilityEvents: '++row_id, study_id, observed_at',
      serviceState: 'id',
      submissions: 'submission_id, phase, observed_at',
    });
    this.version(2).stores({
      researchers: 'id, last_seen_at',
    });
  }
}

export const db = new ProlificPulseDB();
