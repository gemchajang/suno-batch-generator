import type { Job } from '../types/job';
import type { Settings } from '../types/messages';
import { POST_CREATE_DELAY } from '../config/constants';
import { clickElement, delay, fillInput, getClerkToken } from './dom-utils';
import { resolveSelectorWithWait } from './selectors-runtime';
// import { monitorGeneration } from './generation-monitor'; // Removed


export type ProgressCallback = (status: string, error?: string) => void;

let aborted = false;
let running = false;
let currentJobId: string | null = null;

// Version Stamp for Verification
console.log('[SBG] Automation Logic Iteration 15 Loaded (XPath + Exclusions)');

export function abortCurrentJob(): void {
  aborted = true;
}

/**
 * Execute a single job: fill form → create → wait → download.
 */
export async function executeJob(
  job: Job,
  settings: Settings,
  onProgress: ProgressCallback,
): Promise<void> {
  aborted = false;

  // Step 1: CHECK
  log(`Starting job: ${job.input.title} (UI Control + Intercept)`);
  onProgress('filling');

  if (!isCreatePage()) {
    throw new Error('Not on suno.com/create page');
  }

  // Step 2: FILL - switch to Custom mode
  log('Switching to Custom mode...');
  await switchToCustomMode();
  checkAbort();

  // Clear existing form first
  log('Clearing form...');
  await clearForm();
  checkAbort();

  // Fill lyrics first (skip if instrumental — leave blank for instrumental)
  if (!job.input.instrumental && job.input.lyrics) {
    log('Filling lyrics...');
    const lyricsEl = await resolveSelectorWithWait('lyricsInput');
    if (!lyricsEl) throw new Error('Could not find lyrics input');
    await fillInput(lyricsEl, job.input.lyrics);
    checkAbort();
  }

  // Fill style
  log('Filling style...');
  await fillStyleField(job.input.style);
  checkAbort();

  // Fill title
  log('Filling title...');
  await fillTitleField(job.input.title);
  checkAbort();

  // Step 3: CREATE & INTERCEPT
  log('Clicking Create button and waiting for network response...');
  onProgress('creating');

  const createBtn = await resolveSelectorWithWait('createButton');
  if (!createBtn) throw new Error('Could not find Create button');

  // Start listening for intercept BEFORE clicking
  const interceptPromise = waitForGenerationIntercept(30000);

  clickElement(createBtn);
  await delay(1000);

  // Wait for the API response to get IDs
  let songIds: string[] = [];
  try {
    songIds = await interceptPromise;
    log(`Intercepted Song IDs: ${songIds.join(', ')}`);
  } catch (e: any) {
    throw new Error(`Failed to capture generation request: ${e.message}`);
  }

  checkAbort();

  // Step 4: WAIT (Poll API)
  log('Waiting for generation to complete (API polling)...');
  onProgress('waiting');

  const token = await getClerkToken();
  if (!token) throw new Error('Could not get auth token for polling');

  // Map to store audio URLs from polling
  const audioUrls = new Map<string, string | null>();

  // For WAV downloads, we must wait for 'complete' status, 'streaming' is not enough for conversion
  const waitForComplete = settings.downloadFormat === 'wav';

  try {
    const results = await Promise.all(songIds.map(id => pollForCompletion(id, token, waitForComplete)));
    songIds.forEach((id, index) => {
      audioUrls.set(id, results[index]);
    });
  } catch (e: any) {
    throw new Error(`Generation polling failed: ${e.message}`);
  }

  checkAbort();

  // Step 5: DOWNLOAD
  log('Generation complete. Triggering downloads...');
  onProgress('downloading');

  const downloadFolder = job.input.downloadFolder;
  if (downloadFolder) {
    log(`Using per-job download folder: ${downloadFolder}`);
  }

  for (const songId of songIds) {
    checkAbort();
    try {
      const audioUrl = audioUrls.get(songId);
      await downloadSongViaAPI(songId, downloadFolder, job.input.title, audioUrl, settings.downloadFormat);
      log(`✅ Download processed for ${songId}`);
    } catch (e: any) {
      log(`❌ Failed to download ${songId}: ${e.message}`);
    }
  }

  log('Job completed!');
  onProgress('completed');
}

