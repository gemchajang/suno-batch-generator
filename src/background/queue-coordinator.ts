import type { Job, QueueState, LibrarySong } from '../types/job';
import type { SongInput, Settings, LogEntry, QueueStateUpdate, JobProgressMessage } from '../types/messages';
import {
  DEFAULT_DELAY_BETWEEN_SONGS,
  DEFAULT_GENERATION_TIMEOUT,
  DEFAULT_MAX_RETRIES,
  STORAGE_KEY_QUEUE,
  STORAGE_KEY_SETTINGS,
  DEFAULT_DOWNLOAD_FORMAT,
} from '../config/constants';

let state: QueueState = {
  jobs: [],
  running: false,
  activeJobIds: [],
  library: [],
};

let settings: Settings = {
  delayBetweenSongs: DEFAULT_DELAY_BETWEEN_SONGS,
  generationTimeout: DEFAULT_GENERATION_TIMEOUT,
  maxRetries: DEFAULT_MAX_RETRIES,
  downloadPath: 'SunoMusic', // Default subdirectory
  downloadFormat: DEFAULT_DOWNLOAD_FORMAT,
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
  state = { jobs: [], running: false, activeJobIds: [], library: state.library };
  loopActive = false;
  broadcastState();
  persistState();
  emitLog('info', 'Queue cleared');
}

export function addLibrarySongs(songs: LibrarySong[]): void {
  const existingIdSet = new Set(state.library.map(s => s.id));
  const newSongs = songs.filter(s => !existingIdSet.has(s.id));

  if (newSongs.length > 0) {
    state = {
      ...state,
      library: [...state.library, ...newSongs]
    };
    broadcastState();
    persistState();
    emitLog('info', `Added ${newSongs.length} song(s) to Library`);
  }
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
  state = { ...state, running: false, activeJobIds: [] };
  broadcastState();
  persistState();
  emitLog('info', 'Queue stopped');

  // Abort only the active jobs in the main queue
  state.activeJobIds.forEach(id => {
    sendToContentScript({ type: 'ABORT_JOB', payload: { jobId: id } });
  });
}

