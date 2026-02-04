import type { Job } from '../types/job';
import type { Settings } from '../types/messages';
import { POST_CREATE_DELAY } from '../config/constants';
import { clickElement, forceClick, delay, fillInput, findElementByText, waitForElementByText, getClerkToken } from './dom-utils';
import { resolveSelectorWithWait, resolveSelector } from './selectors-runtime';
import { monitorGeneration } from './generation-monitor';

export type ProgressCallback = (status: string, error?: string) => void;

let aborted = false;

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

  if (result.songUrl) {
    // Use the song URL to find the specific song card
    log(`Looking for song card with URL: ${result.songUrl}`);
    await triggerWavDownloadForSong(result.songUrl);
  } else {
    // Fallback: use the old method (find most recent)
    log('No song URL found, using fallback method');
    await triggerWavDownload();
  }

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
  let target: Element | null = document.querySelector('div.eg9z14i1 textarea');
  if (!target || !isVisible(target)) {
    const upsampleBtn = document.querySelector('button[aria-label="Upsample styles"]');
    if (upsampleBtn) {
      const container = upsampleBtn.closest('div[class*="css-"]');
      if (container) target = container.querySelector('textarea');
    }
  }
  if (!target || !isVisible(target)) target = await resolveSelectorWithWait('styleInput', 5000);
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
async function triggerWavDownloadForSong(songUrl: string): Promise<void> {
  log(`Navigating to song page: ${songUrl}`);

  // Navigate to the song's individual page
  const fullUrl = `https://suno.com${songUrl}`;
  log(`Full URL: ${fullUrl}`);

  // Open in same tab
  window.location.href = fullUrl;

  // Wait for navigation (this script will be reloaded on the new page)
  // We need to set a flag so the script knows to auto-download on the new page
  sessionStorage.setItem('sbg_auto_download', 'true');
  sessionStorage.setItem('sbg_song_url', songUrl);
}

/**
 * Trigger download when already on a song page (/song/xxx).
 * Called automatically when landing on a song page with the auto-download flag set.
 */
export async function triggerDownloadOnSongPage(): Promise<void> {
  log('Starting download from song page...');
  await closeOpenDialogs();

  // On the individual song page, find the three-dot menu button
  log('Looking for three-dot menu on song page...');

  let menuBtn: Element | null = null;

  // Strategy 1: Look for button with aria-label containing "More" or "Menu"
  const buttons = Array.from(document.querySelectorAll('button'));

  for (const btn of buttons) {
    const aria = btn.getAttribute('aria-label') || '';
    if (aria.toLowerCase().includes('more') || aria.toLowerCase().includes('menu')) {
      menuBtn = btn;
      log(`Found menu button via aria-label: "${aria}"`);
      break;
    }
  }

  // Strategy 2: Look for three-dot icon (3 circles in SVG)
  if (!menuBtn) {
    for (const btn of buttons) {
      const svg = btn.querySelector('svg');
      if (!svg) continue;

      const circles = svg.querySelectorAll('circle');
      if (circles.length === 3) {
        menuBtn = btn;
        log('Found three-dot button (3 circles in SVG)');
        break;
      }
    }
  }

  // Strategy 3: Look for button near the player controls
  if (!menuBtn) {
    // Find any button that's not one of the known action buttons
    const knownLabels = ['like', 'dislike', 'share', 'publish', 'play', 'pause', 'edit'];
    for (const btn of buttons) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const text = (btn.textContent || '').toLowerCase();

      // Skip known buttons
      if (knownLabels.some(label => aria.includes(label) || text.includes(label))) {
        continue;
      }

      // Check if it has an SVG (likely an icon button)
      const svg = btn.querySelector('svg');
      if (svg && isVisible(btn)) {
        menuBtn = btn;
        log(`Found potential menu button: aria="${aria}" text="${text}"`);
        break;
      }
    }
  }

  if (!menuBtn) {
    log(`Available buttons on page: ${buttons.length}`);
    buttons.filter(isVisible).forEach((btn, idx) => {
      const aria = btn.getAttribute('aria-label') || 'null';
      const text = btn.textContent?.trim() || 'null';
      log(`  Button ${idx}: aria="${aria}" text="${text.substring(0, 40)}"`);
    });
    throw new Error('Could not find three-dot menu button on song page');
  }

  // Open the menu
  log('Opening three-dot menu...');
  const opened = await openThreeDotMenu(menuBtn);
  if (!opened) {
    throw new Error('Failed to open three-dot menu');
  }

  // Find Download option
  log('Looking for Download option...');
  const downloadBtn = await waitForElementByText('button, [role="menuitem"]', 'Download', 5000);

  if (!downloadBtn) {
    throw new Error('Download option not found in menu');
  }

  // Extract Song ID from URL
  const match = window.location.pathname.match(/\/song\/([0-9a-fA-F-]+)/);
  const songId = match ? match[1] : '';
  log(`Extracted songId from URL: ${songId}`);

  // Click Download → WAV
  await handleDownloadClick(downloadBtn, songId);
}