// Interception Helper
function waitForGenerationIntercept(timeoutMs: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('SBG_API_INTERCEPT', handler as EventListener);
      reject(new Error('Timeout waiting for generation network response'));
    }, timeoutMs);

    const handler = (event: CustomEvent) => {
      const { url, responseBody } = event.detail;
      // Check if it's the generate endpoint
      // v2-web is the current one, but keeping generic check
      if ((url.includes('/api/generate/') || url.includes('/api/gen/')) && responseBody?.clips) {
        // Confirm it's a POST response with clips
        log(`Intercepted response from: ${url}`);
        clearTimeout(timeout);
        window.removeEventListener('SBG_API_INTERCEPT', handler as EventListener);
        const ids = responseBody.clips.map((c: any) => c.id);
        resolve(ids);
      }
    };

    window.addEventListener('SBG_API_INTERCEPT', handler as EventListener);
  });
}

// Polling Helper
async function pollForCompletion(songId: string, token: string, waitForComplete: boolean = false): Promise<string | null> {
  const headers = { 'Authorization': `Bearer ${token}` };
  const startTime = Date.now();
  const maxWait = 300000; // 5 min

  while (Date.now() - startTime < maxWait) {
    if (aborted) throw new Error('Job aborted');
    try {
      // Try generic feed API which handles multiple IDs and new logic better
      const res = await fetch(`https://studio-api.prod.suno.com/api/feed/v2?ids=${songId}`, { headers });

      if (res.ok) {
        const data = await res.json();
        const clips = Array.isArray(data) ? data : data.clips;
        const clip = clips?.find((c: any) => c.id === songId);

        if (clip) {
          if (clip.status === 'complete') {
            log(`[SBG] Polling success: ${songId} is complete.`);
            return clip.audio_url || null;
          }
          if (!waitForComplete && clip.status === 'streaming') {
            log(`[SBG] Polling success: ${songId} is streaming (sufficient for MP3).`);
            return clip.audio_url || null;
          }

          if (clip.status === 'error') {
            throw new Error(`Song status is 'error'`);
          }
          log(`[SBG] Song ${songId} status: ${clip.status}...`);
        } else {
          log(`[SBG] Song ${songId} not in feed yet...`);
        }
      } else {
        log(`[SBG] Polling ${songId}: ${res.status} (retrying)`);
      }
    } catch (e) {
      console.log(`[SBG] Polling exception:`, e);
    }
    await delay(5000);
  }
  throw new Error('Timeout waiting for song status');
}


// ... imports and other functions ...

/**
 * Pure API-based download function.
 * If audioUrl is provided, we skip the convert_wav dance and use it directly.
 */
