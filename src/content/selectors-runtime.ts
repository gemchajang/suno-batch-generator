import { SELECTORS, type SelectorKey } from '../config/selectors';
import { findElementByText } from './dom-utils';

/**
 * Resolve a selector key to an actual DOM element using
 * primary → fallback → text match strategy.
 */
export function resolveSelector(key: SelectorKey): Element | null {
  const entry = SELECTORS[key] as {
    primary: string;
    fallbacks: readonly string[];
    textMatch?: string;
    description: string;
  };

  // 1. Try primary selector
  const primary = safeQuerySelector(entry.primary);
  if (primary) {
    // If this entry has a textMatch requirement, verify it
    if (entry.textMatch && !elementContainsText(primary, entry.textMatch)) {
      // Primary found but doesn't have the expected text — continue to fallbacks
    } else {
      return primary;
    }
  }

  // 2. Try fallbacks
  for (const fallback of entry.fallbacks) {
    const el = safeQuerySelector(fallback);
    if (el) {
      if (entry.textMatch && !elementContainsText(el, entry.textMatch)) {
        continue;
      }
      return el;
    }
  }

  // 3. Try text match if defined — only search interactive elements
  if (entry.textMatch) {
    for (const tag of ['button', 'a', '[role="menuitem"]', '[role="option"]']) {
      const el = findElementByText(tag, entry.textMatch);
      if (el) return el;
    }
  }

  // 4. Not found
  return null;
}

/**
 * Resolve a selector key, waiting for the element to appear.
 */
export async function resolveSelectorWithWait(
  key: SelectorKey,
  timeout = 10_000,
): Promise<Element | null> {
  const start = Date.now();
  const entry = SELECTORS[key] as { description: string };

  while (Date.now() - start < timeout) {
    const el = resolveSelector(key);
    if (el) {
      console.log(`[SBG] Found: ${entry.description} → <${el.tagName.toLowerCase()}>`);
      return el;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.warn(`[SBG] NOT FOUND after ${timeout}ms: ${entry.description}`);
  return null;
}

/**
 * querySelector wrapped to catch errors from unsupported selectors.
 */
function safeQuerySelector(selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

/** Check if an element's text content contains the given text (case-insensitive) */
function elementContainsText(el: Element, text: string): boolean {
  return (el.textContent ?? '').toLowerCase().includes(text.toLowerCase());
}
