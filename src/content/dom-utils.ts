import { ELEMENT_WAIT_INTERVAL, ELEMENT_WAIT_TIMEOUT, INPUT_SETTLE_DELAY } from '../config/constants';

/**
 * Set a value on a React-controlled input/textarea using native setter
 * to trigger React's synthetic change event.
 * Handles HTMLInputElement, HTMLTextAreaElement, and contenteditable elements.
 */
export function setNativeValue(element: Element, value: string): void {
  // ContentEditable element
  if (
    element instanceof HTMLDivElement ||
    element instanceof HTMLSpanElement ||
    element.getAttribute('contenteditable') === 'true'
  ) {
    element.textContent = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  const isTextArea = element instanceof HTMLTextAreaElement;
  const isInput = element instanceof HTMLInputElement;

  if (!isTextArea && !isInput) {
    // Unknown element — try direct property set + events
    (element as any).value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }

  const target = element as HTMLInputElement | HTMLTextAreaElement;

  // Use the correct prototype setter based on element type
  const prototype = isTextArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

  if (descriptor?.set) {
    try {
      descriptor.set.call(target, value);
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    } catch {
      // Fall through to alternatives
    }
  }

  // Fallback: execCommand (works well with React controlled inputs)
  try {
    target.focus();
    target.select();
    document.execCommand('selectAll', false);
    document.execCommand('insertText', false, value);
    return;
  } catch {
    // Fall through
  }

  // Last resort: direct assignment + events
  target.value = value;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Wait for an element to appear in the DOM.
 */
export function waitForElement(
  selector: string,
  timeout = ELEMENT_WAIT_TIMEOUT,
): Promise<Element | null> {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const interval = setInterval(() => {
      const el = document.querySelector(selector);
      if (el) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve(el);
      }
    }, ELEMENT_WAIT_INTERVAL);

    const timer = setTimeout(() => {
      clearInterval(interval);
      resolve(null);
    }, timeout);
  });
}

/**
 * Find an element by text content.
 * Optionally restrict to direct text (not nested) to avoid false matches.
 */
export function findElementByText(
  tag: string,
  text: string,
  container: Element | Document = document,
): Element | null {
  const elements = container.querySelectorAll(tag);
  const lowerText = text.toLowerCase();

  // First pass: prefer elements whose own direct text matches
  for (const el of elements) {
    const directText = getDirectTextContent(el).toLowerCase();
    if (directText.includes(lowerText)) {
      return el;
    }
  }

  // Second pass: check full textContent
  for (const el of elements) {
    if (el.textContent?.trim().toLowerCase().includes(lowerText)) {
      return el;
    }
  }

  return null;
}

/** Get only the direct text of an element (not nested children) */
function getDirectTextContent(el: Element): string {
  let text = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
    }
  }
  return text.trim();
}

/**
 * Click an element, dispatching pointer + mouse events.
 * Modern React / Radix UI components often listen to pointer events.
 */
export function clickElement(element: Element): void {
  if (element instanceof HTMLElement) {
    element.focus();
  }

  const rect = element.getBoundingClientRect();
  const opts: PointerEventInit & MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    pointerId: 1,
    pointerType: 'mouse',
  };

  // Pointer events first (Radix UI, headless UI, etc.)
  element.dispatchEvent(new PointerEvent('pointerdown', opts));
  element.dispatchEvent(new PointerEvent('pointerup', opts));

  // Mouse events
  element.dispatchEvent(new MouseEvent('mousedown', opts));
  element.dispatchEvent(new MouseEvent('mouseup', opts));
  element.dispatchEvent(new MouseEvent('click', opts));
}

/**
 * Forceful click: tries synthetic events first, then native .click().
 * Use when a normal clickElement doesn't trigger the handler.
 */
export function forceClick(element: Element): void {
  clickElement(element);
  // Also try native click as last resort
  if (element instanceof HTMLElement) {
    element.click();
  }
}