/**
 * Trigger WAV download for the most recently created song.
 * Uses direct selector approach based on user-provided information.
 */
export async function triggerWavDownload(): Promise<void> {
  log('Starting download process...');
  await closeOpenDialogs();

  // Find the first (most recent) song card
  log('Looking for the most recent song card...');
  const songLinks = Array.from(document.querySelectorAll('a[href*="/song/"]'));

  if (songLinks.length === 0) {
    throw new Error('No songs found in the feed');
  }

  const firstLink = songLinks[0] as HTMLAnchorElement;
  log(`Found song link: ${firstLink.href}`);

  // Extract Song ID for direct download fallback
  const songIdMatch = firstLink.href.match(/\/song\/([0-9a-fA-F-]+)/);
  const songId = songIdMatch ? songIdMatch[1] : '';
  log(`Song ID extracted: ${songId}`);

  // Find the song card container - must contain the three-dot button area
  let songCard: Element | null = null;
  let current: Element | null = firstLink;

  for (let i = 0; i < 20 && current; i++) {
    current = current.parentElement;
    if (!current) break;

    // Check if this element contains the three-dot button structure
    const hasShrinkContainer = current.querySelector('div.shrink-0.css-8yp4m0.e13wocgj5');

    if (hasShrinkContainer) {
      songCard = current;
      log(`Found song card at level ${i} (contains three-dot area)`);
      break;
    }

    // Fallback: check for action buttons
    const hasLike = current.querySelector('button[aria-label*="Like"]');
    const hasShare = current.querySelector('button[aria-label*="Share"]');

    if (hasLike && hasShare) {
      songCard = current;
      log(`Found song card at level ${i} (has action buttons)`);
    }
  }

  if (!songCard) {
    throw new Error('Could not find song card container');
  }

  // Find three-dot button using the exact selector from user
  log('Looking for three-dot button...');
  let menuBtn: Element | null = null;

  // Strategy 1: Use exact selector pattern from user's JS path
  // div.shrink-0.css-8yp4m0.e13wocgj5 > div:nth-child(2) > button
  const actionContainer = songCard.querySelector('div.shrink-0.css-8yp4m0.e13wocgj5');

  if (actionContainer) {
    // Get the second child div
    const childDivs = actionContainer.querySelectorAll(':scope > div');
    if (childDivs.length >= 2) {
      const secondDiv = childDivs[1];
      menuBtn = secondDiv.querySelector('button');
      if (menuBtn) {
        log('✅ Found three-dot button via exact selector (div:nth-child(2) > button)');
      }
    }
  }

  // Strategy 2: Fallback - look for button in any .shrink-0 container's second div
  if (!menuBtn) {
    log('Trying fallback: any .shrink-0 second div button...');
    const shrinkContainers = songCard.querySelectorAll('.shrink-0');

    for (const container of shrinkContainers) {
      const divs = container.querySelectorAll(':scope > div');
      if (divs.length >= 2) {
        const btn = divs[1].querySelector('button');
        if (btn) {
          menuBtn = btn;
          log('Found button in shrink-0 second div');
          break;
        }
      }
    }
  }

  // Strategy 3: Last resort - find unknown button (no aria-label)
  if (!menuBtn) {
    log('Last resort: finding button without aria-label...');
    const allButtons = songCard.querySelectorAll('button');
    const knownLabels = ['edit title', 'like clip', 'dislike clip', 'share clip', 'publish clip'];

    for (const btn of allButtons) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const isKnown = knownLabels.some(label => aria.includes(label));

      if (!isKnown && aria === 'null') {
        menuBtn = btn;
        log('Found button without aria-label');
        break;
      }
    }
  }

  // Strategy 3: Find by SVG structure (three dots)
  if (!menuBtn) {
    const buttons = songCard.querySelectorAll('button');
    for (const btn of buttons) {
      const svg = btn.querySelector('svg');
      if (!svg) continue;

      const circles = svg.querySelectorAll('circle');
      if (circles.length === 3) {
        menuBtn = btn;
        log('Found three-dot button by SVG circles');
        break;
      }
    }
  }

  if (!menuBtn) {
    log('Could not find three-dot button, listing all buttons in card:');
    const allButtons = songCard.querySelectorAll('button');
    allButtons.forEach((btn, idx) => {
      const aria = btn.getAttribute('aria-label') || 'null';
      const classes = btn.className || 'null';
      log(`  Button ${idx}: aria="${aria}" class="${classes.substring(0, 50)}"`);
    });
    throw new Error('Could not find three-dot menu button');
  }

  log('Found three-dot button, attempting to open menu...');

  // Click the button to open menu
  const opened = await openThreeDotMenu(menuBtn);

  if (!opened) {
    log('Menu did not open after all attempts');
    // Final desperate attempt: force click again
    forceClick(menuBtn);
    await delay(1000);
  }

  // Check if menu is open
  const menuOpen = isMenuOpen();
  log(`Menu open status: ${menuOpen}`);

  // Find Download option in the opened menu
  log('Looking for Download option in menu...');

  // Search everywhere for Download button
  // Strategy 1: User provided selector for Download button
  // "body > div:nth-child(48) > div > div > div:nth-child(3) > div:nth-child(2) > div.context-menu-item.css-rmbqxm.e13y1j7e3 > button"
  let downloadBtn: Element | null = null;
  const candidateBtn = document.querySelector('div.context-menu-item.css-rmbqxm.e13y1j7e3 > button');
  if (candidateBtn) {
    const text = candidateBtn.textContent?.trim().toLowerCase() || '';
    if (text.includes('download')) {
      downloadBtn = candidateBtn;
      log('Found Download button via specific class selector');
    } else {
      log(`Specific selector found check failed: text="${text}" is not "Download"`);
    }
  }

  if (!downloadBtn) {
    // Debug: list all visible elements with "download" text
    log('Download button not found, searching entire page...');
    const allElements = document.querySelectorAll('*');
    const downloadElements: Element[] = [];

    allElements.forEach(el => {
      const text = el.textContent?.trim().toLowerCase() || '';
      if (text.includes('download') && isVisible(el) && text.length < 50) { // Reject containers
        downloadElements.push(el);
      }
    });

    log(`Found ${downloadElements.length} elements containing "download" (filtered length < 50):`);

    // Pick the best candidate (shortest text)
    if (downloadElements.length > 0) {
      downloadElements.sort((a, b) => (a.textContent?.length || 100) - (b.textContent?.length || 100));
      downloadBtn = downloadElements[0];
      log(`Picked best candidate: <${downloadBtn.tagName}> text="${downloadBtn.textContent?.trim()}"`);
    }
  }

  if (!downloadBtn) {
    // Try scanning portals (last 5 body children)
    const portals = Array.from(document.body.children).slice(-5);
    for (const portal of portals) {
      if (portal.tagName === 'DIV' && isVisible(portal)) {
        // findElementByTextInContainer is now safe (length < 40)
        const found = findElementByTextInContainer(portal, 'button, div', 'Download');
        if (found) {
          downloadBtn = found;
          log('Found Download button in body portal');
          break;
        }
      }
    }
  }

  if (!downloadBtn) {
    // Try waiting for it to appear
    log('Waiting for Download option to appear...');
    downloadBtn = await waitForElementByText('button, [role="menuitem"], div, a, span', 'Download', 5000);
  }

  if (!downloadBtn) {
    throw new Error('Download option not found in menu');
  }

  log('Found Download option!');

  // Click Download to open sub-menu
  await handleDownloadClick(downloadBtn, songId);
}