async function downloadSongViaAPI(songId: string, folder?: string, title?: string, knownAudioUrl?: string | null, format: 'mp3' | 'wav' = 'mp3'): Promise<void> {
  log(`[API Download] Starting for song: ${songId}. Format: ${format}`);

  // Step 0: Get Tokens
  const token = await getClerkToken(); // Authorization Bearer
  const storage = await chrome.storage.local.get(['suno_browser_token', 'suno_device_id']);
  const browserToken = storage.suno_browser_token;
  const deviceId = storage.suno_device_id;

  if (format === 'wav' && (!browserToken || !deviceId)) {
    log('[API Download] ⚠️ Missing browser-token or device-id. WAV download might fail. Ensure you have refreshed the page.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (browserToken) headers['browser-token'] = browserToken;
  if (deviceId) {
    headers['device-id'] = deviceId;
    headers['affirm-device-id'] = deviceId;
  }

  let downloadUrl = '';
  let duration = '';

  // STRATEGY SELECTION
  if (format === 'mp3') {
    log(`[API Download] Format set to MP3 using known URL or CDN fallback.`);
    if (knownAudioUrl) {
      downloadUrl = knownAudioUrl;
    } else {
      downloadUrl = `https://cdn1.suno.ai/${songId}.mp3`;
    }
  } else {
    // WAV STRATEGY
    log('[API Download] Format set to WAV. Attempting conversion (via Background Proxy)...');

    // Step 1: Request WAV conversion
    const convertUrl = `https://studio-api.prod.suno.com/api/gen/${songId}/convert_wav/`;
    try {
      // Use PROXY to bypass CORS
      const convertResp = await proxyRequest(convertUrl, 'POST', headers);

      if (!convertResp.ok) {
        log(`[API Download] convert_wav status: ${convertResp.status} (might be already converted or 403)`);
      }
    } catch (e) {
      log(`[API Download] convert_wav error: ${e}`);
    }

    // Step 2: Poll for wav_file URL
    const metaUrl = `https://studio-api.prod.suno.com/api/gen/${songId}/wav_file/`;
    for (let i = 0; i < 15; i++) { // Poll for up to 30s
      try {
        const resp = await proxyRequest(metaUrl, 'GET', headers);
        if (resp.ok && resp.data) {
          if (resp.data.url) {
            downloadUrl = resp.data.url;
            duration = resp.data.duration;
            log(`[API Download] WAV URL found: ${downloadUrl}`);
            break;
          } else {
            if (i % 3 === 0) log(`[API Download] Waiting for WAV url...`);
          }
        }
      } catch (e) { }
      await delay(2000);
    }

    // Step 3: Increment Action Count (Important for stats/anti-abuse)
    try {
      if (downloadUrl) {
        await proxyRequest(`https://studio-api.prod.suno.com/api/gen/${songId}/increment_action_count/`, 'POST', headers, { action: 'download_audio_wav' });
      }
    } catch (e) {
      log(`[API Download] increment_action_count failed: ${e}`);
    }

    // Step 4: Billing Authorization
    try {
      if (downloadUrl) {
        log(`[API Download] Authorizing download via billing API...`);
        const billingRes = await proxyRequest(`https://studio-api.prod.suno.com/api/billing/clips/${songId}/download/`, 'POST', headers);
        if (!billingRes.ok) {
          log(`[API Download] Billing authorization warning: ${billingRes.status}`);
        }
      }
    } catch (e) {
      log(`[API Download] Billing authorization failed: ${e}`);
    }

    // Fallback: If polling failed, try manual construction
    if (!downloadUrl) {
      log('[API Download] WAV URL not found in metadata. Guessing standard CDN URL...');
      downloadUrl = `https://cdn1.suno.ai/${songId}.wav`;
    }
  }

  // Construct filename
  let ext = format === 'wav' ? '.wav' : '.mp3';
  if (format === 'wav' && !downloadUrl) ext = '.mp3';

  let filename = `suno-${songId}${ext}`;
  if (title) {
    const sanitized = title.replace(/[<>:"/\\|?*]/g, '_').trim();
    if (sanitized.length > 0) {
      filename = `${sanitized}${ext}`;
    }
  }

  if (!downloadUrl) {
    throw new Error('No download URL found');
  }

  log(`[API Download] Final URL to fetch: ${downloadUrl}`);

  // Step 5: Trigger Download
  // Rely on background download directly.

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_WAV_FILE',
      url: downloadUrl, // Pass URL directly, let Chrome handle it
      filename: filename,
      folder,
      duration
    }, (res) => {
      if (res?.success) {
        resolve();
      } else {
        reject(new Error(res?.error || 'Download failed'));
      }
    });
  });
}

/**
 * Helper to proxy API requests via background script to bypass CORS
 */
async function proxyRequest(url: string, method: string, headers?: Record<string, string>, body?: any): Promise<{ ok: boolean, status: number, data?: any }> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'PROXY_API_REQUEST',
      url,
      method,
      headers,
      body
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// Helper to log to console and Side Panel
function log(msg: string) {
  console.log(msg);
  try {
    const logEntry = {
      type: 'LOG',
      payload: {
        level: 'info',
        message: msg,
        timestamp: Date.now()
      }
    };
    chrome.runtime.sendMessage(logEntry).catch(() => { });
  } catch (e) {
    // ignore
  }
}

