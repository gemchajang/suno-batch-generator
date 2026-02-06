import type { Job, QueueState } from '../types/job';
import type { SongInput, Settings, LogEntry, QueueStateUpdate, JobProgressMessage } from '../types/messages';
import {
  DEFAULT_DELAY_BETWEEN_SONGS,
  DEFAULT_GENERATION_TIMEOUT,
  DEFAULT_MAX_RETRIES,
  STORAGE_KEY_QUEUE,
  STORAGE_KEY_SETTINGS,
} from '../config/constants';

let state: QueueState = {
  jobs: [],
  running: false,
  currentJobId: null,
};

let settings: Settings = {
  delayBetweenSongs: DEFAULT_DELAY_BETWEEN_SONGS,
  generationTimeout: DEFAULT_GENERATION_TIMEOUT,
  maxRetries: DEFAULT_MAX_RETRIES,
  downloadPath: 'SunoMusic', // Default subdirectory
};

let loopActive = false;
let activeTabId: number | null = null;

// ---- State management ----

export function getState(): QueueState {
  return state;
}

export function getSettings(): Settings {
  return settings;
}

export function addJobs(inputs: SongInput[]): void {
  const newJobs: Job[] = inputs.map((input, i) => ({
    id: `${Date.now()}-${i}`,
    input,
    status: 'pending',
    retryCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));

  state = { ...state, jobs: [...state.jobs, ...newJobs] };
  broadcastState();
  persistState();
  emitLog('info', `Added ${newJobs.length} song(s) to queue`);
}

export function clearQueue(): void {
  state = { jobs: [], running: false, currentJobId: null };
  loopActive = false;
  broadcastState();
  persistState();
  emitLog('info', 'Queue cleared');
}

export function updateSettings(partial: Partial<Settings>): void {
  settings = { ...settings, ...partial };
  chrome.storage.local.set({ [STORAGE_KEY_SETTINGS]: settings });
}

// ---- Queue execution ----

export async function startQueue(): Promise<void> {
  if (loopActive) return;

  state = { ...state, running: true };
  loopActive = true;
  broadcastState();
  emitLog('info', 'Queue started');

  await runLoop();
}

export function stopQueue(): void {
  loopActive = false;
  state = { ...state, running: false, currentJobId: null };
  broadcastState();
  persistState();
  emitLog('info', 'Queue stopped');

  // Abort current job in content script
  sendToContentScript({ type: 'ABORT_JOB' });
}

async function runLoop(): Promise<void> {
  while (loopActive) {
    const nextJob = state.jobs.find((j) => j.status === 'pending');
    if (!nextJob) {
      emitLog('info', 'All jobs processed. Queue finished.');
      loopActive = false;
      state = { ...state, running: false, currentJobId: null };
      broadcastState();
      persistState();
      return;
    }

    state = { ...state, currentJobId: nextJob.id };
    broadcastState();
    emitLog('info', `Processing: ${nextJob.input.title}`);

    // Check if content script is on the right page (retry up to 5 times with 3s intervals)
    const pageOk = await checkPageWithRetry(5, 3000);
    if (!pageOk) {
      emitLog('error', 'Not on suno.com/create page. Queue paused — navigate to suno.com/create and press Start again.');
      loopActive = false;
      state = { ...state, running: false, currentJobId: null };
      broadcastState();
      persistState();
      return;
    }

    if (!loopActive) break;

    updateJob(nextJob.id, { status: 'filling' });

    // Send job to content script
    const success = await executeJobViaContentScript(nextJob);

    // Re-read retryCount from state since updateJob may have changed it
    const currentJob = state.jobs.find((j) => j.id === nextJob.id);
    const retryCount = currentJob?.retryCount ?? 0;

    if (!success && retryCount < settings.maxRetries) {
      emitLog('warn', `Retrying "${nextJob.input.title}" (attempt ${retryCount + 2}/${settings.maxRetries + 1})`);
      updateJob(nextJob.id, { status: 'pending', retryCount: retryCount + 1 });
      await delay(2000);
      continue;
    }

    if (!loopActive) break;

    // Delay between songs
    if (loopActive) {
      emitLog('info', `Waiting ${settings.delayBetweenSongs / 1000}s before next song...`);
      await delay(settings.delayBetweenSongs);
    }
  }
}

async function checkPageWithRetry(maxAttempts: number, intervalMs: number): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (!loopActive) return false;

    // Step 1: Find a suno.com/create tab by inspecting tab URLs directly
    const tab = await findSunoCreateTab();
    if (!tab) {
      emitLog('warn', `No suno.com/create tab found (${i + 1}/${maxAttempts})`);
      if (i < maxAttempts - 1) await delay(intervalMs);
      continue;
    }

    activeTabId = tab.id!;
    emitLog('info', `Found suno tab (id=${activeTabId}, url=${tab.url})`);

    // Step 2: Ping the content script to check if it's alive
    const alive = await pingContentScript(activeTabId);
    if (alive) return true;

    // Step 3: Content script not responding — try to inject it
    emitLog('warn', 'Content script not responding, attempting injection...');
    const injected = await injectContentScript(activeTabId);
    if (injected) {
      await delay(1000); // let it initialize
      const aliveAfterInject = await pingContentScript(activeTabId);
      if (aliveAfterInject) {
        emitLog('info', 'Content script injected and responding');
        return true;
      }
    }

    emitLog('warn', `Content script still not ready (${i + 1}/${maxAttempts})`);
    if (i < maxAttempts - 1) await delay(intervalMs);
  }
  return false;
}

