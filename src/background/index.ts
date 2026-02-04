import type { PanelToBgMessage, ContentToBgMessage, ExecInPageMessage } from '../types/messages';
import {
  addJobs,
  clearQueue,
  getSettings,
  getState,
  restoreState,
  startQueue,
  stopQueue,
  updateSettings,
} from './queue-coordinator';
import { initDownloadManager } from './download-manager';

console.log('[Suno Batch Generator] Background service worker started');

// Restore persisted state on startup
restoreState();

// Initialize download monitoring
initDownloadManager();

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// Allow side panel on suno.com
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Handle messages from side panel and content scripts
chrome.runtime.onMessage.addListener(
  (message: PanelToBgMessage | ContentToBgMessage | { type: 'DUMP_DOM' }, sender, sendResponse) => {
    switch (message.type) {
      case 'START_QUEUE':
        startQueue();
        sendResponse({ ok: true });
        break;

      case 'STOP_QUEUE':
        stopQueue();
        sendResponse({ ok: true });
        break;

      case 'ADD_JOBS':
        addJobs(message.payload);
        sendResponse({ ok: true });
        break;

      case 'CLEAR_QUEUE':
        clearQueue();
        sendResponse({ ok: true });
        break;

      case 'GET_STATE':
        sendResponse({ payload: getState(), settings: getSettings() });
        break;

      case 'UPDATE_SETTINGS':
        updateSettings(message.payload);
        sendResponse({ ok: true });
        break;

      case 'DUMP_DOM':
        // Forward to content script and relay result back
        handleDumpDom(sendResponse);
        return true; // async response

      case 'EXEC_IN_PAGE':
        handleExecInPage(message as ExecInPageMessage, sender, sendResponse);
        return true; // async response

      case 'TEST_DOWNLOAD':
        handleDumpDom(sendResponse, 'TEST_DOWNLOAD');
        return true;

      case 'DOWNLOAD_WAV_FILE':
        handleDownloadWavFile(message, sendResponse);
        return true; // async response

      // Content script messages (JOB_PROGRESS, PAGE_STATUS, DOWNLOAD_READY)
      // are handled by the listener in queue-coordinator.ts
      default:
        break;
    }

    return false;
  },
);

function handleDumpDom(sendResponse: (response: any) => void, messageType: string = 'DUMP_DOM') {
  chrome.tabs.query({}, (tabs) => {
    const tab = tabs.find(
      (t) => t.url && /https:\/\/(www\.)?suno\.com/.test(t.url),
    );
    if (!tab?.id) {
      sendResponse({ error: 'No suno.com tab found' });
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: messageType }, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse(response);
    });
  });
}

// ─────────────────────────────────────────────
// EXEC_IN_PAGE: Run code in page's MAIN world
// via chrome.scripting.executeScript.
// This bypasses page CSP and content script isolation,
// allowing direct access to React internals.
// ─────────────────────────────────────────────

async function handleExecInPage(
  message: ExecInPageMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: any) => void,
) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ __error: 'no tab id from sender' });
    return;
  }

  try {
    let results: chrome.scripting.InjectionResult[];

    switch (message.action) {
      case 'REACT_CLICK':
        results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: reactClickInPage,
          args: [message.selector || '[data-sbg-click]'],
        });
        break;

      case 'REACT_HOVER':
        results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: reactHoverInPage,
          args: [message.selector || '[data-sbg-hover]'],
        });
        break;

      case 'REACT_DIAGNOSTICS':
        results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: reactDiagnosticsInPage,
        });
        break;

      default:
        sendResponse({ __error: 'unknown action: ' + message.action });
        return;
    }

    sendResponse(results?.[0]?.result ?? { __error: 'no result from executeScript' });
  } catch (e) {
    sendResponse({ __error: (e as Error).message });
  }
}

// ─── Functions executed in the page's MAIN world ───
// These are serialized by chrome.scripting.executeScript and run
// in the page's JS context where React internals are accessible.
// They must be standalone (no imports, no closures).