/**
 * LEGACY: Old method that tries to find three-dot menu without knowing which song.
 */
async function triggerWavDownloadLegacy(): Promise<void> {
  log('Starting download process (LEGACY)...');
  await closeOpenDialogs();

  try {
    await delay(500);

    // Find the three-dot menu button
    log('Finding three-dot menu button...');
    const menuBtn = await findThreeDotMenuButton();
    if (!menuBtn) {
      await logDiagnostics();
      throw new Error('Could not find three-dot menu button');
    }

    // Open the dropdown menu
    log('Opening three-dot menu...');
    const opened = await openThreeDotMenu(menuBtn);
    if (!opened) {
      await logDiagnostics();
      throw new Error('Failed to open three-dot menu');
    }

    // Find Download in the opened menu
    log('Looking for Download option in menu...');
    const dlItem = await waitForElementByText(
      'button, [role="menuitem"], div, a, span',
      'Download',
      5000,
    );
    if (!dlItem) {
      await logDiagnostics();
      throw new Error('Download option not found in opened menu');
    }

    await handleDownloadClick(dlItem, '');
  } finally {
    // revealStyle.remove(); // Removed as we deleted the injection
  }
}

/**
 * Inject CSS to force all buttons visible (removes hover-only hiding).
 */
function injectRevealStyles(): HTMLStyleElement {
  const style = document.createElement('style');
  style.id = 'sbg-reveal-styles';
  style.textContent = `
    /* SBG: Temporarily force-reveal hover-hidden action buttons */
    button {
      opacity: 1 !important;
      visibility: visible !important;
      pointer-events: auto !important;
    }
  `;
  document.head.appendChild(style);
  return style;
}

/**
 * Find the three-dot menu button using multiple strategies.
 */