async function executeJobViaContentScript(job: Job): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(false);
    }, settings.generationTimeout + 30_000); // extra buffer on top of generation timeout

    // Create a one-time listener for progress updates
    const listener = (message: JobProgressMessage) => {
      if (message.type !== 'JOB_PROGRESS' || message.payload.jobId !== job.id) return;

      const { status, error } = message.payload;
      updateJob(job.id, { status, error });

      if (status === 'completed') {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        emitLog('info', `Completed: ${job.input.title}`);
        resolve(true);
      } else if (status === 'failed') {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        emitLog('error', `Failed: ${job.input.title} - ${error}`);
        resolve(false);
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    // Send execute command to content script
    sendToContentScript({
      type: 'EXECUTE_JOB',
      payload: { job, settings },
    });
  });
}

/** Find a tab whose URL contains suno.com/create */
async function findSunoCreateTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => {
      if (chrome.runtime.lastError) {
        emitLog('error', `tabs.query error: ${chrome.runtime.lastError.message}`);
        resolve(null);
        return;
      }
      // Find a tab with /create in the suno.com URL
      const createTab = tabs.find(
        (t) => t.url && /https:\/\/(www\.)?suno\.com\/create/.test(t.url),
      );
      if (createTab) {
        resolve(createTab);
        return;
      }
      // Log what suno tabs we did find (if any) for diagnostics
      const sunoTabs = tabs.filter((t) => t.url?.includes('suno.com'));
      if (sunoTabs.length > 0) {
        emitLog('warn', `Found ${sunoTabs.length} suno.com tab(s) but none on /create: ${sunoTabs.map((t) => t.url).join(', ')}`);
      }
      resolve(null);
    });
  });
}

/** Send a lightweight ping to verify the content script is alive */
async function pingContentScript(tabId: number): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'CHECK_PAGE' }, (response) => {
      if (chrome.runtime.lastError) {
        emitLog('warn', `Ping failed (tab ${tabId}): ${chrome.runtime.lastError.message}`);
        resolve(false);
        return;
      }
      resolve(!!response);
    });
  });
}

/** Programmatically inject the content script into a tab */
async function injectContentScript(tabId: number): Promise<boolean> {
  try {
    const manifest = chrome.runtime.getManifest();
    const csFile = manifest.content_scripts?.[0]?.js?.[0];
    if (!csFile) {
      emitLog('error', 'No content script file found in manifest');
      return false;
    }
    emitLog('info', `Injecting content script: ${csFile}`);
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [csFile],
    });
    return true;
  } catch (e) {
    emitLog('error', `Content script injection failed: ${(e as Error).message}`);
    return false;
  }
}

// ---- Helpers ----

function updateJob(id: string, updates: Partial<Job>): void {
  state = {
    ...state,
    jobs: state.jobs.map((j) =>
      j.id === id ? { ...j, ...updates, updatedAt: Date.now() } : j,
    ),
  };
  broadcastState();
  persistState();
}

function broadcastState(): void {
  const message: QueueStateUpdate = {
    type: 'QUEUE_STATE_UPDATE',
    payload: state,
  };
  chrome.runtime.sendMessage(message).catch(() => {
    // Side panel might not be open
  });
}

export function emitLog(level: 'info' | 'warn' | 'error', message: string): void {
  const log: LogEntry = {
    type: 'LOG',
    payload: { level, message, timestamp: Date.now() },
  };
  chrome.runtime.sendMessage(log).catch(() => { });
}

function sendToContentScript(message: unknown, callback?: (response: any) => void): void {
  if (!activeTabId) {
    if (callback) callback(null);
    return;
  }
  chrome.tabs.sendMessage(activeTabId, message, (response) => {
    if (chrome.runtime.lastError) {
      if (callback) callback(null);
      return;
    }
    if (callback) callback(response);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function persistState(): void {
  chrome.storage.local.set({ [STORAGE_KEY_QUEUE]: state });
}

// ---- Init: restore persisted state ----

export async function restoreState(): Promise<void> {
  const data = await chrome.storage.local.get([STORAGE_KEY_QUEUE, STORAGE_KEY_SETTINGS]);

  if (data[STORAGE_KEY_QUEUE]) {
    const restored = data[STORAGE_KEY_QUEUE] as QueueState;
    // Reset running state on restore (service worker restarted)
    restored.running = false;
    restored.currentJobId = null;
    // Reset any in-progress jobs back to pending
    restored.jobs = restored.jobs.map((j) => {
      if (['filling', 'creating', 'waiting', 'downloading'].includes(j.status)) {
        return { ...j, status: 'pending' as const };
      }
      return j;
    });
    state = restored;
  }

  if (data[STORAGE_KEY_SETTINGS]) {
    settings = { ...settings, ...data[STORAGE_KEY_SETTINGS] };
  }
}