function reactClickInPage(selector: string) {
  const el = document.querySelector(selector);
  if (!el) return { ok: false, err: 'element not found: ' + selector };

  // Try __reactProps$ first (direct props on the DOM element)
  const pk = Object.keys(el).find(k => k.startsWith('__reactProps$'));
  if (pk) {
    const props = (el as any)[pk];
    const rect = el.getBoundingClientRect();
    const init: PointerEventInit & MouseEventInit = {
      bubbles: true, cancelable: true, button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      pointerId: 1, pointerType: 'mouse',
    };
    const hit: string[] = [];
    if (typeof props.onPointerDown === 'function') {
      props.onPointerDown(new PointerEvent('pointerdown', init));
      hit.push('onPointerDown');
    }
    if (typeof props.onPointerUp === 'function') {
      props.onPointerUp(new PointerEvent('pointerup', init));
    }
    if (typeof props.onClick === 'function') {
      props.onClick(new MouseEvent('click', init));
      hit.push('onClick');
    }
    if (hit.length > 0) return { ok: true, via: 'props', hit };
  }

  // Try __reactFiber$ tree walk (handler might be on a parent component)
  const fk = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
  if (!fk) return { ok: false, err: 'no react internals (__reactProps$ / __reactFiber$)' };

  let fiber = (el as any)[fk];
  for (let i = 0; i < 15 && fiber; i++, fiber = fiber.return) {
    const mp = fiber.memoizedProps;
    if (!mp) continue;
    if (typeof mp.onPointerDown === 'function' || typeof mp.onClick === 'function') {
      const rect = el.getBoundingClientRect();
      const init = {
        bubbles: true, cancelable: true, button: 0,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      };
      const hit: string[] = [];
      if (typeof mp.onPointerDown === 'function') {
        mp.onPointerDown(new PointerEvent('pointerdown', init));
        hit.push('onPointerDown');
      }
      if (typeof mp.onPointerUp === 'function') {
        mp.onPointerUp(new PointerEvent('pointerup', init));
      }
      if (typeof mp.onClick === 'function') {
        mp.onClick(new MouseEvent('click', init));
        hit.push('onClick');
      }
      return { ok: true, via: 'fiber-' + i, hit };
    }
  }

  return { ok: false, err: 'no click/pointerDown handlers in fiber tree' };
}

function reactHoverInPage(selector: string) {
  const el = document.querySelector(selector);
  if (!el) return { ok: false, err: 'element not found' };

  const pk = Object.keys(el).find(k => k.startsWith('__reactProps$'));
  if (!pk) return { ok: false, err: 'no react props' };

  const props = (el as any)[pk];
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const hit: string[] = [];

  if (typeof props.onPointerEnter === 'function') {
    props.onPointerEnter(new PointerEvent('pointerenter', {
      bubbles: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse',
    }));
    hit.push('onPointerEnter');
  }
  if (typeof props.onPointerMove === 'function') {
    props.onPointerMove(new PointerEvent('pointermove', {
      bubbles: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse',
    }));
    hit.push('onPointerMove');
  }
  if (typeof props.onMouseEnter === 'function') {
    props.onMouseEnter(new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy }));
    hit.push('onMouseEnter');
  }

  return { ok: hit.length > 0, hit };
}

function reactDiagnosticsInPage() {
  const btns = document.querySelectorAll('button');
  const info: Array<{ text: string; aria: string; hp: string; h: string[] }> = [];
  let reactCount = 0;

  for (let i = 0; i < btns.length; i++) {
    const btn = btns[i];
    const pk = Object.keys(btn).find(k => k.startsWith('__reactProps$'));
    if (pk) reactCount++;
    if (!pk) continue;

    const props = (btn as any)[pk];
    const aria = btn.getAttribute('aria-label') || '';
    const text = (btn.textContent || '').trim().slice(0, 30);
    const hp = btn.getAttribute('aria-haspopup') || '';
    const h: string[] = [];
    if (props.onClick) h.push('onClick');
    if (props.onPointerDown) h.push('onPointerDown');
    if (props.onKeyDown) h.push('onKeyDown');

    const al = aria.toLowerCase();
    const tl = text.toLowerCase();
    if (al.includes('more') || al.includes('menu') || tl.includes('more') ||
      tl.includes('download') || hp) {
      info.push({ text, aria, hp, h });
    }
  }

  return { total: btns.length, react: reactCount, candidates: info };
}

// ─────────────────────────────────────────────
// DOWNLOAD_WAV_FILE: Handle actual file download
// ─────────────────────────────────────────────

function handleDownloadWavFile(
  message: { type: string; url: string; filename: string },
  sendResponse: (response: any) => void,
) {
  chrome.downloads.download({
    url: message.url,
    filename: message.filename,
    saveAs: false, // Auto-save to default downloads folder
  }, (downloadId) => {
    if (chrome.runtime.lastError) {
      console.error('[SBG] Download failed:', chrome.runtime.lastError);
      sendResponse({ 
        success: false, 
        error: chrome.runtime.lastError.message 
      });
    } else {
      console.log('[SBG] Download started:', downloadId);
      
      // Monitor download completion
      const completeListener = (delta: chrome.downloads.DownloadDelta) => {
        if (delta.id === downloadId && delta.state?.current === 'complete') {
          console.log('[SBG] Download completed!');
          chrome.downloads.onChanged.removeListener(completeListener);
          
          // Get file path
          chrome.downloads.search({ id: downloadId }, (results) => {
            if (results[0]) {
              console.log('[SBG] File saved to:', results[0].filename);
            }
          });
        } else if (delta.id === downloadId && delta.state?.current === 'interrupted') {
          console.error('[SBG] Download interrupted');
          chrome.downloads.onChanged.removeListener(completeListener);
        }
      };
      
      chrome.downloads.onChanged.addListener(completeListener);
      
      sendResponse({ success: true, downloadId });
    }
  });
}