function isCreatePage(): boolean {
  return window.location.href.includes('suno.com/create');
}

async function switchToCustomMode(): Promise<void> {
  const toggle = await resolveSelectorWithWait('customModeToggle', 5000);
  if (!toggle) {
    log('Custom mode toggle not found — assuming already in Custom mode');
    return;
  }

  if (toggle.classList.contains('active')) {
    log('Custom mode already active');
    return;
  }

  log('Clicking Custom mode toggle');
  clickElement(toggle);
  await delay(800);
}

async function clearForm(): Promise<void> {
  const clearBtn = document.querySelector('button[aria-label="Clear all form inputs"]');
  if (clearBtn) {
    clickElement(clearBtn);
    await delay(500);
    log('Form cleared');
  }
}

async function fillTitleField(title: string): Promise<void> {
  const inputs = document.querySelectorAll('input[placeholder*="Song Title" i]');
  let target: Element | null = null;
  for (const el of inputs) {
    if (isVisible(el)) {
      target = el;
      break;
    }
  }
  if (!target) target = await resolveSelectorWithWait('titleInput');
  if (!target) throw new Error('Could not find title input');
  await fillInput(target, title);
}

async function fillStyleField(style: string): Promise<void> {
  // Strategy 1: Look for "Style of Music" placeholder, aria-label, OR maxlength="1000"
  let target: Element | null = null;
  const textareas = document.querySelectorAll('textarea');
  for (const el of textareas) {
    if (!isVisible(el)) continue;
    const placeholder = el.getAttribute('placeholder')?.toLowerCase() || '';
    const aria = el.getAttribute('aria-label')?.toLowerCase() || '';
    const maxLen = el.getAttribute('maxlength');

    // EXPLICIT EXCLUSION: Skip if it looks like Lyrics (or usually maxlen > 1000)
    if (placeholder.includes('lyrics') || aria.includes('lyrics')) continue;
    if (maxLen && parseInt(maxLen) > 1000) continue;

    // Match conditions
    if (maxLen === '1000' || placeholder.includes('style') || placeholder.includes('genre') || aria.includes('style')) {
      target = el;
      break;
    }
  }

  // Strategy 2: Look for Upsample button and find adjacent textarea
  if (!target) {
    const upsampleBtn = document.querySelector('button[aria-label="Upsample styles"]');
    if (upsampleBtn) {
      // It's usually in the same container or nearby
      const container = upsampleBtn.closest('div[class*="css-"]'); // Chakra/Emotion container
      if (container) target = container.querySelector('textarea');
    }
  }

  // Strategy 3: Just resolve from config with wait
  if (!target) target = await resolveSelectorWithWait('styleInput', 5000);

  if (!target) throw new Error('Could not find style input');

  const textarea = target as HTMLTextAreaElement;
  textarea.focus();
  await delay(200);
  textarea.select();
  document.execCommand('selectAll', false);
  document.execCommand('delete', false);
  await delay(100);
  document.execCommand('insertText', false, style);
  await delay(300);
  log(`Style value set to: "${style}"`);
}

// ─────────────────────────────────────────────
// PAGE CONTEXT BRIDGE
// ─────────────────────────────────────────────
// Chrome content scripts run in an isolated JS context.
// React internals (__reactProps$, __reactFiber$) are only
// visible in the PAGE's context. We use chrome.scripting.executeScript
// with world:'MAIN' (via background service worker) to run code there.
// This bypasses page CSP which blocks inline <script> injection.
// ─────────────────────────────────────────────

/**
 * Send a message to the background to execute a function in the page's MAIN world.
 */
function sendExecInPage(action: string, selector?: string): Promise<any> {
  return chrome.runtime.sendMessage({
    type: 'EXEC_IN_PAGE',
    action,
    selector,
  });
}