async function runLoop(): Promise<void> {
  while (loopActive) {
    // Pick up to 3 pending jobs
    const pendingJobs = state.jobs.filter((j) => j.status === 'pending');
    if (pendingJobs.length === 0) {
      // Check if there are any still running
      const stillRunning = state.jobs.some((j) => ['filling', 'creating', 'waiting', 'downloading'].includes(j.status));
      if (!stillRunning) {
        emitLog('info', 'All jobs processed. Queue finished.');
        loopActive = false;
        state = { ...state, running: false, activeJobIds: [] };
        broadcastState();
        persistState();
        return;
      } else {
        // Wait a bit before checking again, some manual jobs might be running
        await delay(2000);
        continue;
      }
    }

    const batch = pendingJobs.slice(0, 3);
    const batchIds = batch.map(j => j.id);
    state = { ...state, activeJobIds: batchIds };
    broadcastState();
    emitLog('info', `Starting batch of ${batch.length} jobs: ${batch.map(j => j.input.title).join(', ')}`);

    // Check if content script is on the right page
    const pageOk = await checkPageWithRetry(5, 3000);
    if (!pageOk) {
      emitLog('error', 'Not on suno.com/create page. Queue paused — navigate to suno.com/create and press Start again.');
      loopActive = false;
      state = { ...state, running: false, activeJobIds: [] };
      broadcastState();
      persistState();
      return;
    }

    if (!loopActive) break;

    // Phase 1: Sequential Trigger (filling & creating)
    const monitorPromises: Promise<boolean>[] = [];

    for (const job of batch) {
      if (!loopActive) break;

      updateJob(job.id, { status: 'filling' });
      emitLog('info', `[1/3] Triggering: ${job.input.title}`);

      const triggerResult = await triggerJobViaContentScript(job);

      // Re-read job from state
      const currentJob = state.jobs.find((j) => j.id === job.id);

      if (!triggerResult.success) {
        const retryCount = currentJob?.retryCount ?? 0;
        if (retryCount < settings.maxRetries) {
          emitLog('warn', `Trigger Failed. Retrying "${job.input.title}" later (attempt ${retryCount + 2}/${settings.maxRetries + 1})`);
          updateJob(job.id, { status: 'pending', retryCount: retryCount + 1 });
        } else {
          emitLog('error', `Trigger Failed permanently for "${job.input.title}"`);
          updateJob(job.id, { status: 'failed', error: triggerResult.error });
        }
        continue; // Skip monitoring for this job
      }

      // If trigger was successful, queue it for parallel monitoring
      if (triggerResult.songIds && triggerResult.songIds.length > 0) {
        updateJob(job.id, { songIds: triggerResult.songIds });
        const libraryEntries: LibrarySong[] = triggerResult.songIds.map(id => ({
          id,
          title: job.input.title
        }));
        addLibrarySongs(libraryEntries);
        // We do *not* await this immediately — we fire and collect the promise
        const p = monitorJobViaContentScript(currentJob!, triggerResult.songIds);
        monitorPromises.push(p);
      }

      // Small delay between inputs to avoid overwhelming the UI
      await delay(2000);
    }

    if (!loopActive) break;

    // Phase 2: Parallel Monitor (waiting & downloading)
    if (monitorPromises.length > 0) {
      emitLog('info', `[2/3] Waiting for generation & download in parallel (${monitorPromises.length} jobs)...`);
      await Promise.all(monitorPromises);
    }

    if (!loopActive) break;

    // Delay between cycles
    if (loopActive) {
      emitLog('info', `Batch finished. Waiting ${settings.delayBetweenSongs / 1000}s before next batch...`);
      await delay(settings.delayBetweenSongs);
    }
  }
}

export async function checkPageWithRetry(maxAttempts: number, intervalMs: number, requireLoopActive: boolean = true): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (requireLoopActive && !loopActive) return false;

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

