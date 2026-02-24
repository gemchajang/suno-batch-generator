export interface SongInput {
  title: string;
  style: string;
  lyrics: string;
  instrumental?: boolean;
  downloadFolder?: string;
  notionPageId?: string;
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
  songIds?: string[];
  retryCount: number;
  createdAt: number;
  updatedAt: number;
  notionPageId?: string;
}

export interface LibrarySong {
  id: string;
  title: string;
  imageUrl?: string;
}

export interface QueueState {
  jobs: Job[];
  running: boolean;
  activeJobIds: string[];
  library: LibrarySong[];
}