/**
 * Click an element via React internals executed in the page's MAIN world.
 * Marks the element with a data attribute so the MAIN world script can find it.
 */
async function clickViaPageContext(el: Element): Promise<boolean> {
  el.setAttribute('data-sbg-click', '1');

  try {
    const result = await sendExecInPage('REACT_CLICK', '[data-sbg-click]');

    if (result?.__error) {
      log(`  Page context error: ${result.__error}`);
      return false;
    }
    if (result?.ok) {
      log(`  Page context click: via=${result.via} hit=[${result.hit}]`);
      return true;
    }
    log(`  Page context: ${result?.err || 'no handlers found'}`);
    return false;
  } finally {
    el.removeAttribute('data-sbg-click');
  }
}

/**
 * Hover an element via React internals in page's MAIN world.
 * Needed for Radix UI sub-menu triggers that open on pointer movement.
 */
async function hoverViaPageContext(el: Element): Promise<boolean> {
  el.setAttribute('data-sbg-hover', '1');

  try {
    const result = await sendExecInPage('REACT_HOVER', '[data-sbg-hover]');
    return result?.ok === true;
  } finally {
    el.removeAttribute('data-sbg-hover');
  }
}

/**
 * Run diagnostics in page's MAIN world to check React internals availability.
 */
async function pageContextDiagnostics(): Promise<void> {
  const result = await sendExecInPage('REACT_DIAGNOSTICS');

  if (result?.__error) {
    log(`Page context diagnostics: ${result.__error}`);
    return;
  }

  log(`Page context: ${result.total} buttons, ${result.react} with React props`);
  if (result.candidates) {
    for (const c of result.candidates) {
      log(`  [react] text="${c.text}" aria="${c.aria}" haspopup="${c.hp}" handlers=[${c.h}]`);
    }
  }
}

// ─────────────────────────────────────────────
// DOWNLOAD FLOW
// ─────────────────────────────────────────────

/**
 * Trigger WAV download for a specific song by navigating to its page.
 * The /create page doesn't have three-dot menus visible, so we navigate to the song page.
 */


/**
 * Trigger download when already on a song page (/song/xxx).
 * Called automatically when landing on a song page with the auto-download flag set.
 */




/**
 * LEGACY: Old method that tries to find three-dot menu without knowing which song.
 */


/**
 * Attempt to open the three-dot dropdown menu.
 * Tries page-context React internals first, then DOM event fallbacks.
 */
/**
 * Attempt to open the three-dot dropdown menu.
 * Tries page-context React internals first, then DOM event fallbacks.
 */


/**
 * API-based Automation
 */

export function resetCycle() {
  running = false;
  currentJobId = null;
  log('[SBG] Cycle state reset.');
}

