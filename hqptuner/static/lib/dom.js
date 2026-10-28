// Shared htm+preact binding. One `html` tagged template for every component.
// htm binds to preact's hyperscript `h` and parses templates at runtime, so
// components run as served, with no JSX build step.
import { h } from "preact";
import { useEffect, useRef } from "preact/hooks";
import htm from "htm";

export const html = htm.bind(h);

/**
 * A class attribute from the names that apply: falsy entries skipped, the rest joined by spaces ('' when none apply).
 *
 * @param {...(string | number | boolean | null | undefined)} names
 * @returns {string}
 */
export const classNames = (...names) => names.filter(Boolean).join(" ");

/**
 * @typedef {Event & { target: HTMLInputElement }} ControlEvent
 *   An input/change event from a form control. Every handler typed with it is
 *   attached to a range, number or select element, so `target` is narrowed from
 *   the DOM's nullable `EventTarget` to the element the handler reads.
 */

/** The document and window `el` lives in. @param {Node} el @returns {{ doc: Document, win: Window & typeof globalThis }} */
export function pageOf(el) {
  const doc = /** @type {Document} */ (el.ownerDocument ?? el);
  return { doc, win: /** @type {Window & typeof globalThis} */ (doc.defaultView) };
}

/** Whether `node` is an element of any page: the node type tells, where `instanceof Element` names only the global realm's. @param {unknown} node @returns {node is Element} */
export function isElement(node) {
  return /** @type {Node | null} */ (node)?.nodeType === 1;
}

/** Call `fn(rect)` with `el`'s content box on every resize; returns the unobserve function. A page with no ResizeObserver calls `fn` once and returns a no-op. @param {Element} el @param {(rect: DOMRectReadOnly) => void} fn @returns {() => void} */
export function observeSize(el, fn) {
  const { win } = pageOf(el);
  if (typeof win.ResizeObserver !== "function") {
    const box = el.getBoundingClientRect();
    const cs = styleOf(el);
    const px = (/** @type {string} */ k) => parseFloat(cs?.getPropertyValue?.(k)) || 0;
    const width = Math.max(
      0,
      box.width - px("padding-left") - px("padding-right") - px("border-left-width") - px("border-right-width"),
    );
    const height = Math.max(
      0,
      box.height - px("padding-top") - px("padding-bottom") - px("border-top-width") - px("border-bottom-width"),
    );
    fn(
      /** @type {DOMRectReadOnly} */ ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        width,
        height,
        right: width,
        bottom: height,
        toJSON: () => ({}),
      }),
    );
    return () => {};
  }
  const ro = new win.ResizeObserver((entries) => fn(entries[entries.length - 1].contentRect));
  ro.observe(el);
  return () => ro.disconnect();
}

/** getComputedStyle of `el` through its own window. @param {Element} el @returns {CSSStyleDeclaration} */
export function styleOf(el) {
  return pageOf(el).win.getComputedStyle(el);
}

/** devicePixelRatio of the window `el` lives in, 1 where it has none. @param {Element} el @returns {number} */
export function pixelRatio(el) {
  return pageOf(el).win.devicePixelRatio || 1;
}

