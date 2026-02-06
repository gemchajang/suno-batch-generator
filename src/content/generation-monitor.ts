import { GENERATION_POLL_INTERVAL } from '../config/constants';
import { resolveSelector } from './selectors-runtime';

export interface MonitorResult {
  completed: boolean;
  timedOut: boolean;
  songUrls: string[]; // URLs of the newly created songs
}

/** Count clips using multiple button selectors for robustness */
function countClips(): number {
  const publish = document.querySelectorAll('button[aria-label="Publish clip"]').length;
  const like = document.querySelectorAll('button[aria-label="Like clip"]').length;
  const dislike = document.querySelectorAll('button[aria-label="Dislike clip"]').length;
  const share = document.querySelectorAll('button[aria-label="Share clip"]').length;
  // Use the max — whichever selector is most reliable
  return Math.max(publish, like, dislike, share);
}

/** Get all current song IDs from the feed */
function getSongIds(): Set<string> {
  const ids = new Set<string>();
  const songLinks = Array.from(document.querySelectorAll('a[href*="/song/"]'));

  songLinks.forEach(link => {
    const href = (link as HTMLAnchorElement).href;
    const match = href.match(/\/song\/([\w-]+)/);
    if (match) {
      ids.add(match[1]);
    }
  });

  return ids;
}

/** Check for active loading/generating indicators */
function hasLoadingIndicators(container: Element): boolean {
  const spinners = container.querySelectorAll(
    '.chakra-spinner, svg.animate-spin, [class*="spinner"], [class*="loading"]',
  );
  const progressBars = container.querySelectorAll('[role="progressbar"]');
  // Also check for any element with "Generating" text in clip area
  const generatingEls = container.querySelectorAll('[class*="generat" i]');
  return spinners.length > 0 || progressBars.length > 0 || generatingEls.length > 0;
}

/**
 * Monitor for song generation completion using MutationObserver + polling.
 *
 * Strategies:
 *  1. Clip count increase
 *  2. Loading indicators appear then disappear
 *  3. New audio elements appear
 */
export function monitorGeneration(timeoutMs: number): Promise<MonitorResult> {
  return new Promise((resolve) => {
    let settled = false;
    let sawLoading = false;
    let loadingDisappearedAt = 0;
    let checkCount = 0;

    const clipCountBefore = countClips();
    const audioCountBefore = document.querySelectorAll('audio').length;

    // Capture existing song IDs to diff against later
    const existingSongIds = getSongIds();
    console.log(`[SBG] Generation monitor started: ${clipCountBefore} clips, ${existingSongIds.size} existing songs`);

    const finish = (result: MonitorResult) => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      resolve(result);
    };

    const getNewSongUrls = (): string[] => {
      const currentIds = getSongIds();
      const newUrls: string[] = [];

      currentIds.forEach(id => {
        if (!existingSongIds.has(id)) {
          newUrls.push(`/song/${id}`);
        }
      });

      console.log(`[SBG] Found ${newUrls.length} new songs: ${newUrls.join(', ')}`);
      return newUrls;
    };

    const checkCompletion = () => {
      checkCount++;
      const feed = resolveSelector('songFeed') ?? document.body;
      const clipCountNow = countClips();
      const audioCountNow = document.querySelectorAll('audio').length;
      const loading = hasLoadingIndicators(feed);

      // Log periodically
      if (checkCount % 10 === 0) {
        console.log(
          `[SBG] Monitor check #${checkCount}: clips=${clipCountNow} (was ${clipCountBefore}), ` +
          `loading=${loading}, sawLoading=${sawLoading}`,
        );
      }

      // Track loading state transitions
      if (loading && !sawLoading) {
        sawLoading = true;
        console.log('[SBG] Generation in progress (loading indicators detected)');
      }
      if (sawLoading && !loading && loadingDisappearedAt === 0) {
        loadingDisappearedAt = Date.now();
        console.log('[SBG] Loading indicators disappeared');
      }

      // Strategy 1: Clip count increased
      if (clipCountNow > clipCountBefore) {
        console.log(`[SBG] Generation complete (clip count): ${clipCountNow} clips (was ${clipCountBefore})`);
        setTimeout(() => {
          if (!settled) {
            const songUrls = getNewSongUrls();
            finish({ completed: true, timedOut: false, songUrls });
          }
        }, 2000); // Wait a bit for DOM to settle
        return;
      }

      // Strategy 2: New audio elements appeared (less reliable but good backup)
      if (audioCountNow > audioCountBefore) {
        console.log(`[SBG] Generation complete (audio count): ${audioCountNow} audio`);
        setTimeout(() => {
          if (!settled) {
            const songUrls = getNewSongUrls();
            finish({ completed: true, timedOut: false, songUrls });
          }
        }, 2000);
        return;
      }

      // Strategy 3: Loading indicators appeared then disappeared (wait 3s for stabilization)
      if (sawLoading && !loading && loadingDisappearedAt > 0) {
        const elapsed = Date.now() - loadingDisappearedAt;
        if (elapsed >= 3000) {
          console.log('[SBG] Generation complete (loading indicators cleared)');
          let songUrls = getNewSongUrls();

          // If we found 1 song but expect 2, wait a bit longer to see if the second one pops up
          // OR if we found 0 songs (maybe network lag), definitely wait
          if (songUrls.length < 2) {
            const found = songUrls.length;
            console.log(`[SBG] Found ${found} song(s), waiting up to 15s for more...`);
            let retries = 0;
            const waitForSongs = setInterval(() => {
              retries++;
              const currentUrls = getNewSongUrls();

              // Stop waiting if we found 2 (ideal)
              // Or if we had 0 and now have at least 1 (good enough to proceed, though 2 is better)
              // We'll aim for 2, but if we time out, we take what we have.
              if (currentUrls.length >= 2 || retries >= 15) { // 15 * 1000ms = 15s
                clearInterval(waitForSongs);
                console.log(`[SBG] Finished waiting. Found: ${currentUrls.length}`);
                finish({ completed: true, timedOut: false, songUrls: currentUrls });
              }
            }, 1000);
            return;
          }

          finish({ completed: true, timedOut: false, songUrls });
          return;
        }
      }
    };

    // MutationObserver for DOM changes
    const observer = new MutationObserver(() => {
      checkCompletion();
    });

    const feed = resolveSelector('songFeed') ?? document.body;
    observer.observe(feed, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'data-state', 'aria-label', 'role', 'src'],
    });

    // Polling fallback
    const pollTimer = setInterval(() => {
      checkCompletion();
      // Send heartbeat to keep Service Worker alive
      chrome.runtime.sendMessage({ type: 'HEARTBEAT' }).catch(() => { });
    }, GENERATION_POLL_INTERVAL);

    // Timeout — log state before timing out
    const timeoutTimer = setTimeout(() => {
      console.log(`[SBG] Generation TIMED OUT after ${timeoutMs / 1000}s.`);
      finish({ completed: false, timedOut: true, songUrls: [] });
    }, timeoutMs);
  });
}