export async function generateSongsFromApi(jobs: any[]) {
  if (running) {
    log('[SBG] Already running a job. Stop it first.');
    return;
  }
  running = true;
  log(`[SBG] Starting API Generation for ${jobs.length} jobs...`);

  try {
    // 1. Get Auth Token
    const tokenRes: any = await chrome.runtime.sendMessage({
      type: 'EXEC_IN_PAGE',
      action: 'REACT_GET_TOKENS'
    });

    log(`[SBG] Auth Token retrieval result: ${JSON.stringify(tokenRes)}`);

    const token = tokenRes?.token;
    if (!token) {
      throw new Error(`Could not retrieve Auth Token. Debug: ${JSON.stringify(tokenRes?.debug || tokenRes?.error)}`);
    }
    log(`[SBG] Auth Token retrieved via ${tokenRes.source}.`);

    // 2. Process Jobs
    for (const job of jobs) {
      checkAbort();
      const { prompt, tags, title, mv, make_instrumental } = job;
      log(`[SBG] Generating: "${title || prompt}"...`);

      // 3. Call Generate API (mimic v2-web request)
      // We explicitly set the model to "chirp-crow" (v4) as per user request/logs.
      const payload = {
        generation_type: "TEXT",
        prompt: prompt || "",
        tags: tags || "",
        title: title || "",
        make_instrumental: make_instrumental ?? false,
        mv: mv || "chirp-crow",
        continue_clip_id: null,
        continue_at: null,
        negative_tags: "",
        transaction_uuid: crypto.randomUUID(),
        metadata: {
          web_client_pathname: "/create",
          is_max_mode: false,
          is_mumble: false, // Default setting
          create_mode: "custom",
          disable_volume_normalization: false,
          can_control_sliders: ["weirdness_constraint", "style_weight"]
          // user_tier and create_session_token are omitted as they might be dynamic/optional or require extra fetch.
          // If strictly required, we might need to fetch billing info first.
        }
      };

      const response = await fetch('https://studio-api.prod.suno.com/api/generate/v2-web/', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'text/plain;charset=UTF-8'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API Request failed: ${response.status} ${errText}`);
      }

      const data = await response.json();
      const clips = data.clips;
      log(`[SBG] Generation started. Batch ID: ${data.id}`);

      // 4. Poll and Download
      const downloadPromises = clips.map(async (clip: any) => {
        const clipId = clip.id;
        log(`[SBG] Polling clip: ${clipId}`);

        // Poll until ready
        let errorCount = 0;
        const startTime = Date.now();

        while (true) {
          checkAbort();

          // Timeout check (e.g., 5 minutes per clip)
          if (Date.now() - startTime > 300000) {
            log(`[SBG] Polling timed out for clip: ${clipId}`);
            break;
          }

          const pollRes = await fetch(`https://studio-api.prod.suno.com/api/gen/${clipId}/`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (!pollRes.ok) {
            if (pollRes.status === 404) {
              errorCount++;
              if (errorCount > 20) { // Give it some time (20 * 3s = 60s)
                log(`[SBG] Clip stuck in 404: ${clipId}`);
                break;
              }
              log(`[SBG] Clip ${clipId} not found yet (404). Retrying...`);
              await new Promise(r => setTimeout(r, 3000));
              continue;
            }
            log(`[SBG] Polling error ${pollRes.status}: ${clipId}`);
            break;
          }

          // Reset error count on success
          errorCount = 0;

          const pollData = await pollRes.json();

          if (pollData.status === 'streaming' || pollData.status === 'complete') {
            log(`[SBG] Clip ready: ${clipId}. Downloading...`);
            await downloadSongViaAPI(clipId, 'API_Downloads', title || 'Untitled');
            break;
          }
          if (pollData.status === 'error') {
            log(`[SBG] Clip generation failed: ${clipId}`);
            break;
          }
          await new Promise(r => setTimeout(r, 3000));
        }
      });

      await Promise.all(downloadPromises);
      log(`[SBG] Batch complete.`);
    }

    log('[SBG] All API jobs finished.');

  } catch (e: any) {
    log(`[SBG] API Generation failed: ${e.message}`);
  } finally {
    running = false;
  }
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

/**
 * TEST ONLY: Find the most recent song on the page and try to download it.
 */
export async function testDownloadLastGeneratedSong(): Promise<void> {
  log('[Test] Looking for a song to download...');

  // Try to find a song link
  const songLink = document.querySelector('a[href*="/song/"]');
  if (!songLink) {
    throw new Error('No songs found on the page to test download.');
  }

  const href = (songLink as HTMLAnchorElement).href;
  const match = href.match(/\/song\/([\w-]+)/);
  if (!match) {
    throw new Error(`Could not extract song ID from link: ${href}`);
  }

  const songId = match[1];

  // Try to find title
  let title = 'Test Download Song';
  // Try to find title element near the link (very heuristic)
  const container = songLink.closest('div[class*="css-"]'); // Generic container
  if (container) {
    const titleEl = container.querySelector('[class*="title"], h3, h4');
    if (titleEl && titleEl.textContent) {
      title = titleEl.textContent.trim();
    }
  }

  log(`[Test] Found song: ${songId} ("${title}")`);
  await downloadSongViaAPI(songId, 'TestDownload', title);
}



function checkAbort(): void {
  if (aborted) throw new Error('Job aborted');
}




