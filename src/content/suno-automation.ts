import type { Job } from '../types/job';
import type { Settings } from '../types/messages';
import { POST_CREATE_DELAY } from '../config/constants';
import { clickElement, forceClick, delay, fillInput, findElementByText, waitForElementByText } from './dom-utils';
import { resolveSelectorWithWait } from './selectors-runtime';
import { monitorGeneration } from './generation-monitor';

export type ProgressCallback = (status: string, error?: string) => void;

let aborted = false;

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
  log(`Starting job: ${job.input.title}`);
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
    log(`Lyrics element: <${lyricsEl.tagName.toLowerCase()}> placeholder="${lyricsEl.getAttribute('placeholder')}"`);
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

  // Step 3: CREATE - click the Create button
  log('Clicking Create button...');
  onProgress('creating');
  const createBtn = await resolveSelectorWithWait('createButton');
  if (!createBtn) throw new Error('Could not find Create button');
  log(`Create button: <${createBtn.tagName.toLowerCase()}> text="${createBtn.textContent?.trim()}"`);
  clickElement(createBtn);

  await delay(POST_CREATE_DELAY);
  checkAbort();

  // Step 4: WAIT - monitor generation
  log('Waiting for generation...');
  onProgress('waiting');
  const result = await monitorGeneration(settings.generationTimeout);
  checkAbort();

  if (result.timedOut) {
    throw new Error('Generation timed out');
  }

  // Step 5: DOWNLOAD - trigger WAV download
  log('Triggering WAV download...');
  onProgress('downloading');
  await triggerWavDownload();
  checkAbort();

  log('Job completed!');
  onProgress('completed');
}

function log(msg: string): void {
  console.log(`[SBG] ${msg}`);
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

  // The dump shows the active button has class "active"
  if (toggle.classList.contains('active')) {
    log('Custom mode already active');
    return;
  }

  log('Clicking Custom mode toggle');
  clickElement(toggle);
  await delay(800);
}

/**
 * Clear all form inputs using the "Clear all form inputs" button.
 */
async function clearForm(): Promise<void> {
  const clearBtn = document.querySelector('button[aria-label="Clear all form inputs"]');
  if (clearBtn) {
    clickElement(clearBtn);
    await delay(500);
    log('Form cleared');
  }
}

/**
 * Fill the title field.
 * The title input has placeholder "Song Title (Optional)".
 * Multiple exist but we need the visible one.
 */
async function fillTitleField(title: string): Promise<void> {
  // Find all matching inputs and pick the visible one
  const inputs = document.querySelectorAll('input[placeholder*="Song Title" i]');
  let target: Element | null = null;

  for (const el of inputs) {
    if (isVisible(el)) {
      target = el;
      break;
    }
  }

  if (!target) {
    target = await resolveSelectorWithWait('titleInput');
  }

  if (!target) throw new Error('Could not find title input');
  log(`Title element: <${target.tagName.toLowerCase()}> placeholder="${target.getAttribute('placeholder')}"`);
  await fillInput(target, title);
}

/**
 * Fill the style textarea.
 * The style field is a tag-input: type text, then tags are created.
 * grandparent class "eg9z14i1" distinguishes it.
 * We type the value and let the field process it.
 */
async function fillStyleField(style: string): Promise<void> {
  // Strategy 1: find by grandparent class
  let target: Element | null = document.querySelector('div.eg9z14i1 textarea');

  // Strategy 2: find textarea near "Upsample styles" button
  if (!target || !isVisible(target)) {
    const upsampleBtn = document.querySelector('button[aria-label="Upsample styles"]');
    if (upsampleBtn) {
      // The textarea is a sibling or nearby in the same container
      const container = upsampleBtn.closest('div[class*="css-"]');
      if (container) {
        target = container.querySelector('textarea');
      }
    }
  }

  // Strategy 3: fallback to selector system
  if (!target || !isVisible(target)) {
    target = await resolveSelectorWithWait('styleInput', 5000);
  }

  if (!target) throw new Error('Could not find style input');
  log(`Style element: <${target.tagName.toLowerCase()}> placeholder="${target.getAttribute('placeholder')}"`);

  // Focus and type the style using keyboard simulation for React compatibility
  const textarea = target as HTMLTextAreaElement;
  textarea.focus();
  await delay(200);

  // Clear existing value
  textarea.select();
  document.execCommand('selectAll', false);
  document.execCommand('delete', false);
  await delay(100);

  // Type the style text using execCommand for React compatibility
  document.execCommand('insertText', false, style);
  await delay(300);

  log(`Style value set to: "${style}"`);
}

