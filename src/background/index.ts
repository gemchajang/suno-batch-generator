import type { PanelToBgMessage, ContentToBgMessage } from '../types/messages';
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

      // Content script messages (JOB_PROGRESS, PAGE_STATUS, DOWNLOAD_READY)
      // are handled by the listener in queue-coordinator.ts
      default:
        break;
    }

    return false;
  },
);

function handleDumpDom(sendResponse: (response: any) => void) {
  chrome.tabs.query({}, (tabs) => {
    const tab = tabs.find(
      (t) => t.url && /https:\/\/(www\.)?suno\.com/.test(t.url),
    );
    if (!tab?.id) {
      sendResponse({ error: 'No suno.com tab found' });
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'DUMP_DOM' }, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse(response);
    });
  });
}
