// A pointer drag, delivered the way a browser delivers one.
//
// The component suites render through preact-render-to-string and there is no
// DOM on this host, so a gesture cannot be made to happen the way a user makes
// it happen. What CAN be reproduced faithfully is the browser's own dispatch
// contract for a pointer over a control, which is short and documented:
//
//   1. the event travels the ancestor chain from the element under the pointer
//      outwards, and every element carrying a listener for it gets it;
//   2. `pointerdown` carries `button: 0` and `buttons: 1` for the primary
//      button; every `pointermove` carries `button: -1`, because no button
//      changed state to cause it, while `buttons` reports what is STILL held —
//      0 when the button went up somewhere the page never saw the `pointerup`,
//      which is exactly the context-menu case;
//   3. `currentTarget` is the element the listener sits on, and offers the
//      pointer-capture and geometry surface a drag handler reads.
//
// `knobDrag` performs exactly that: bubble, with events shaped as above. The
// bubble is modelled rather than the mounting point indexed, for the same reason
// `wheelAt` models it — which element of a knob carries the handler is
// implementation shape, and a listener moved to a wrapper of the same component
// honours the same contract.
//
// Nothing of HQPTuner's is stubbed — the handlers invoked are the component's
// real ones, reached through preact's own `options.vnode` creation hook (the
// renderer's public seam, third-party surface), which is the house pattern for
// firing a handler SSR never fires (tests/js/components/narrowbar.test.js,
// tests/js/support/wheel.js). The caller asserts on what a caller can see: the
// callbacks the component was handed, and the store signals it wrote.
//
// LIMIT OF THE BUBBLE, stated rather than glossed: the chain is built from
// `props.children`, so it links the dial to the wrappers rendered by the same
// mount, and to whatever listeners the handlers install on `window` or
// `document` during the gesture. A wrapper emitted by a component the mount does
// not itself render is not on the chain, and neither is a global installed at
// module load. A fire with no recipient at all throws instead of returning
// quietly: a case that dispatches into nothing must fail loudly, not report that
// no callback ran and call that a behaviour. Read such a throw as a limit of the
// dispatch, not as a verdict on the behaviour.
//
// `document` and `window` are environment seams a drag handler reads. They exist
// in a browser and not under `node --test`, so they are installed for the
// duration of one dispatch and restored afterwards, whatever happens.

import { renderWith } from "./wheel.js";

/** @typedef {import("./wheel.js").VNode} VNode */
/** @typedef {import("./wheel.js").VNodeProps} VNodeProps */

/**
 * An event as the handlers under test read it: the fields every event carries,
 * plus the ones a particular kind adds, which the index signature covers.
 *
 * @typedef {{
 *   [key: string]: unknown,
 *   type: string,
 *   target: unknown,
 *   currentTarget: unknown,
 *   defaultPrevented: boolean,
 *   propagationStopped: boolean,
 *   preventDefault: () => void,
 *   stopPropagation: () => void,
 * }} HarnessEvent
 */

/**
 * The globals one dispatch installs, viewed as optional members: under
 * `node --test` neither exists, and the DOM lib declares both as always present
 * and fully shaped.
 *
 * @type {{ document?: unknown, window?: unknown }}
 */
const env = globalThis;

/**
 * @param {VNodeProps} props
 * @returns {string[]}
 */
const classWords = (props) =>
  String((props && (props.class ?? props.className)) || "")
    .split(/\s+/)
    .filter(Boolean);

/**
 * @param {unknown} children
 * @param {VNode[]} [out]
 * @returns {VNode[]}
 */
const kids = (children, out = []) => {
  if (Array.isArray(children)) {
    for (const kid of children) kids(kid, out);
    return out;
  }
  if (children && typeof children === "object") out.push(/** @type {VNode} */ (children));
  return out;
};

/**
 * child vnode -> its parent vnode, for the bubble.
 *
 * @param {VNode[]} seen
 * @returns {Map<VNode, VNode>}
 */
function parentMap(seen) {
  /** @type {Map<VNode, VNode>} */
  const map = new Map();
  for (const v of seen) {
    for (const kid of kids(v && v.props && v.props.children)) map.set(kid, v);
  }
  return map;
}

/**
 * The dial the gesture lands on. Anything other than exactly one match throws
 * rather than dragging something else.
 *
 * @param {VNode[]} seen
 * @returns {VNode}
 */
function findDial(seen) {
  const hits = seen.filter((v) => v && typeof v === "object" && v.props && classWords(v.props).includes("knob-dial"));
  if (hits.length !== 1) throw new Error(`expected one .knob-dial in the render, found ${hits.length}`);
  return hits[0];
}

