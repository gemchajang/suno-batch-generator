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

      case 'PROXY_API_REQUEST':
        handleProxyApiRequest(message, sendResponse);
        return true; // async response

      case 'HEARTBEAT':
        sendResponse({ ack: true });
        break;

      case 'GENERATE_VIA_API':
        // Forward to active suno tab
        handleDumpDom(sendResponse, 'GENERATE_VIA_API', message.payload);
        return true;

      // Content script messages (JOB_PROGRESS, PAGE_STATUS, DOWNLOAD_READY)
      // are handled by the listener in queue-coordinator.ts
      default:
        break;
    }

    return false;
  },
);

async function handleProxyApiRequest(
  message: any,
  sendResponse: (response: any) => void
) {
  try {
    const { url, method, headers, body } = message;

    // Perform the fetch in background (CORS bypassed via host permissions)
    const options: RequestInit = {
      method,
      headers: headers || {},
      body: body ? JSON.stringify(body) : undefined
    };

    const response = await fetch(url, options);

    // We need to return the body, but response.json() might fail if it's empty
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text; // Fallback to text
    }

    sendResponse({
      ok: response.ok,
      status: response.status,
      data
    });

  } catch (e: any) {
    console.error('[SBG] Proxy Request Error:', e);
    sendResponse({
      ok: false,
      status: 0,
      error: e.message
    });
  }
}

function handleDumpDom(
  sendResponse: (response: any) => void,
  messageType: string = 'DUMP_DOM',
  payload?: any
) {
  chrome.tabs.query({}, (tabs) => {
    const tab = tabs.find(
      (t) => t.url && /https:\/\/(www\.)?suno\.com/.test(t.url),
    );
    if (!tab?.id) {
      sendResponse({ error: 'No suno.com tab found' });
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: messageType, payload }, (response) => {
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

      case 'REACT_GET_TOKENS':
        results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: async () => {
            const debug: string[] = [];

            // Strategy 1: Window Clerk Object (Official way)
            try {
              const clerk = (window as any).Clerk;
              if (clerk && clerk.session) {
                const token = await clerk.session.getToken();
                if (token) return { token, source: 'clerk_global' };
              } else {
                debug.push('window.Clerk or session missing');
              }
            } catch (e: any) {
              debug.push(`Clerk error: ${e.message}`);
            }

            // Strategy 2: LocalStorage scan
            let foundKey = '';
            for (let i = 0; i < localStorage.length; i++) {
              const key = localStorage.key(i);
              if (key && key.includes('clerk-db-jwt')) {
                // Found a potential key, check if it looks like a JWT
                const val = localStorage.getItem(key);
                if (val && val.startsWith('eyJ')) {
                  return { token: val, source: 'localstorage', key };
                }
              }
            }
            debug.push('LocalStorage scan found no jwt');

            // Strategy 3: Check cookies (rudimentary check from page context)
            // Note: HttpOnly cookies aren't visible here, but sometimes they duplicate it.

            return { error: 'Token not found', debug };
          }
        });
        break;

      case 'INJECT_INTERCEPTOR':
        results = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: injectInterceptorInPage,
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
  message: { type: string; url: string; filename: string; folder?: string; duration?: string },
  sendResponse: (response: any) => void,
) {
  const settings = getSettings();
  // Use message.folder if provided (per-job override), otherwise use global setting
  const rawSubdir = message.folder || settings.downloadPath || 'SunoMusic';
  const subdir = rawSubdir.replace(/[<>:"/\\|?*]/g, '_');
  const finalFilename = `${subdir}/${message.filename}`;

  if (message.duration) {
    console.log(`[SBG] Saving song with duration: ${message.duration}`);
    // We could persist this metadata if needed, for now just logging
  }

  chrome.downloads.download({
    url: message.url,
    filename: finalFilename, // Chrome handles subdirectory creation
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

// ─────────────────────────────────────────────
// INTERCEPTOR INJECTION
// ─────────────────────────────────────────────

function injectInterceptorInPage() {
  if ((window as any).__SBG_INTERCEPTOR_INJECTED) return { status: 'already_injected' };

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const [resource, config] = args;
    const url = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : '');

    // Check if this is the target API
    if (url.includes('/api/generate/') || url.includes('/api/gen/')) {
      try {
        // Clone the response so we can read it without consuming the original stream
        const responseCallback = async (response: Response) => {
          try {
            const clone = response.clone();
            const data = await clone.json();

            // Send to content script via custom event
            window.dispatchEvent(new CustomEvent('SBG_API_INTERCEPT', {
              detail: {
                url,
                // method: config?.method || 'GET', 
                requestBody: config?.body,
                responseBody: data,
                timestamp: Date.now()
              }
            }));
          } catch (e) {
            console.error('[SBG-Interceptor] Failed to parse response:', e);
          }
        };

        // Execute original fetch and hook into the promise
        const promise = originalFetch.apply(this, args);
        promise.then(responseCallback).catch(() => { });
        return promise;

      } catch (e) {
        console.error('[SBG-Interceptor] Error:', e);
      }
    }

    return originalFetch.apply(this, args);
  };

  (window as any).__SBG_INTERCEPTOR_INJECTED = true;
  console.log('[SBG] Network Interceptor Injected (MAIN world)');
  return { status: 'injected' };
}

// ─────────────────────────────────────────────
// HEADER INTERCEPTION
// ─────────────────────────────────────────────

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const { requestHeaders } = details;
    if (!requestHeaders) return;

    let browserToken: string | undefined;
    let deviceId: string | undefined;

    for (const h of requestHeaders) {
      const name = h.name.toLowerCase();
      if (name === 'browser-token') {
        browserToken = h.value;
      } else if (name === 'device-id') {
        deviceId = h.value;
      }
    }

    if (browserToken && deviceId) {
      // Store them
      chrome.storage.local.set({
        'suno_browser_token': browserToken,
        'suno_device_id': deviceId,
        'suno_token_timestamp': Date.now()
      });
      // console.log('[SBG] Captured Suno tokens via webRequest');
    }
  },
  { urls: ['https://studio-api.prod.suno.com/*'] },
  ['requestHeaders']
);