/**
 * Trigger WAV download for the most recently created song.
 *
 * DOM dump analysis (2025):
 *  - Per-clip action buttons: [Like][Dislike][Share][Publish clip][three-dot]
 *  - The three-dot button (empty text, no aria-label) is right after "Publish clip"
 *  - When a clip is selected, a detail panel appears on the right side
 *  - The detail panel has action buttons including "Download"
 *  - CAUTION: Do NOT click parent containers — they can accidentally hit
 *    the "Publish clip" button, opening the Publish workflow dialog
 */
async function triggerWavDownload(): Promise<void> {
  log('Starting download process...');

  // Close any open dialogs first (e.g. Publish dialog from a previous attempt)
  await closeOpenDialogs();

  // Step 0: Check if Download is already visible
  let downloadBtn = findDownloadButton();
  if (downloadBtn) {
    log('Download button already visible');
    await clickDownloadAndSelectFormat(downloadBtn);
    return;
  }

  const allPublishBtns = document.querySelectorAll('button[aria-label="Publish clip"]');
  if (allPublishBtns.length === 0) {
    throw new Error('No song clips found — cannot download');
  }
  log(`Found ${allPublishBtns.length} clip(s)`);
  const publishBtn = allPublishBtns[0];

  // Step 1: Click the three-dot button (primary strategy)
  downloadBtn = await tryThreeDotButton(publishBtn);

  // Step 2: Select clip by clicking its title/artwork area (no parent containers)
  if (!downloadBtn) {
    await closeOpenDialogs();
    downloadBtn = await selectClipByContentArea(publishBtn);
  }

  // Step 3: Try "More menu contents" button (playbar area)
  if (!downloadBtn) {
    await closeOpenDialogs();
    const moreBtn = document.querySelector('button[aria-label="More menu contents"]');
    if (moreBtn && isVisible(moreBtn)) {
      log('Step 3: clicking "More menu contents" button');
      forceClick(moreBtn);
      await delay(1500);
      downloadBtn = findDownloadButton();
      if (!downloadBtn) {
        downloadBtn = await waitForElementByText('button', 'Download', 3000);
      }
    }
  }

  // Step 4: Try "More Options" button (might be inside expanded detail)
  if (!downloadBtn) {
    await closeOpenDialogs();
    const moreOptionsBtn = findElementByText('button', 'More Options');
    if (moreOptionsBtn && isVisible(moreOptionsBtn)) {
      log('Step 4: clicking "More Options" button');
      forceClick(moreOptionsBtn);
      await delay(1500);
      downloadBtn = findDownloadButton();
      if (!downloadBtn) {
        downloadBtn = await waitForElementByText('button', 'Download', 3000);
      }
    }
  }

  if (!downloadBtn) {
    logDiagnostics();
    throw new Error('Could not find Download menu item');
  }

  await clickDownloadAndSelectFormat(downloadBtn);
}

/** Close any open dialogs (Publish dialog, cover art dialog, etc.) */
async function closeOpenDialogs(): Promise<void> {
  const closeBtns = document.querySelectorAll('button[aria-label="Close"]');
  for (const btn of closeBtns) {
    if (isVisible(btn)) {
      log('Closing open dialog...');
      forceClick(btn);
      await delay(500);
    }
  }
}

/** Step 1: Click the three-dot button right after "Publish clip" */
async function tryThreeDotButton(publishBtn: Element): Promise<Element | null> {
  const clipRow = publishBtn.parentElement;
  if (!clipRow) return null;

  // The three-dot button is the next sibling button after "Publish clip"
  let menuBtn: Element | null = null;
  let sibling = publishBtn.nextElementSibling;
  while (sibling) {
    if (sibling.tagName === 'BUTTON') {
      menuBtn = sibling;
      break;
    }
    sibling = sibling.nextElementSibling;
  }

  if (!menuBtn) {
    const btns = clipRow.querySelectorAll('button');
    if (btns.length > 0) {
      menuBtn = btns[btns.length - 1];
    }
  }

  if (!menuBtn) return null;

  log(`Step 1: clicking three-dot button (text="${menuBtn.textContent?.trim()}", aria="${menuBtn.getAttribute('aria-label')}")`);
  forceClick(menuBtn);
  await delay(2000);

  let downloadBtn = findDownloadButton();
  if (downloadBtn) return downloadBtn;

  // Poll for up to 3 seconds
  downloadBtn = await waitForElementByText('button', 'Download', 3000);
  return downloadBtn;
}