// An element for one level of the chain: the pointer-capture and geometry
// surface a drag handler reads off `currentTarget`.
//
// `focus()` is a real one, not a no-op: in a browser, focusing an element
// synchronously announces the change to that element's ancestor chain, and a
// handler that focuses its own `currentTarget` is therefore telling the
// component the same thing a click on it would. `onFocus` is how the rig below
// performs that announcement; an element built without one focuses nothing,
// which is the browser's behaviour for an element already focused.
/**
 * @param {string} [tag]
 * @param {() => void} [onFocus]
 */
function element(tag = "DIV", onFocus = () => {}) {
  /** @type {Set<unknown>} */
  const captured = new Set();
  return {
    tagName: tag,
    dataset: {},
    focus() {
      onFocus();
    },
    blur() {},
    setPointerCapture: (/** @type {unknown} */ id) => captured.add(id),
    releasePointerCapture: (/** @type {unknown} */ id) => captured.delete(id),
    hasPointerCapture: (/** @type {unknown} */ id) => captured.has(id),
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 48, bottom: 48, width: 48, height: 48 }),
    closest: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
}

// `button` names the button whose state CHANGED to cause the event: 0 for the
// primary button going down, and -1 on a move, where none did. `buttons` is the
// mask of what is held at that instant, and is the only one of the two that
// answers "is the primary button still down".
/**
 * @param {string} type
 * @param {unknown} el
 * @param {number} clientY
 * @param {number} buttons
 * @returns {HarnessEvent}
 */
function pointerEvent(type, el, clientY, buttons) {
  return {
    type,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    buttons,
    button: type === "pointerdown" ? 0 : -1,
    clientX: 24,
    clientY,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    target: el,
    currentTarget: el,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
  };
}

// A window/document pair that records the listeners a handler installs, so the
// rest of the gesture reaches them too.
/** @typedef {Map<string, Function[]>} Listeners */

/** @param {Listeners} listeners */
function seams(listeners) {
  const add = (/** @type {string} */ type, /** @type {unknown} */ fn) => {
    if (typeof fn !== "function") return;
    const forType = listeners.get(type) || [];
    forType.push(fn);
    listeners.set(type, forType);
  };
  const remove = (/** @type {string} */ type, /** @type {unknown} */ fn) =>
    listeners.set(
      type,
      (listeners.get(type) || []).filter((l) => l !== fn),
    );
  return { addEventListener: add, removeEventListener: remove };
}

/**
 * @template T
 * @param {Listeners} listeners
 * @param {unknown} active
 * @param {() => T} body
 * @returns {T}
 */
function withBrowserGlobals(listeners, active, body) {
  const had = { document: "document" in globalThis, window: "window" in globalThis };
  const old = { document: env.document, window: env.window };
  const seam = seams(listeners);
  env.document = { ...seam, activeElement: active, body: { ...seam } };
  env.window = { ...seam, scrollBy: () => {}, getComputedStyle: () => ({}) };
  try {
    return body();
  } finally {
    /** @type {("document" | "window")[]} */
    const names = ["document", "window"];
    for (const name of names) {
      if (had[name]) env[name] = old[name];
      else delete env[name];
    }
  }
}

// The bubble: from the dial outwards, every ancestor carrying a handler for this
// event, then the listeners installed on window/document. Returns how many
// recipients the event actually had.
//
// `elFor` names the element each level's listener sits on. Every level gets a
// real one — a handler moved from the dial to a wrapper of the same component
// still reads a `currentTarget` it can focus and capture the pointer on, which
// is what a browser hands it, so which level carries the handler stays
// implementation shape rather than something a case can accidentally pin.
/**
 * @param {VNode[]} chain
 * @param {HarnessEvent} event
 * @param {string} prop
 * @param {{ elFor: (v: VNode) => unknown, globals: Function[] }} into
 * @returns {number}
 */
function bubble(chain, event, prop, { elFor, globals }) {
  let reached = 0;
  for (const v of chain) {
    const handler = v.props && v.props[prop];
    if (typeof handler === "function") {
      event.currentTarget = elFor(v);
      handler(event);
      reached += 1;
    }
    if (event.propagationStopped) break;
  }
  const el = elFor(chain[0]);
  event.currentTarget = el;
  for (const listener of globals) {
    listener(event);
    reached += 1;
  }
  return reached;
}

// A keystroke, a focus change or a double click, shaped the way a browser shapes
// one. `extra` carries the fields a handler reads off that particular kind of
// event and nothing else.
/**
 * @param {string} type
 * @param {unknown} el
 * @param {Record<string, unknown>} extra
 * @returns {HarnessEvent}
 */
function uiEvent(type, el, extra) {
  return {
    type,
    target: el,
    currentTarget: el,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    ...extra,
  };
}

/**
 * @param {string} key
 * @param {boolean} shiftKey
 */
const keyFields = (key, shiftKey) => ({
  key,
  shiftKey,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  repeat: false,
});