async function findThreeDotMenuButton(): Promise<Element | null> {
  // Strategy 0: XPath (Golden Path from User)
  // This helps when attributes are missing or complex nesting defeats other strategies.
  const userXPath = '/html/body/div[1]/div[1]/div[2]/div[1]/div/div/div/div/div/div/div/div[5]/div/div/div[3]/div/div/div[1]/div[1]/div[2]/div/div/div[2]/div[2]/button';
  log('  Strategy 0: User XPath...');
  const xPathBtn = getElementByXPath(userXPath);

  if (xPathBtn) {
    const aria = xPathBtn.getAttribute('aria-label') || 'null';
    const text = xPathBtn.textContent?.trim() || 'null';
    const cls = xPathBtn.className || 'null';
    log(`  Found via XPath! aria="${aria}" text="${text}"`);
    log(`  Class="${cls.substring(0, 50)}..."`);
    return xPathBtn;
  } else {
    log('  Strategy 0: XPath element not found.');
  }

  // Strategy 1: Use selector config (now targets aria="More menu contents")
  log('  Strategy 1: selector config...');
  const fromConfig = resolveSelector('songMenuButton');
  if (fromConfig && isVisible(fromConfig)) {
    log(`  Found via config: aria="${fromConfig.getAttribute('aria-label')}" text="${fromConfig.textContent?.trim()}"`);
    return fromConfig;
  }

  // Strategy 2: Icon-only buttons near the first clip's action buttons
  log('  Strategy 2: icon-only buttons near clip...');
  const clipMarker = document.querySelector(
    'button[aria-label="Publish clip"], button[aria-label="Like clip"], button[aria-label="Share clip"]',
  );
  if (clipMarker) {
    const markerRect = clipMarker.getBoundingClientRect();
    const allBtns = Array.from(document.querySelectorAll('button'));

    const candidates = allBtns
      .filter(btn => {
        if (!isVisible(btn) || btn === clipMarker) return false;
        const rect = btn.getBoundingClientRect();
        if (rect.width > 60) return false;
        const yDiff = Math.abs(rect.top - markerRect.top);
        if (yDiff > 150) return false;
        const text = btn.textContent?.trim() || '';
        const aria = btn.getAttribute('aria-label')?.toLowerCase() || '';
        const hasSvg = btn.querySelector('svg') !== null;
        const isMoreLike = aria.includes('more') || aria.includes('menu') ||
          aria.includes('action') || aria.includes('option');
        const isEmptyIcon = (text === '' || text === '\u22EF' || text === '\u00B7\u00B7\u00B7' || text === '...') && hasSvg;
        // Exclude known wrong buttons
        if (aria.includes('profile')) return false;
        if (aria.includes('filter')) return false;
        if (aria.includes('public')) return false;
        if (aria.includes('like')) return false; // Covers "Like", "Dislike"
        if (aria.includes('share')) return false;
        if (aria.includes('publish')) return false;
        return isMoreLike || isEmptyIcon;
      })
      .map(btn => {
        const rect = btn.getBoundingClientRect();
        return {
          btn,
          dist: Math.hypot(
            rect.left + rect.width / 2 - (markerRect.left + markerRect.width / 2),
            rect.top + rect.height / 2 - (markerRect.top + markerRect.height / 2),
          ),
        };
      })
      .sort((a, b) => a.dist - b.dist);

    if (candidates.length > 0 && candidates[0].dist < 400) {
      log(`  Found icon button: dist=${Math.round(candidates[0].dist)}px aria="${candidates[0].btn.getAttribute('aria-label')}"`);
      return candidates[0].btn;
    }
  }

  // Strategy 3: Wait for selector config (element may need time to render)
  log('  Strategy 3: waiting up to 5s...');
  return await resolveSelectorWithWait('songMenuButton', 5000);
}

/**
 * Attempt to open the three-dot dropdown menu.
 * Tries page-context React internals first, then DOM event fallbacks.
 */
/**
 * Attempt to open the three-dot dropdown menu.
 * Tries page-context React internals first, then DOM event fallbacks.
 */