/**
 * Step 2: Select the clip by clicking its non-button content area.
 * Uses elementFromPoint to find title/artwork area to the LEFT of action buttons.
 * Does NOT click parent containers (risk of hitting Publish button).
 */
async function selectClipByContentArea(publishBtn: Element): Promise<Element | null> {
  log('Step 2: selecting clip by clicking its content area...');

  const pubRect = publishBtn.getBoundingClientRect();
  const yCenter = pubRect.top + pubRect.height / 2;

  // Try positions to the LEFT of the action buttons (title/artwork area)
  const xPositions = [
    pubRect.left - 200,
    pubRect.left - 100,
    pubRect.left - 50,
  ];

  for (const x of xPositions) {
    if (x < 10) continue;

    const targetEl = document.elementFromPoint(x, yCenter);
    if (!targetEl) continue;

    // Strictly skip buttons, inputs, links, and anything inside a button
    if (targetEl.tagName === 'BUTTON' || targetEl.tagName === 'INPUT' ||
        targetEl.tagName === 'A' || targetEl.tagName === 'SVG' ||
        targetEl.closest('button') || targetEl.closest('a') ||
        targetEl.closest('[aria-label="Publish clip"]')) {
      log(`  Skipping element at (${Math.round(x)}): <${targetEl.tagName.toLowerCase()}> (interactive)`);
      continue;
    }

    log(`  Clicking at (${Math.round(x)}, ${Math.round(yCenter)}): <${targetEl.tagName.toLowerCase()}> class="${(targetEl as HTMLElement).className?.substring?.(0, 40) ?? ''}"`);
    forceClick(targetEl);
    await delay(2000);

    const downloadBtn = findDownloadButton();
    if (downloadBtn) return downloadBtn;

    const polled = await waitForElementByText('button', 'Download', 2000);
    if (polled) return polled;
  }

  return null;
}

/** Search for a visible Download button */
function findDownloadButton(): Element | null {
  const selectors = ['button', '[role="menuitem"]', 'a', 'div'];
  for (const sel of selectors) {
    const el = findElementByText(sel, 'Download');
    if (el && isVisible(el)) return el;
  }
  return null;
}

/** Click Download and handle WAV format selection if it appears */
async function clickDownloadAndSelectFormat(downloadBtn: Element): Promise<void> {
  log(`Clicking Download: <${downloadBtn.tagName.toLowerCase()}> text="${downloadBtn.textContent?.trim()}"`);
  forceClick(downloadBtn);
  await delay(1500);

  const wavOption = await waitForElementByText(
    'button, a, div, span, [role="menuitem"]', 'WAV', 3000,
  );

  if (!wavOption) {
    log('No WAV option found — download may have started directly');
    return;
  }

  log(`Clicking WAV: <${wavOption.tagName.toLowerCase()}>`);
  forceClick(wavOption);
  await delay(1000);
}

/** Log diagnostic info when download fails */
function logDiagnostics(): void {
  const allBtns = Array.from(document.querySelectorAll('button')).filter(isVisible);
  log(`Diagnostics: ${allBtns.length} visible buttons`);

  for (const btn of allBtns) {
    const text = btn.textContent?.trim().toLowerCase() ?? '';
    if (text.includes('download') || text.includes('wav') || text.includes('mp3') ||
        text.includes('more option') || text.includes('publish')) {
      log(`  Button: text="${btn.textContent?.trim()}" aria="${btn.getAttribute('aria-label')}"`);
    }
  }

  const panels = document.querySelectorAll(
    '[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper], .chakra-popover__content',
  );
  log(`Open panels/dialogs: ${panels.length}`);
  panels.forEach((p, i) => {
    log(`  Panel[${i}]: ${p.textContent?.substring(0, 200)}`);
  });
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function checkAbort(): void {
  if (aborted) {
    throw new Error('Job aborted');
  }
}
