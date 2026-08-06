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

const classWords = (props) =>
  String((props && (props.class ?? props.className)) || "")
    .split(/\s+/)
    .filter(Boolean);

const kids = (children, out = []) => {
  if (Array.isArray(children)) {
    for (const kid of children) kids(kid, out);
    return out;
  }
  if (children && typeof children === "object") out.push(children);
  return out;
};

// child vnode -> its parent vnode, for the bubble.
function parentMap(seen) {
  const map = new Map();
  for (const v of seen) {
    for (const kid of kids(v && v.props && v.props.children)) map.set(kid, v);
  }
  return map;
}

// The dial the gesture lands on. Anything other than exactly one match throws
// rather than dragging something else.
function findDial(seen) {
  const hits = seen.filter((v) => v && typeof v === "object" && v.props && classWords(v.props).includes("knob-dial"));
  if (hits.length !== 1) throw new Error(`expected one .knob-dial in the render, found ${hits.length}`);
  return hits[0];
}

// An element for one level of the chain: the pointer-capture and geometry
// surface a drag handler reads off `currentTarget`.
function element(tag = "DIV") {
  const captured = new Set();
  return {
    tagName: tag,
    dataset: {},
    focus() {},
    blur() {},
    setPointerCapture: (id) => captured.add(id),
    releasePointerCapture: (id) => captured.delete(id),
    hasPointerCapture: (id) => captured.has(id),
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
function seams(listeners) {
  const add = (type, fn) => {
    if (typeof fn !== "function") return;
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  };
  const remove = (type, fn) =>
    listeners.set(
      type,
      (listeners.get(type) || []).filter((l) => l !== fn),
    );
  return { addEventListener: add, removeEventListener: remove };
}

function withBrowserGlobals(listeners, active, body) {
  const had = { document: "document" in globalThis, window: "window" in globalThis };
  const old = { document: globalThis.document, window: globalThis.window };
  const seam = seams(listeners);
  globalThis.document = { ...seam, activeElement: active, body: { ...seam } };
  globalThis.window = { ...seam, scrollBy: () => {}, getComputedStyle: () => ({}) };
  try {
    return body();
  } finally {
    for (const name of ["document", "window"]) {
      if (had[name]) globalThis[name] = old[name];
      else delete globalThis[name];
    }
  }
}

// The bubble: from the dial outwards, every ancestor carrying a handler for this
// event, then the listeners installed on window/document. Returns how many
// recipients the event actually had.
function bubble(chain, event, prop, { el, globals }) {
  let reached = 0;
  for (const v of chain) {
    const handler = v.props && v.props[prop];
    if (typeof handler === "function") {
      event.currentTarget = v === chain[0] ? el : element();
      handler(event);
      reached += 1;
    }
    if (event.propagationStopped) break;
  }
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
export function knobKeys(vnode) {
  const { seen } = renderWith(vnode);
  const dial = findDial(seen);
  const parents = parentMap(seen);
  const el = element("svg");
  const body = element("BODY");
  const listeners = new Map();

  const chain = [];
  for (let v = dial; v; v = parents.get(v)) chain.push(v);

  const dispatch = (type, prop, extra) => {
    const event = uiEvent(type, el, extra);
    const globals = (listeners.get(type) || []).slice();
    return withBrowserGlobals(listeners, body, () => bubble(chain, event, prop, { el, globals }));
  };

  const fire = (type, prop, extra) => {
    if (dispatch(type, prop, extra) === 0)
      throw new Error(`nothing received the ${type}: no ${prop} on the dial's chain, no listener for it`);
  };

  // A browser announces a focus change twice: `focus`/`blur`, which do not
  // bubble but are capturable, and `focusin`/`focusout`, which bubble. Both are
  // delivered, in the order a browser fires them, so a case states "the dial was
  // focused" rather than which of the two spellings the component chose to
  // listen for. Only the pair reaching nobody at all is an error — a component
  // listening for one spelling and not the other has still been told.
  const firePair = (spellings) => {
    let reached = 0;
    for (const [type, prop] of spellings) reached += dispatch(type, prop, { relatedTarget: null });
    if (reached === 0)
      throw new Error(
        `nothing received the focus change: no ${spellings.map(([, p]) => p).join("/")} on the dial's chain, ` +
          `no listener for ${spellings.map(([t]) => t).join("/")}`,
      );
  };

  return {
    focus: () =>
      firePair([
        ["focus", "onFocus"],
        ["focusin", "onFocusIn"],
      ]),
    blur: () =>
      firePair([
        ["blur", "onBlur"],
        ["focusout", "onFocusOut"],
      ]),
    key: (key, { shiftKey = false } = {}) => fire("keydown", "onKeyDown", keyFields(key, shiftKey)),
    dblClick: () => fire("dblclick", "onDblClick", { button: 0, buttons: 0, detail: 2, clientX: 24, clientY: 24 }),
  };
}

// One gesture over the dial of a rendered knob.
//
// `down(clientY)` presses the primary button on the dial; `move(clientY,
// buttons)` delivers one pointermove carrying the buttons still held — 1 for a
// live drag, 0 for a drag whose release the page never saw; `up(clientY)`
// releases it the ordinary way.
export function knobDrag(vnode) {
  const { seen } = renderWith(vnode);
  const dial = findDial(seen);
  const parents = parentMap(seen);
  const el = element("svg");
  const body = element("BODY");
  const listeners = new Map();

  const chain = [];
  for (let v = dial; v; v = parents.get(v)) chain.push(v);

  // `document.activeElement` reports the BODY throughout, exactly as `knobKeys`
  // offers it: the harness declines to make that signal look usable anywhere, so
  // a drag route narrowed to `activeElement === the dial` is caught here rather
  // than passing on a seam no engine actually reports that way.
  const fire = (type, prop, clientY, buttons) => {
    const event = pointerEvent(type, el, clientY, buttons);
    const globals = (listeners.get(type) || []).slice();
    const reached = withBrowserGlobals(listeners, body, () => bubble(chain, event, prop, { el, globals }));
    if (reached === 0)
      throw new Error(`nothing received the ${type}: no ${prop} on the dial's chain, no listener for it`);
  };

  return {
    down: (clientY) => fire("pointerdown", "onPointerDown", clientY, 1),
    move: (clientY, buttons) => fire("pointermove", "onPointerMove", clientY, buttons),
    up: (clientY) => fire("pointerup", "onPointerUp", clientY, 0),
  };
}