async function openThreeDotMenu(menuBtn: Element): Promise<boolean> {
  log('  [openThreeDotMenu] Attempting to open menu...');

  // Highlighting for visual debugging
  const originalBorder = (menuBtn as HTMLElement).style.border;
  (menuBtn as HTMLElement).style.border = '2px solid red';

  // Method 1: Page context React internals
  log('  Method 1: Page context React internals...');
  const pageResult = await clickViaPageContext(menuBtn);
  if (pageResult) {
    await delay(1000);
    if (isMenuOpen()) {
      log('  ✅ Menu opened via page context');
      (menuBtn as HTMLElement).style.border = originalBorder;
      return true;
    }
  }

  // Method 2: Native Click on Button
  log('  Method 2: Native HTMLElement.click()...');
  if (menuBtn instanceof HTMLElement) {
    menuBtn.click();
    await delay(1000);
    if (isMenuOpen()) {
      log('  ✅ Menu opened via native click');
      (menuBtn as HTMLElement).style.border = originalBorder;
      return true;
    }
  }

  // Method 3: Click on SVG (Internal Icon)
  // Sometimes the click listener is on the icon, or the button swallows events differently.
  log('  Method 3: Clicking SVG icon inside button...');
  const svg = menuBtn.querySelector('svg');
  if (svg) {
    if (svg instanceof HTMLElement) {
      svg.click();
    } else {
      const parent = svg.parentElement;
      if (parent) parent.click();
    }
    forceClick(svg);
    await delay(1000);
    if (isMenuOpen()) return true;
  }

  // Method 4: Synthetic Mouse Events Sequence (MouseDown -> MouseUp -> Click)
  log('  Method 4: Synthetic Mouse Events Sequence...');
  const rect = menuBtn.getBoundingClientRect();
  const opts = {
    view: window,
    bubbles: true,
    cancelable: true,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  };

  menuBtn.dispatchEvent(new MouseEvent('mousedown', opts));
  await delay(50);
  menuBtn.dispatchEvent(new MouseEvent('mouseup', opts));
  await delay(50);
  menuBtn.dispatchEvent(new MouseEvent('click', opts));

  await delay(1000);
  if (isMenuOpen()) {
    log('  ✅ Menu opened via synthetic mouse sequence');
    (menuBtn as HTMLElement).style.border = originalBorder;
    return true;
  }

  // Method 5: Keyboard Enter
  log('  Method 5: Keyboard Enter...');
  if (menuBtn instanceof HTMLElement) {
    menuBtn.focus();
    await delay(200);
    menuBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    menuBtn.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    await delay(1000);
    if (isMenuOpen()) return true;
  }

  (menuBtn as HTMLElement).style.border = originalBorder;
  log('  ❌ All menu-open methods exhausted');
  return false;
}

/**
 * Check if a dropdown menu is currently open in the DOM.
 */
/**
 * Check if a dropdown menu is currently open in the DOM.
 * STRICT MODE: Must contain 'Download' or familiar menu text to avoid false positives.
 */
function isMenuOpen(): boolean {
  // 1. Check if "Download" button is visible (Best indicator)
  // Check typical selectors
  if (findElementByText('[role="menuitem"], button, div', 'Download')) return true;

  // 2. Check portals (last 5 body children) for "Download" text
  const portals = Array.from(document.body.children).slice(-5);
  for (const portal of portals) {
    if (portal.tagName === 'DIV' && isVisible(portal)) {
      const text = portal.textContent?.toLowerCase() || '';
      if (text.includes('download')) {
        return true;
      }
    }
  }

  return false;
}



/**
 * Handle clicking Download and selecting WAV format from sub-menu.
 */
/**
 * Handle clicking Download and selecting WAV format from sub-menu.
 */
