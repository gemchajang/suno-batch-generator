import type { Job, JobStatus, QueueState, SongInput } from './job';
export type { SongInput } from './job';

// Side Panel → Background
export interface StartQueueMessage {
  type: 'START_QUEUE';
}

export interface StopQueueMessage {
  type: 'STOP_QUEUE';
}

export interface AddJobsMessage {
  type: 'ADD_JOBS';
  payload: SongInput[];
}

export interface ClearQueueMessage {
  type: 'CLEAR_QUEUE';
}

export interface GetStateMessage {
  type: 'GET_STATE';
}

export interface UpdateSettingsMessage {
  type: 'UPDATE_SETTINGS';
  payload: Partial<Settings>;
}

// Background → Side Panel (via port or runtime)
export interface QueueStateUpdate {
  type: 'QUEUE_STATE_UPDATE';
  payload: QueueState;
}

export interface LogEntry {
  type: 'LOG';
  payload: {
    level: 'info' | 'warn' | 'error';
    message: string;
    timestamp: number;
  };
}

// Background → Content Script
export interface ExecuteJobMessage {
  type: 'EXECUTE_JOB';
  payload: {
    job: Job;
    settings: Settings;
  };
}

export interface AbortJobMessage {
  type: 'ABORT_JOB';
}

export interface CheckPageMessage {
  type: 'CHECK_PAGE';
}

// Content Script → Background
export interface JobProgressMessage {
  type: 'JOB_PROGRESS';
  payload: {
    jobId: string;
    status: JobStatus;
    error?: string;
  };
}

export interface PageStatusMessage {
  type: 'PAGE_STATUS';
  payload: {
    isCreatePage: boolean;
    isLoggedIn: boolean;
  };
}

export interface DownloadReadyMessage {
  type: 'DOWNLOAD_READY';
  payload: {
    jobId: string;
  };
}

export interface Settings {
  delayBetweenSongs: number;
  generationTimeout: number;
  maxRetries: number;
}

export type PanelToBgMessage =
  | StartQueueMessage
  | StopQueueMessage
  | AddJobsMessage
  | ClearQueueMessage
  | GetStateMessage
  | UpdateSettingsMessage;

export type BgToPanelMessage =
  | QueueStateUpdate
  | LogEntry;

export type BgToContentMessage =
  | ExecuteJobMessage
  | AbortJobMessage
  | CheckPageMessage;

export type ContentToBgMessage =
  | JobProgressMessage
  | PageStatusMessage
  | DownloadReadyMessage;