// Keyboard and focus over the dial of a rendered knob, on one render, so a case
// can focus it, blur it and press a key against the same component instance.
//
// `document.activeElement` reports the BODY throughout, which is what it reports
// on the engine this behaviour exists for: a scroll gesture over a `role=slider`
// element arrives there as a trusted arrow keydown aimed at that element, with
// focus never having moved. The seam is offered in that state deliberately —
// a knob deciding on `activeElement` would answer the same either way, so the
// harness declines to make that signal look usable.
/**
 * Every gesture a knob's dial can be given, on ONE render, so a case can press
 * it and then press a key against the same component instance — which is the
 * only way to state what a mouse press leaves behind.
 *
 * `focusCalls()` reports how many times a handler asked its own
 * `currentTarget` to take focus during the gestures so far. That is the
 * observable of an explicit focus: `preventDefault()` on a `pointerdown`
 * suppresses the browser's focus-on-click, so a control that wants focus has to
 * ask for it, and asking is a call a browser can see.
 *
 * `inert: true` says the control is expected to take NO part in the gesture, so
 * a dispatch nobody receives is a way of satisfying that and not an error. Every
 * other case keeps the loud default: a gesture delivered into nothing is a limit
 * of the dispatch and must say so rather than reporting that no callback ran.
 *
 * @typedef {{
 *   down: (clientY: number) => HarnessEvent,
 *   move: (clientY: number, buttons: number) => HarnessEvent,
 *   up: (clientY: number) => HarnessEvent,
 *   focus: () => void,
 *   blur: () => void,
 *   key: (key: string, opts?: { shiftKey?: boolean }) => void,
 *   dblClick: () => void,
 *   focusCalls: () => number,
 * }} KnobGestures
 */

/**
 * One rendered knob, standing ready to be gestured at: the dial's ancestor
 * chain, the listeners its handlers install, the BODY `document.activeElement`
 * reports, whether a dispatch reaching nobody is an error, and the element each
 * level's listener sits on.
 *
 * @typedef {{
 *   chain: VNode[],
 *   listeners: Listeners,
 *   body: unknown,
 *   inert: boolean,
 *   elFor: (v: VNode) => unknown,
 * }} Rig
 */

/**
 * @param {unknown} vnode
 * @param {boolean} inert
 * @returns {Rig}
 */
function mount(vnode, inert) {
  const { seen } = renderWith(vnode);
  const parents = parentMap(seen);
  /** @type {VNode[]} */
  const chain = [];
  for (let v = /** @type {VNode | undefined} */ (findDial(seen)); v; v = parents.get(v)) chain.push(v);
  return { chain, listeners: new Map(), body: element("BODY"), inert, elFor: () => undefined };
}

// One element per level, kept for the life of the rig: a handler that captures
// the pointer on `currentTarget` at pointerdown and releases it at pointerup is
// talking about the same element both times, exactly as in a browser.
/**
 * @param {VNode[]} chain
 * @param {() => void} onFocus
 * @returns {(v: VNode) => unknown}
 */
function elementsFor(chain, onFocus) {
  /** @type {Map<VNode, ReturnType<typeof element>>} */
  const elements = new Map();
  return (v) => {
    let el = elements.get(v);
    if (!el) {
      el = element(v === chain[0] ? "svg" : "DIV", onFocus);
      elements.set(v, el);
    }
    return el;
  };
}

/**
 * @param {Rig} rig
 * @param {HarnessEvent} event
 * @param {string} prop
 * @param {boolean} [nested]
 * @returns {number}
 */
function dispatchIn({ chain, listeners, body, elFor }, event, prop, nested = false) {
  const globals = (listeners.get(event.type) || []).slice();
  const run = () => bubble(chain, event, prop, { elFor, globals });
  return nested ? run() : withBrowserGlobals(listeners, body, run);
}

/**
 * An event kind, named the two ways a dispatch needs it: what a browser calls
 * it, and the prop a preact component listens for it with.
 *
 * @typedef {[string, string]} Spelling
 */

/**
 * @param {Rig} rig
 * @param {Spelling} spelling
 * @param {Record<string, unknown>} extra
 * @param {boolean} [nested]
 * @returns {number}
 */
const uiDispatchIn = (rig, [type, prop], extra, nested = false) =>
  dispatchIn(rig, uiEvent(type, rig.elFor(rig.chain[0]), extra), prop, nested);

/**
 * @param {Rig} rig
 * @param {Spelling} spelling
 * @param {Record<string, unknown>} extra
 * @returns {void}
 */
function fireIn(rig, [type, prop], extra) {
  if (uiDispatchIn(rig, [type, prop], extra) === 0 && !rig.inert)
    throw new Error(`nothing received the ${type}: no ${prop} on the dial's chain, no listener for it`);
}

