import type { BgToContentMessage, JobProgressMessage } from '../types/messages';
import { executeJob, abortCurrentJob, triggerWavDownload, triggerDownloadOnSongPage } from './suno-automation';

console.log('[Suno Batch Generator] Content script loaded on', window.location.href);

// Check if we're on a song page and should auto-download
if (window.location.pathname.includes('/song/') && sessionStorage.getItem('sbg_auto_download') === 'true') {
  console.log('[SBG] Auto-download triggered on song page');
  sessionStorage.removeItem('sbg_auto_download');
  
  // Wait a bit for page to fully load
  setTimeout(() => {
    triggerDownloadOnSongPage()
      .then(() => console.log('[SBG] Auto-download completed'))
      .catch((e: Error) => console.error('[SBG] Auto-download failed', e));
  }, 2000);
}

// Listen for messages from background service worker
chrome.runtime.onMessage.addListener(
  (message: any, _sender, sendResponse) => {
    switch (message.type) {
      case 'EXECUTE_JOB':
        handleExecuteJob(message as Extract<BgToContentMessage, { type: 'EXECUTE_JOB' }>);
        sendResponse({ ack: true });
        break;

      case 'ABORT_JOB':
        abortCurrentJob();
        sendResponse({ ack: true });
        break;

      case 'CHECK_PAGE': {
        const isCreatePage = window.location.href.includes('suno.com/create');
        sendResponse({
          type: 'PAGE_STATUS',
          payload: { isCreatePage, isLoggedIn: true },
        });
        break;
      }

      case 'DUMP_DOM': {
        const dump = dumpPageElements();
        sendResponse({ type: 'DUMP_RESULT', payload: dump });
        break;
      }

      case 'TEST_DOWNLOAD':
        console.log('[SBG] TEST DOWNLOAD requested');
        triggerWavDownload()
          .then(() => console.log('[SBG] Test download triggered'))
          .catch((e: Error) => console.error('[SBG] Test download failed', e));
        sendResponse({ ack: true });
        break;

      default:
        sendResponse({ ack: true });
    }
    return false;
  },
);

async function handleExecuteJob(message: Extract<BgToContentMessage, { type: 'EXECUTE_JOB' }>) {
  const { job, settings } = message.payload;

  try {
    await executeJob(job, settings, (status, error) => {
      const progress: JobProgressMessage = {
        type: 'JOB_PROGRESS',
        payload: {
          jobId: job.id,
          status: status as JobProgressMessage['payload']['status'],
          error,
        },
      };
      chrome.runtime.sendMessage(progress);
    });
  } catch (err) {
    const progress: JobProgressMessage = {
      type: 'JOB_PROGRESS',
      payload: {
        jobId: job.id,
        status: 'failed',
        error: (err as Error).message,
      },
    };
    chrome.runtime.sendMessage(progress);
  }
}

/**
 * Dump all interactive elements on the page for diagnostic purposes.
 */
function dumpPageElements(): string[] {
  const lines: string[] = [];
  lines.push(`URL: ${window.location.href}`);
  lines.push('');

  // Inputs
  const inputs = document.querySelectorAll('input');
  lines.push(`=== INPUT elements (${inputs.length}) ===`);
  inputs.forEach((el, i) => {
    lines.push(
      `  [${i}] type="${el.type}" placeholder="${el.placeholder}" ` +
      `aria-label="${el.getAttribute('aria-label') ?? ''}" ` +
      `class="${shortenClass(el.className)}" ` +
      `id="${el.id}" name="${el.name}" ` +
      `visible=${isVisible(el)}`,
    );
  });

  // Textareas
  const textareas = document.querySelectorAll('textarea');
  lines.push('');
  lines.push(`=== TEXTAREA elements (${textareas.length}) ===`);
  textareas.forEach((el, i) => {
    const parent = el.parentElement;
    const grandparent = parent?.parentElement;
    lines.push(
      `  [${i}] placeholder="${el.placeholder}" ` +
      `aria-label="${el.getAttribute('aria-label') ?? ''}" ` +
      `class="${shortenClass(el.className)}" ` +
      `rows="${el.rows}" ` +
      `visible=${isVisible(el)} ` +
      `parent=<${parent?.tagName.toLowerCase()} class="${shortenClass(parent?.className ?? '')}"> ` +
      `grandparent=<${grandparent?.tagName.toLowerCase()} class="${shortenClass(grandparent?.className ?? '')}">`,
    );
  });

  // Contenteditable
  const editables = document.querySelectorAll('[contenteditable="true"]');
  lines.push('');
  lines.push(`=== CONTENTEDITABLE elements (${editables.length}) ===`);
  editables.forEach((el, i) => {
    lines.push(
      `  [${i}] tag=<${el.tagName.toLowerCase()}> ` +
      `class="${shortenClass((el as HTMLElement).className)}" ` +
      `role="${el.getAttribute('role') ?? ''}" ` +
      `data-placeholder="${el.getAttribute('data-placeholder') ?? ''}" ` +
      `text="${el.textContent?.substring(0, 50)}"`,
    );
  });

  // Buttons (visible only)
  const buttons = document.querySelectorAll('button');
  const visibleButtons = Array.from(buttons).filter(isVisible);
  lines.push('');
  lines.push(`=== BUTTON elements (${visibleButtons.length} visible / ${buttons.length} total) ===`);
  visibleButtons.forEach((el, i) => {
    lines.push(
      `  [${i}] text="${el.textContent?.trim().substring(0, 60)}" ` +
      `aria-label="${el.getAttribute('aria-label') ?? ''}" ` +
      `aria-haspopup="${el.getAttribute('aria-haspopup') ?? ''}" ` +
      `role="${el.getAttribute('role') ?? ''}" ` +
      `class="${shortenClass(el.className)}" ` +
      `disabled=${el.disabled}`,
    );
  });

  // Switches / toggles
  const switches = document.querySelectorAll('[role="switch"], .chakra-switch, [class*="switch"], [class*="toggle"]');
  lines.push('');
  lines.push(`=== SWITCH/TOGGLE elements (${switches.length}) ===`);
  switches.forEach((el, i) => {
    lines.push(
      `  [${i}] tag=<${el.tagName.toLowerCase()}> ` +
      `text="${el.textContent?.trim().substring(0, 40)}" ` +
      `aria-checked="${el.getAttribute('aria-checked') ?? ''}" ` +
      `data-state="${el.getAttribute('data-state') ?? ''}" ` +
      `class="${shortenClass((el as HTMLElement).className)}"`,
    );
  });

  // Menu items (if any menu is open)
  const menuItems = document.querySelectorAll('[role="menuitem"], [role="option"], .chakra-menu__menuitem');
  if (menuItems.length > 0) {
    lines.push('');
    lines.push(`=== MENU ITEMS (${menuItems.length}) ===`);
    menuItems.forEach((el, i) => {
      lines.push(
        `  [${i}] tag=<${el.tagName.toLowerCase()}> ` +
        `text="${el.textContent?.trim().substring(0, 60)}" ` +
        `role="${el.getAttribute('role') ?? ''}" ` +
        `class="${shortenClass((el as HTMLElement).className)}"`,
      );
    });
  }

  return lines;
}

function shortenClass(cls: string): string {
  if (!cls) return '';
  // Show first 80 chars of class list
  return cls.length > 80 ? cls.substring(0, 80) + '...' : cls;
}

function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
}
