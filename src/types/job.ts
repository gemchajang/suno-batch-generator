export interface SongInput {
  title: string;
  style: string;
  lyrics: string;
  instrumental?: boolean;
}

export type JobStatus =
  | 'pending'
  | 'filling'
  | 'creating'
  | 'waiting'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface Job {
  id: string;
  input: SongInput;
  status: JobStatus;
  error?: string;
  retryCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface QueueState {
  jobs: Job[];
  running: boolean;
  currentJobId: string | null;
}