async function triggerJobViaContentScript(job: Job): Promise<{ success: boolean; songIds?: string[]; error?: string }> {
  return new Promise((resolve) => {
    // Listen for progress updates specifically from this trigger call
    const listener = (message: JobProgressMessage) => {
      if (message.type !== 'JOB_PROGRESS' || message.payload.jobId !== job.id) return;

      const { status, error, songIds } = message.payload;
      updateJob(job.id, { status, error });

      if (status === 'waiting') {
        chrome.runtime.onMessage.removeListener(listener);
        resolve({ success: true, songIds });
      } else if (status === 'failed') {
        chrome.runtime.onMessage.removeListener(listener);
        resolve({ success: false, error });
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    // Send TRIGGER command
    sendToContentScript({
      type: 'TRIGGER_JOB',
      payload: { job, settings },
    });
  });
}

async function monitorJobViaContentScript(job: Job, songIds: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(false);
    }, settings.generationTimeout + 120_000); // Wait max timeout + 2 mins buffer

    const listener = (message: JobProgressMessage) => {
      if (message.type !== 'JOB_PROGRESS' || message.payload.jobId !== job.id) return;

      const { status, error } = message.payload;
      // We don't overwrite manual statuses if it failed already elsewhere
      updateJob(job.id, { status, error });

      if (status === 'completed') {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        resolve(true);
      } else if (status === 'failed') {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        resolve(false);
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    // Send MONITOR command
    sendToContentScript({
      type: 'MONITOR_JOB',
      payload: { job, settings, songIds },
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

export function updateJob(id: string, updates: Partial<Job>): void {
  state = {
    ...state,
    jobs: state.jobs.map((j) =>
      j.id === id ? { ...j, ...updates, updatedAt: Date.now() } : j,
    ),
  };
  broadcastState();
  persistState();
}

export async function manualRunJob(jobId: string): Promise<void> {
  const job = state.jobs.find(j => j.id === jobId);
  if (!job) return;

  emitLog('info', `[Manual Run] Requested for: ${job.input.title}`);

  if (state.running) {
    emitLog('warn', `[Manual Run] Cannot run manually while main queue is running. Stop the queue first.`);
    return;
  }

  // Set the target job to pending and clear others if needed, or simply trigger it directly.
  // Actually, simplest is to let the background route it to content script directly, but we need state tracking.
  updateJob(job.id, { status: 'filling', retryCount: 0 });

  const pageOk = await checkPageWithRetry(3, 2000, false);
  if (!pageOk) {
    emitLog('error', '[Manual Run] Not on suno.com/create page');
    updateJob(job.id, { status: 'failed', error: 'Not on create page' });
    return;
  }

  emitLog('info', `[Manual Run] Triggering UI for: ${job.input.title}`);
  const triggerResult = await triggerJobViaContentScript(job);

  const currentJob = state.jobs.find((j) => j.id === job.id);

  if (!triggerResult.success) {
    emitLog('error', `[Manual Run] Trigger Failed for "${job.input.title}"`);
    updateJob(job.id, { status: 'failed', error: triggerResult.error });
    return;
  }

  if (triggerResult.songIds && triggerResult.songIds.length > 0) {
    updateJob(job.id, { songIds: triggerResult.songIds, status: 'completed' });
    emitLog('info', `[Manual Run] Generation triggered. Added to Library.`);

    // Add to library
    const libraryEntries: LibrarySong[] = triggerResult.songIds.map(id => ({
      id,
      title: job.input.title
    }));
    addLibrarySongs(libraryEntries);
  }
}

export async function manualDownloadJob(jobId: string, title?: string): Promise<void> {
  let job = state.jobs.find(j => j.id === jobId);

  // If job doesn't exist (e.g., fetched from Library tab), create a temporary dummy job
  if (!job) {
    emitLog('info', `[Manual Download] Job ${jobId} not in local queue. Constructing temporary job for download.`);
    // Construct a minimal Job object that satisfies the type
    job = {
      id: jobId,
      input: { title: title || `Library Song ${jobId.substring(0, 5)}`, lyrics: '', style: '' },
      status: 'pending',
      songIds: [jobId],
      retryCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    } as Job;
  }

  // Double check (for TS type narrowing)
  if (!job) return;

  if (!job.songIds || job.songIds.length === 0) {
    emitLog('error', `[Manual Download] No song IDs found for "${job.input.title}". Please run it first to generate IDs.`);
    return;
  }

  emitLog('info', `[Manual Download] Triggered for: ${job.input.title}`);

  const pageOk = await checkPageWithRetry(3, 2000, false);
  if (!pageOk) {
    emitLog('error', '[Manual Download] Not on suno.com/create page');
    return;
  }

  emitLog('info', `[Manual Download] Checking status and downloading ${job.songIds.length} song(s)...`);
  // Use the reliable monitor script. It checks API status, which will be "complete", and triggers the API download.
  const tempId = job.id;
  state = { ...state, activeJobIds: [...state.activeJobIds, tempId] };
  await monitorJobViaContentScript(job, job.songIds);
  state = { ...state, activeJobIds: state.activeJobIds.filter(id => id !== tempId) };
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
    restored.activeJobIds = [];
    // Reset any in-progress jobs back to pending
    restored.jobs = restored.jobs.map((j) => {
      if (['filling', 'creating', 'waiting', 'downloading'].includes(j.status)) {
        return { ...j, status: 'pending' as const };
      }
      return j;
    });
    if (!restored.library) restored.library = [];
    state = restored;
  }

  if (data[STORAGE_KEY_SETTINGS]) {
    settings = { ...settings, ...data[STORAGE_KEY_SETTINGS] };
  }
}