async function handleDownloadClick(downloadEl: Element, songId: string): Promise<void> {
  log(`Handling Download: <${downloadEl.tagName}> text="${downloadEl.textContent?.trim()}"`);

  // "Download →" is a sub-menu trigger — user says we MUST HOVER to see Wav Audio panel
  log('Hovering Download for sub-menu (User instruction)...');

  // 1. Mouseover events
  simulateHover(downloadEl);

  // 2. Page context hover (if applicable)
  await hoverViaPageContext(downloadEl);

  await delay(800);

  // Strategy 1: User-provided JSPath for Wav Audio Button
  // document.querySelector("body > div:nth-child(50) > div > div:nth-child(2) > button")
  // We'll search for the button in the newly opened portal (likely at the end of body)

  let wavOption: Element | null = null;

  // Try to find the portal that just opened
  // The user said nth-child(50), which is likely near the end.
  // We'll look for a button with text "Wav" or "Audio" in the last few divs of body

  const bodyChildren = Array.from(document.body.children);
  const potentialPortals = bodyChildren.slice(-5); // Check last 5 elements

  for (const portal of potentialPortals) {
    const wavBtn = findElementByTextInContainer(portal, 'button', 'Wav Audio'); // Exact text check from user might be "Wav Audio" or just "Wav"
    if (wavBtn) {
      wavOption = wavBtn;
      log('Found Wav button in recent portal');
      break;
    }

    // Try finding "Audio" if "Wav Audio" fails
    const audioBtn = findElementByTextInContainer(portal, 'button', 'Audio');
    if (audioBtn) {
      wavOption = audioBtn;
      log('Found Audio button in recent portal');
      break;
    }
  }

  // Specific check for the user's selector structure approx
  if (!wavOption) {
    // document.querySelector("body > div:nth-child(50) > div > div:nth-child(2) > button")
    // Let's try to find a button in a structure that looks like a sub-menu
    const portals = document.querySelectorAll('body > div[id^="radix-"], body > div[class*="content"]');
    // This is a guess, but better than nothing.
  }

  // Fallback: Text search global
  if (!wavOption) {
    log('Generic text search for WAV/Audio...');
    wavOption = findElementByText('button, [role="menuitem"], div, a, span', 'Wav Audio') ||
      findElementByText('button, [role="menuitem"], div, a, span', 'Wav');
  }

  if (!wavOption) {
    // Try clicking (might open sub-menu if hover failed)
    log('Hover didn\'t seem to work, clicking Download item...');
    await clickViaPageContext(downloadEl);
    forceClick(downloadEl);
    await delay(1500);

    wavOption = await waitForElementByText(
      'button, [role="menuitem"], div, a, span',
      'Wav Audio',
      3000,
    );

    if (!wavOption) {
      wavOption = await waitForElementByText(
        'button, [role="menuitem"], div, a, span',
        'Wav',
        1000
      );
    }
  }

  if (wavOption) {
    log('Selecting WAV format...');
    await clickViaPageContext(wavOption);
    forceClick(wavOption);

    // Wait longer for dialog to fully render
    await delay(2000);

    // Now wait for the download dialog and capture Blob URL
    log('Waiting for download dialog...');
    try {
      await captureAndDownloadWAV(songId);
    } catch (error) {
      log(`Download error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  } else {
    log('WAV option not found — download may have started directly');
  }
}

/**
 * Helper to find element by text within a container
 * Rejects elements with text longer than 40 chars to avoid matching parent containers.
 */
function findElementByTextInContainer(container: Element, selector: string, text: string): Element | null {
  const elements = container.querySelectorAll(selector);
  const lowerText = text.toLowerCase();

  for (const el of elements) {
    if (!isVisible(el)) continue;

    const content = el.textContent?.trim().toLowerCase() || '';
    // Strict check: must contain text AND be reasonably short (not a menu container)
    if (content.includes(lowerText) && content.length < 40) {
      return el;
    }
  }
  return null;
}

/**
 * Wait for "Download File" button, capture Blob URL, and trigger actual file download.
 * Supports both:
 * 1. Dialog flow: Click Wav -> Wait for Dialog -> Click "Download File" -> Blob
 * 2. Direct flow: Click Wav -> Blob appears directly
 * 3. Fallback: Direct CDN download using ID
 */
async function captureAndDownloadWAV(songId: string): Promise<void> {
  log('Starting WAV capture sequence (Hybrid Mode)...');

  // 1. Start monitoring for Blob URLs immediately (before dialog check)
  // This covers the case where "WAV" click directly triggers generation without a second button
  const blobPromise = monitorForBlobUrl(30000);

  // 2. Concurrently check for the "Download File" button
  // If it appears, we click it to trigger the blob.
  // If it doesn't appear, we just hope the blob appears anyway (Direct flow).
  const dialogHandlerPromise = (async () => {
    try {
      const btn = await waitForDownloadFileButton();
      if (btn) {
        log('Dialog button found! Clicking it...');
        await delay(200);
        if (btn instanceof HTMLElement) btn.click();
        else forceClick(btn);
      } else {
        log('No dialog button appeared (might be direct download).');
      }
    } catch (e) {
      log('Dialog check error (non-fatal): ' + e);
    }
  })();

  try {
    // We primarily wait for the Blob URL. The dialog handler is just a helper trigger.
    const blobUrl = await blobPromise;
    log(`✅ Blob URL captured: ${blobUrl.substring(0, 50)}...`);

    // Cancel/ignore the dialog handler (it finishes naturally)

    // Get filename
    const fileName = getFileNameFromDialog();
    log(`File name: ${fileName}`);

    // Convert and download
    log('Fetching blob data...');
    const response = await fetch(blobUrl);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

    const blob = await response.blob();
    log(`✅ Blob fetched: ${blob.size} bytes, type: ${blob.type}`);

    const objectUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_WAV_FILE',
        url: objectUrl,
        filename: fileName,
      }, (res) => {
        setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (res?.success) {
          log(`✅ Download started! ID: ${res.downloadId}`);
          resolve();
        } else {
          reject(new Error(res?.error || 'unknown error'));
        }
      });
    });

  } catch (error) {
    log(`⚠️ UI-based download failed: ${error instanceof Error ? error.message : String(error)}`);

    // Fallback: Direct CDN Download
    // Fallback: API-based Direct Download
    if (songId) {
      log(`🔄 Attempting API-based Direct Download for ID: ${songId}`);

      try {
        // Step 0: Get Clerk Token (to bypass CORS)
        log('Step 0: Getting Clerk token...');
        const token = await getClerkToken();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) {
          log('✅ Clerk token obtained');
          headers['Authorization'] = `Bearer ${token}`;
        } else {
          log('⚠️ Clerk token not found, trying without (might fail)...');
        }

        // Step 1: Request WAV conversion/generation
        log('Step 1: Requesting convert_wav...');
        const convertUrl = `https://studio-api.prod.suno.com/api/gen/${songId}/convert_wav/`;
        const convertResp = await fetch(convertUrl, {
          method: 'POST',
          credentials: 'omit', // Important: omit cookies if sending Bearer token to avoid CORS * issues
          headers
        });

        if (!convertResp.ok) {
          log(`convert_wav failed: ${convertResp.status}`);
          // Proceeding anyway as it might be already converted
        } else {
          log('convert_wav request sent successfully');
        }

        // Step 2: Get the WAV file URL
        log('Step 2: Getting wav_file URL...');
        const metaUrl = `https://studio-api.prod.suno.com/api/gen/${songId}/wav_file/`;
        let downloadUrl = '';

        // Poll for the URL (it might take a moment if just converted)
        for (let i = 0; i < 5; i++) {
          const metaResp = await fetch(metaUrl, {
            method: 'GET',
            credentials: 'omit',
            headers
          });

          if (metaResp.ok) {
            const data = await metaResp.json();
            if (data.url) {
              downloadUrl = data.url;
              log(`Got download URL: ${downloadUrl}`);
              break;
            } else {
              log('wav_file response valid but no URL yet...');
            }
          } else {
            log(`wav_file check ${i} failed: ${metaResp.status}`);
          }
          await new Promise(r => setTimeout(r, 1000));
        }

        if (!downloadUrl) {
          // Ultimate fallback: Try generic CDN pattern again if API refused to give URL but convert succeeded?
          // But actually, if wav_file fails, direct CDN likely 403s.
          // We'll try one last guess if we have nothing.
          downloadUrl = `https://cdn1.suno.ai/${songId}.wav`;
          log(`Falling back to guessed CDN URL: ${downloadUrl}`);
        }

        // Step 3: Download
        log(`Step 3: Fetching file from: ${downloadUrl}`);
        const response = await fetch(downloadUrl);
        if (!response.ok) throw new Error(`Final fetch failed: ${response.status}`);

        const blob = await response.blob();
        log(`✅ Blob fetched: ${blob.size} bytes`);

        const objectUrl = URL.createObjectURL(blob);
        const fileName = `suno-${songId}.wav`;

        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'DOWNLOAD_WAV_FILE',
            url: objectUrl,
            filename: fileName,
          }, (res) => {
            setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
            if (res?.success) {
              log(`✅ Direct Download started! ID: ${res.downloadId}`);
              resolve();
            } else {
              reject(new Error(res?.error || 'unknown error'));
            }
          });
        });

      } catch (fbError) {
        log(`❌ API fallback also failed: ${fbError instanceof Error ? fbError.message : String(fbError)}`);
        throw error; // Throw original error nicely
      }
    } else {
      log('❌ No Song ID for fallback.');
      throw error;
    }
  }
}