/**
 * Trigger click via React internal props (bypasses DOM event delegation).
 * Solves the problem where synthetic PointerEvent / MouseEvent dispatched
 * on Radix UI triggers don't open dropdown menus because React's delegation
 * or isTrusted checks prevent them from being processed.
 *
 * Tries: __reactProps$ direct → __reactFiber$ tree walk (up to 15 ancestors).
 */
export function triggerReactClick(el: Element): boolean {
  const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
  if (propsKey) {
    const props = (el as any)[propsKey];
    const rect = el.getBoundingClientRect();
    const init: PointerEventInit & MouseEventInit = {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      pointerId: 1,
      pointerType: 'mouse',
    };

    let hit = false;
    if (typeof props?.onPointerDown === 'function') {
      props.onPointerDown(new PointerEvent('pointerdown', init));
      hit = true;
    }
    if (typeof props?.onPointerUp === 'function') {
      props.onPointerUp(new PointerEvent('pointerup', init));
    }
    if (typeof props?.onClick === 'function') {
      props.onClick(new MouseEvent('click', init));
      hit = true;
    }
    if (hit) return true;
  }

  // Walk React fiber tree to find handlers on ancestor components
  const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
  if (fiberKey) {
    let fiber = (el as any)[fiberKey];
    const rect = el.getBoundingClientRect();
    for (let i = 0; i < 15 && fiber; i++, fiber = fiber.return) {
      const mp = fiber.memoizedProps;
      if (!mp) continue;
      let hit = false;
      if (typeof mp.onPointerDown === 'function') {
        mp.onPointerDown(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, button: 0,
          clientX: rect.left + rect.width / 2,
          clientY: rect.top + rect.height / 2,
        }));
        hit = true;
      }
      if (typeof mp.onClick === 'function') {
        mp.onClick(new MouseEvent('click', { bubbles: true, button: 0 }));
        hit = true;
      }
      if (hit) return true;
    }
  }

  return false;
}

/**
 * Trigger hover via React internal props.
 * Needed for Radix UI sub-menu triggers that open on pointer move/enter.
 */
export function triggerReactHover(el: Element): boolean {
  const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
  if (!propsKey) return false;

  const props = (el as any)[propsKey];
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  let hit = false;
  if (typeof props?.onPointerEnter === 'function') {
    props.onPointerEnter(new PointerEvent('pointerenter', {
      bubbles: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse',
    }));
    hit = true;
  }
  if (typeof props?.onPointerMove === 'function') {
    props.onPointerMove(new PointerEvent('pointermove', {
      bubbles: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse',
    }));
    hit = true;
  }
  if (typeof props?.onMouseEnter === 'function') {
    props.onMouseEnter(new MouseEvent('mouseenter', { bubbles: true, clientX: cx, clientY: cy }));
    hit = true;
  }
  if (typeof props?.onMouseMove === 'function') {
    props.onMouseMove(new MouseEvent('mousemove', { bubbles: true, clientX: cx, clientY: cy }));
    hit = true;
  }

  return hit;
}

/**
 * Poll for an element matching a selector+text to appear in the DOM.
 */
export function waitForElementByText(
  selector: string,
  text: string,
  timeout = 5000,
  container: Element | Document = document,
): Promise<Element | null> {
  return new Promise((resolve) => {
    const found = findElementByText(selector, text, container);
    if (found) {
      resolve(found);
      return;
    }

    const interval = setInterval(() => {
      const el = findElementByText(selector, text, container);
      if (el) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve(el);
      }
    }, 300);

    const timer = setTimeout(() => {
      clearInterval(interval);
      resolve(null);
    }, timeout);
  });
}

/**
 * Fill an input/textarea/contenteditable with a value, then wait for React to settle.
 */
export async function fillInput(element: Element, value: string): Promise<void> {
  if (element instanceof HTMLElement) {
    element.focus();
  }

  // Clear existing content first
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    setNativeValue(element, '');
    await delay(100);
  }

  setNativeValue(element, value);
  await delay(INPUT_SETTLE_DELAY);
}

/**
 * Utility: delay for ms milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