/** A canvas of `width` by `height` on `el`'s page: an OffscreenCanvas where the window has one, else a `canvas` element of its document. @param {Element} el @param {number} width @param {number} height */
export function makeCanvas(el, width, height) {
  const { doc, win } = pageOf(el);
  if (typeof win.OffscreenCanvas === "function") return new win.OffscreenCanvas(width, height);
  const canvas = doc.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// The mouse wheel never changes a control's value. The wheel is how you move
// down the page, and a page this dense in sliders, number boxes and dropdowns
// would otherwise hand out silent edits to anyone scrolling past one. The guard
// takes the wheel off the control and scrolls the page by the same delta.
//
// A focused control is guarded exactly like an unfocused one: exempting the
// focused control lets a clicked slider take the wheel and move. The guard
// leaves focus where it is, since blurring a number box mid-type fires its
// change handler and commits a half-typed figure.
//
// Attach as onWheel on every wheel-sensitive control: range, number, select.
// preact binds the listener on the element itself, where wheel is non-passive,
// so preventDefault takes effect; a document-level listener is passive by
// default and its preventDefault is ignored.
/**
 * Take the wheel off a control and scroll the page it lives in by the same delta.
 * @param {WheelEvent} e
 */
export function wheelGuard(e) {
  e.preventDefault();
  pageOf(/** @type {Node} */ (e.target)).win.scrollBy(0, e.deltaY);
}

// WebKit gets past wheelGuard: a scroll gesture over a slider does not arrive
// as a cancelable wheel at all. On Safari 26.5 the wheel events it sends are
// non-cancelable and the value change rides a separate channel: for the ARIA
// slider role, TRUSTED ArrowLeft/ArrowRight keydowns aimed at the element
// without focusing it (Knob.js onKeyDown carries that case); for a native
// range, an `input` that simply appears, with wheelGuard never firing. Neither
// can be prevented, so a slider edit is honored only with explicit user
// provenance on that element:
//
//   held:  a pointer is down on it (drag, track-click). Cleared by pointerup /
//          pointercancel, and by any pointermove reporting no buttons: a
//          context menu opened mid-drag eats the pointerup, and without the
//          buttons check the browser's stuck native drag would keep editing.
//   armed: a grant of edits from a slider keystroke on it WHILE IT HOLDS FOCUS
//          (the input and the change of the keystroke: KEY_EDITS), or from a
//          drag release (the one committing `change` a native range fires
//          AFTER pointerup: RELEASE_EDITS). Each honored edit spends one;
//          userEdit is handed no event, so the grant is counted rather than
//          tied to the `change` type. The focus qualifier keeps WebKit's
//          scroll-synthesized arrow key from arming a control the user never
//          touched.
//
// The wheel-injected edit has neither and is refused. State is kept per
// document, set by that document's capture listeners (which see every gesture
// before any handler) once watchGestures is called on it.
const SLIDER_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
const KEY_EDITS = 2;
const RELEASE_EDITS = 1;

/** @typedef {{ held: EventTarget | null, armed: EventTarget | null, left: number, focused: EventTarget | null }} Gestures */
/** @type {WeakMap<object, Gestures>} */
const gestures = new WeakMap();

/** Watch `doc` for the gestures that give a slider edit provenance; one call per document, state kept for that document. @param {Document} doc */
export function watchGestures(doc) {
  /** @type {Gestures} */
  const g = { held: null, armed: null, left: 0, focused: null };
  gestures.set(doc, g);
  const arm = (/** @type {EventTarget | null} */ el, /** @type {number} */ edits) => {
    g.armed = el;
    g.left = edits;
  };
  // Primary button only: a right-click's own pointerdown must not grant (or
  // refresh) provenance; it is the press that opens the context menu that eats
  // the pointerup and leaves the browser's native drag running. The menu
  // opening revokes held outright for the same reason: whatever drag was live,
  // its release will never arrive.
  doc.addEventListener("pointerdown", (e) => e.button === 0 && (g.held = e.target), true);
  doc.addEventListener("contextmenu", () => (g.held = null), true);
  doc.addEventListener(
    "pointerup",
    () => {
      if (g.held) arm(g.held, RELEASE_EDITS);
      g.held = null;
    },
    true,
  );
  doc.addEventListener("pointercancel", () => (g.held = null), true);
  doc.addEventListener("pointermove", (e) => e.buttons === 0 && (g.held = null), true);
  // A slider keystroke arms only the control that actually HOLDS focus. WebKit
  // converts a scroll over a slider-role element into trusted arrow keydowns
  // aimed at it without focusing it (see Knob.js onKeyDown); unqualified, that
  // synthetic key hands the platform's own value change a license to pass. Both
  // spellings are tracked because `focus`/`blur` do not bubble and only reach a
  // capture listener, while `focusin`/`focusout` do; engines differ in which
  // they deliver first, and either one means the same thing here.
  doc.addEventListener("focusin", (e) => (g.focused = e.target), true);
  doc.addEventListener("focus", (e) => (g.focused = e.target), true);
  doc.addEventListener("focusout", () => (g.focused = null), true);
  doc.addEventListener("blur", () => (g.focused = null), true);
  doc.addEventListener(
    "keydown",
    (e) => SLIDER_KEYS.has(e.key) && g.focused === e.target && arm(e.target, KEY_EDITS),
    true,
  );
}

/**
 * Run `fn` as a user edit of the control `el`, reading the gesture state of `el.ownerDocument`: with provenance
 * `fn` runs; without it nothing runs and the control snaps back to `canonical`, the value the component is already
 * rendering, so refusal needs no stored snapshot. Call from every range input's handler alongside wheelGuard.
 * @param {Element} el
 * @param {string} canonical the value the component is already rendering
 * @param {() => void} fn the edit with provenance
 */
export function userEdit(el, canonical, fn) {
  const g = gestures.get(pageOf(el).doc);
  const honored = g?.held === el || (g?.armed === el && g.left > 0);
  if (!honored) {
    /** @type {HTMLInputElement} */ (el).value = canonical;
    return;
  }
  if (g.held !== el) g.left -= 1;
  fn();
}

/**
 * The handler for a range input's `input` or `change`: the control's number goes to `fn` as a user edit, or the
 * control snaps back to `canonical` when the edit has no provenance.
 * @param {string} canonical the value the component is already rendering
 * @param {(v: number) => void} fn
 * @returns {(e: ControlEvent) => void}
 */
export const rangeEdit = (canonical, fn) => (e) => userEdit(e.target, canonical, () => fn(Number(e.target.value)));

// Typed inputs are UNCONTROLLED while focused. `onChange` is the native change
// event (commit on blur), so a half-typed value lives only in the DOM until then,
// and the status and config polls re-render constantly. A controlled `value=`
// would reset the field mid-edit. So sync from the store by ref, and only when
// the user isn't in the field.
/**
 * A ref for a typed input: after every render it shows `value`, unless the user is in the field.
 * @param {string | number | boolean | null | undefined} value
 * @returns {{ current: HTMLInputElement | null }}
 */
export function useSyncWhenIdle(value) {
  const ref = useRef(/** @type {HTMLInputElement | null} */ (null));
  useEffect(() => {
    const el = ref.current;
    if (el && el.ownerDocument.activeElement !== el) el.value = value == null ? "" : String(value);
  });
  return ref;
}

/**
 * An `<input>` that shows `value` without ever overwriting what the user is typing: the first paint carries it as the
 * default, and every later render syncs it only while the field is not focused. Every other prop passes through.
 * @param {{ value: string | number | boolean | null | undefined } & Record<string, unknown>} props
 */
export function TypedInput({ value, ...rest }) {
  const ref = useSyncWhenIdle(value);
  return html`<input ref=${ref} defaultValue=${value == null ? "" : String(value)} ...${rest} />`;
}