/**
 * Monitor DOM for any new Blob URL (<a> tag) appearing.
 */
function monitorForBlobUrl(timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Quick check
    const existing = document.querySelector('a[href^="blob:"]');
    if (existing) {
      log('Found existing blob URL');
      resolve((existing as HTMLAnchorElement).href);
      return;
    }

    log('Monitoring for new Blob URL...');
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeName === 'A') {
            const anchor = node as HTMLAnchorElement;
            if (anchor.href?.startsWith('blob:')) {
              observer.disconnect();
              resolve(anchor.href);
              return;
            }
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Fallback polling (sometimes mutation observer misses if added deep)
    const interval = setInterval(() => {
      const found = document.querySelector('a[href^="blob:"]');
      if (found) {
        clearInterval(interval);
        observer.disconnect();
        resolve((found as HTMLAnchorElement).href);
      }
    }, 500);

    setTimeout(() => {
      observer.disconnect();
      clearInterval(interval);
      reject(new Error('Timeout waiting for Blob URL'));
    }, timeoutMs);
  });
}

/**
 * Wait for "Download File" button to become enabled.
 */
async function waitForDownloadFileButton(): Promise<Element | null> {
  const maxWait = 30000; // 30 seconds
  const startTime = Date.now();
  let lastStatus = '';

  log('Waiting for Download File button...');

  while (Date.now() - startTime < maxWait) {
    const buttons = Array.from(document.querySelectorAll('button'));
    const downloadBtn = buttons.find(b =>
      b.textContent?.includes('Download File') || b.textContent?.includes('Download') // Loose check
    );

    if (downloadBtn) {
      const isDisabled = (downloadBtn as HTMLButtonElement).disabled;
      const status = isDisabled ? 'found (disabled)' : 'found (enabled)';

      if (status !== lastStatus) {
        log(`Download File button: ${status} text="${downloadBtn.textContent}"`);
        lastStatus = status;
      }

      if (!isDisabled) {
        log('✅ Download File button is ready!');
        return downloadBtn;
      }
    } else {
      if (lastStatus !== 'not found') {
        log('Download File button: not found');
        lastStatus = 'not found';
      }
    }

    await delay(500);
  }

  log('❌ Timeout waiting for Download File button');

  // Debug: log all visible elements with "download" in them
  log('--- DIAGNOSTICS: All visible "Download" elements ---');
  const allEls = document.querySelectorAll('*');
  allEls.forEach(el => {
    if (el.children.length === 0 && el.textContent?.toLowerCase().includes('download') && isVisible(el)) {
      log(`  <${el.tagName}> text="${el.textContent?.trim().substring(0, 50)}" class="${el.className}"`);
    }
  });

  // Debug: Check for Dialogs
  const dialogs = document.querySelectorAll('[role="dialog"], dialog, .chakra-modal__content');
  log(`--- DIAGNOSTICS: Found ${dialogs.length} dialogs ---`);
  dialogs.forEach((d, i) => {
    log(`  Dialog ${i}: visible=${isVisible(d)} text="${d.textContent?.substring(0, 100)}..."`);
  });

  return null;
}

