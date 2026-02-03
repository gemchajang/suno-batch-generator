import { emitLog } from './queue-coordinator';

/**
 * Monitor chrome.downloads for completion/failure and log results.
 */
export function initDownloadManager(): void {
  chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state) {
      if (delta.state.current === 'complete') {
        chrome.downloads.search({ id: delta.id }, (items) => {
          const item = items[0];
          if (item) {
            emitLog('info', `Downloaded: ${item.filename.split(/[/\\]/).pop()}`);
          }
        });
      } else if (delta.state.current === 'interrupted') {
        emitLog('error', `Download failed (id: ${delta.id})`);
      }
    }
  });
}
