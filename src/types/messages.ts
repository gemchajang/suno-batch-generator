import type { Job, JobStatus, QueueState, SongInput, LibrarySong } from './job';
export type { SongInput, LibrarySong } from './job';

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
export interface TriggerJobMessage {
  type: 'TRIGGER_JOB';
  payload: {
    job: Job;
    settings: Settings;
  };
}

export interface MonitorJobMessage {
  type: 'MONITOR_JOB';
  payload: {
    job: Job;
    settings: Settings;
    songIds: string[];
  };
}

export interface AbortJobMessage {
  type: 'ABORT_JOB';
  payload?: {
    jobId: string;
  };
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
    songIds?: string[];
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

export interface DownloadWavFileMessage {
  type: 'DOWNLOAD_WAV_FILE';
  url: string;
  filename: string;
  folder?: string;
  duration?: string;
}

export interface Settings {
  delayBetweenSongs: number;
  generationTimeout: number;
  maxRetries: number;
  downloadPath: string;
  downloadFormat: 'mp3' | 'wav';
  notionApiKey?: string;
  notionDatabaseId?: string;
}

export interface ManualRunJobMessage {
  type: 'MANUAL_RUN_JOB';
  payload: {
    jobId: string;
  };
}

export interface ManualDownloadJobMessage {
  type: 'MANUAL_DOWNLOAD_JOB';
  payload: {
    jobId: string;
    title?: string;
  };
}

export interface FetchLibraryMessage {
  type: 'FETCH_LIBRARY';
}

export interface AddLibrarySongsMessage {
  type: 'ADD_LIBRARY_SONGS';
  payload: LibrarySong[];
}

export interface CheckAndInjectMessage {
  type: 'CHECK_AND_INJECT';
}

export interface FetchNotionJobsMessage {
  type: 'FETCH_NOTION_JOBS';
}

export type PanelToBgMessage =
  | StartQueueMessage
  | StopQueueMessage
  | AddJobsMessage
  | ClearQueueMessage
  | GetStateMessage
  | GetStateMessage
  | UpdateSettingsMessage
  | ManualRunJobMessage
  | ManualDownloadJobMessage
  | FetchLibraryMessage
  | CheckAndInjectMessage
  | AddLibrarySongsMessage
  | FetchNotionJobsMessage
  | { type: 'TEST_DOWNLOAD' }
  | GenerateViaApiMessage;

export type BgToPanelMessage =
  | QueueStateUpdate
  | LogEntry;

export type BgToContentMessage =
  | TriggerJobMessage
  | MonitorJobMessage
  | AbortJobMessage
  | CheckPageMessage
  | FetchLibraryMessage
  | { type: 'TEST_DOWNLOAD' };

// Content Script → Background (page context execution via chrome.scripting MAIN world)
export interface ExecInPageMessage {
  type: 'EXEC_IN_PAGE';
  action: 'REACT_CLICK' | 'REACT_HOVER' | 'REACT_DIAGNOSTICS' | 'REACT_OPEN_CLIP_MENU' | 'REACT_GET_TOKENS' | 'INJECT_INTERCEPTOR';
  selector?: string;
}

export interface HeartbeatMessage {
  type: 'HEARTBEAT';
}

export interface GenerateViaApiMessage {
  type: 'GENERATE_VIA_API';
  payload: {
    jobs: any[];
  };
}

// Proxy API Request (Bypass CORS)
export interface ProxyApiRequestMessage {
  type: 'PROXY_API_REQUEST';
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: any;
}

export type ContentToBgMessage =
  | JobProgressMessage
  | PageStatusMessage
  | DownloadReadyMessage
  | DownloadWavFileMessage
  | ExecInPageMessage
  | HeartbeatMessage
  | ProxyApiRequestMessage;