/**
 * Get the file name from the download dialog.
 */
function getFileNameFromDialog(): string {
  log('Extracting file name from dialog...');

  // Strategy 1: Look for .wav filename in dialog
  const dialog = document.querySelector('dialog[open]');
  if (dialog) {
    // Check all text nodes for .wav filename
    const allText = dialog.textContent || '';
    const wavMatch = allText.match(/[\w\s-]+\.wav/i);
    if (wavMatch) {
      log(`Found filename in dialog: ${wavMatch[0]}`);
      return wavMatch[0].trim();
    }

    // Check generic elements
    const generics = dialog.querySelectorAll('generic, div, span');
    for (const gen of generics) {
      const text = gen.textContent?.trim() || '';
      if (text.endsWith('.wav') && text.length < 100) {
        log(`Found filename in element: ${text}`);
        return text;
      }
    }
  }

  // Strategy 2: Check for blob link's download attribute
  const blobLink = document.querySelector('a[href^="blob:"]');
  if (blobLink) {
    const downloadAttr = blobLink.getAttribute('download');
    if (downloadAttr && downloadAttr.endsWith('.wav')) {
      log(`Found filename in blob link: ${downloadAttr}`);
      return downloadAttr;
    }
  }

  // Fallback: use timestamp-based name
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const fallbackName = `suno-song-${timestamp}.wav`;
  log(`Using fallback filename: ${fallbackName}`);
  return fallbackName;
}


// ─────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────

async function closeOpenDialogs(): Promise<void> {
  const closeBtns = document.querySelectorAll('button[aria-label="Close"]');
  for (const btn of closeBtns) {
    if (isVisible(btn)) {
      forceClick(btn);
      await delay(500);
    }
  }
}

function simulateHover(el: Element): void {
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  const eventOptions = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
  };

  const events = ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'];
  events.forEach(type => {
    const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
    el.dispatchEvent(new Ctor(type, eventOptions));
  });
}

function findDownloadButton(): Element | null {
  const selectors = ['button', '[role="menuitem"]', 'a', 'div'];
  for (const sel of selectors) {
    const el = findElementByText(sel, 'Download');
    if (el && isVisible(el)) return el;
  }
  return null;
}

async function logDiagnostics(): Promise<void> {
  const allBtns = Array.from(document.querySelectorAll('button'));
  const visible = allBtns.filter(isVisible);
  log(`Diagnostics: ${allBtns.length} total buttons, ${visible.length} visible`);

  for (const btn of visible) {
    const text = btn.textContent?.trim().toLowerCase() ?? '';
    const aria = btn.getAttribute('aria-label')?.toLowerCase() ?? '';
    const haspopup = btn.getAttribute('aria-haspopup') ?? '';
    if (text.includes('download') || text.includes('more') || text.includes('menu') ||
      aria.includes('download') || aria.includes('more') || aria.includes('menu') ||
      haspopup) {
      log(`  <button> text="${btn.textContent?.trim()}" aria="${btn.getAttribute('aria-label')}" haspopup="${haspopup}"`);
    }
  }

  const hidden = allBtns.filter(b => !isVisible(b));
  log(`  ${hidden.length} hidden buttons`);

  const menus = document.querySelectorAll('[role="menu"], [role="listbox"], [role="menuitem"]');
  log(`  Menu elements in DOM: ${menus.length}`);

  // Run page context diagnostics (shows React internals)
  await pageContextDiagnostics();
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}

function checkAbort(): void {
  if (aborted) throw new Error('Job aborted');
}

/**
 * Finds an element by XPath.
 */
function getElementByXPath(path: string): Element | null {
  try {
    const result = document.evaluate(
      path,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    return result.singleNodeValue as Element;
  } catch (e) {
    console.error('[SBG] XPath error', e);
    return null;
  }
}
