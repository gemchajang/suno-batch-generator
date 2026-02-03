import { GENERATION_POLL_INTERVAL } from '../config/constants';
import { resolveSelector } from './selectors-runtime';

export interface MonitorResult {
  completed: boolean;
  timedOut: boolean;
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
 * Detection strategies:
 *  1. Clip count increase (Publish/Like/Dislike/Share buttons)
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
    console.log(`[SBG] Generation monitor started: ${clipCountBefore} clips, ${audioCountBefore} audio elements`);

    const finish = (result: MonitorResult) => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      clearInterval(pollTimer);
      clearTimeout(timeoutTimer);
      resolve(result);
    };

    const checkCompletion = () => {
      checkCount++;
      const feed = resolveSelector('songFeed') ?? document.body;
      const clipCountNow = countClips();
      const audioCountNow = document.querySelectorAll('audio').length;
      const loading = hasLoadingIndicators(feed);

      // Log periodically (every 10th check, ~30 seconds)
      if (checkCount % 10 === 0) {
        console.log(
          `[SBG] Monitor check #${checkCount}: clips=${clipCountNow} (was ${clipCountBefore}), ` +
          `audio=${audioCountNow} (was ${audioCountBefore}), loading=${loading}, sawLoading=${sawLoading}`,
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
          if (!settled) finish({ completed: true, timedOut: false });
        }, 2000);
        return;
      }

      // Strategy 2: New audio elements appeared
      if (audioCountNow > audioCountBefore) {
        console.log(`[SBG] Generation complete (audio count): ${audioCountNow} audio (was ${audioCountBefore})`);
        setTimeout(() => {
          if (!settled) finish({ completed: true, timedOut: false });
        }, 2000);
        return;
      }

      // Strategy 3: Loading indicators appeared then disappeared (wait 3s for stabilization)
      if (sawLoading && !loading && loadingDisappearedAt > 0) {
        const elapsed = Date.now() - loadingDisappearedAt;
        if (elapsed >= 3000) {
          console.log('[SBG] Generation complete (loading indicators cleared)');
          finish({ completed: true, timedOut: false });
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
    const pollTimer = setInterval(checkCompletion, GENERATION_POLL_INTERVAL);

    // Timeout — log state before timing out
    const timeoutTimer = setTimeout(() => {
      const clipCountFinal = countClips();
      const audioCountFinal = document.querySelectorAll('audio').length;
      console.log(
        `[SBG] Generation TIMED OUT after ${timeoutMs / 1000}s. ` +
        `clips=${clipCountFinal} (was ${clipCountBefore}), ` +
        `audio=${audioCountFinal} (was ${audioCountBefore}), ` +
        `sawLoading=${sawLoading}`,
      );
      finish({ completed: false, timedOut: true });
    }, timeoutMs);
  });
}