// A browser announces a focus change twice: `focus`/`blur`, which do not bubble
// but are capturable, and `focusin`/`focusout`, which bubble. Both are
// delivered, in the order a browser fires them, so a case states "the dial was
// focused" rather than which of the two spellings the component chose to listen
// for. Only the pair reaching nobody at all is an error — a component listening
// for one spelling and not the other has still been told.
/** @type {Spelling[]} */
const FOCUS = [
  ["focus", "onFocus"],
  ["focusin", "onFocusIn"],
];

/** @type {Spelling[]} */
const BLUR = [
  ["blur", "onBlur"],
  ["focusout", "onFocusOut"],
];

const DBL_CLICK = { button: 0, buttons: 0, detail: 2, clientX: 24, clientY: 24 };

/**
 * @param {Rig} rig
 * @param {Spelling[]} spellings
 * @param {boolean} [nested]
 * @returns {number}
 */
function firePairIn(rig, spellings, nested = false) {
  let reached = 0;
  for (const spelling of spellings) reached += uiDispatchIn(rig, spelling, { relatedTarget: null }, nested);
  if (reached === 0 && !rig.inert && !nested)
    throw new Error(
      `nothing received the focus change: no ${spellings.map(([, p]) => p).join("/")} on the dial's chain, ` +
        `no listener for ${spellings.map(([t]) => t).join("/")}`,
    );
  return reached;
}

/**
 * @param {Rig} rig
 * @param {Spelling} spelling
 * @param {number} clientY
 * @param {number} buttons
 * @returns {HarnessEvent}
 */
function firePointerIn(rig, [type, prop], clientY, buttons) {
  const event = pointerEvent(type, rig.elFor(rig.chain[0]), clientY, buttons);
  if (dispatchIn(rig, event, prop) === 0 && !rig.inert)
    throw new Error(`nothing received the ${type}: no ${prop} on the dial's chain, no listener for it`);
  return event;
}

/**
 * @param {unknown} vnode
 * @param {{ inert?: boolean }} [opts]
 * @returns {KnobGestures}
 */
export function knobGestures(vnode, { inert = false } = {}) {
  const rig = mount(vnode, inert);
  let focusCalls = 0;
  // What `element.focus()` does in a browser, from inside whatever handler
  // called it: the focus change is announced synchronously, up the same chain,
  // before the caller's next statement runs. Reaching nobody is not an error —
  // an element with no focus listener is still focusable.
  rig.elFor = elementsFor(rig.chain, () => {
    focusCalls += 1;
    firePairIn(rig, FOCUS, true);
  });

  return {
    down: (clientY) => firePointerIn(rig, ["pointerdown", "onPointerDown"], clientY, 1),
    move: (clientY, buttons) => firePointerIn(rig, ["pointermove", "onPointerMove"], clientY, buttons),
    up: (clientY) => firePointerIn(rig, ["pointerup", "onPointerUp"], clientY, 0),
    focus: () => void firePairIn(rig, FOCUS),
    blur: () => void firePairIn(rig, BLUR),
    key: (key, { shiftKey = false } = {}) => fireIn(rig, ["keydown", "onKeyDown"], keyFields(key, shiftKey)),
    dblClick: () => fireIn(rig, ["dblclick", "onDblClick"], DBL_CLICK),
    focusCalls: () => focusCalls,
  };
}

/**
 * @param {unknown} vnode
 * @returns {{
 *   focus: () => void,
 *   blur: () => void,
 *   key: (key: string, opts?: { shiftKey?: boolean }) => void,
 *   dblClick: () => void,
 * }}
 */
export function knobKeys(vnode) {
  const { focus, blur, key, dblClick } = knobGestures(vnode);
  return { focus, blur, key, dblClick };
}

// One gesture over the dial of a rendered knob.
//
// `down(clientY)` presses the primary button on the dial; `move(clientY,
// buttons)` delivers one pointermove carrying the buttons still held — 1 for a
// live drag, 0 for a drag whose release the page never saw; `up(clientY)`
// releases it the ordinary way.
//
// `document.activeElement` reports the BODY throughout, exactly as `knobKeys`
// offers it: the harness declines to make that signal look usable anywhere, so
// a drag route narrowed to `activeElement === the dial` is caught here rather
// than passing on a seam no engine actually reports that way. A dial that asks
// its own `currentTarget` for focus is a different thing, and IS seen — see
// `knobGestures`.
/**
 * @param {unknown} vnode
 * @returns {{
 *   down: (clientY: number) => HarnessEvent,
 *   move: (clientY: number, buttons: number) => HarnessEvent,
 *   up: (clientY: number) => HarnessEvent,
 * }}
 */
export function knobDrag(vnode) {
  const { down, move, up } = knobGestures(vnode);
  return { down, move, up };
}
