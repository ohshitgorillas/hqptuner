// A wheel, delivered the way a browser delivers one.
//
// The component suites render through preact-render-to-string and there is no
// DOM on this host, so a pointer gesture cannot be made to happen the way a
// user makes it happen. What CAN be reproduced faithfully is the browser's own
// dispatch contract for a wheel over a form control, which is short and
// documented:
//
//   1. the event travels the ancestor chain from the control outwards, and
//      every element carrying a wheel listener gets it;
//   2. if nothing cancelled the event, the DEFAULT ACTION runs — a wheel over a
//      focused number/range input steps its value, a wheel over a select moves
//      its selection, and either fires the control's own input/change handlers.
//
// `wheelAt` performs exactly that: bubble, then default action. Nothing of
// HQPTuner's is stubbed — the handlers invoked are the component's real ones,
// reached through preact's own `options.vnode` creation hook (the renderer's
// public seam, third-party surface), which is the house pattern for firing a
// handler SSR never fires (tests/js/components/narrowbar.test.js).
//
// The caller then asserts on what a caller can see: the control's value in the
// next render, the callback the component was handed, the requests the wire
// fake was given. Never on whether an `onWheel` prop is present — that is
// implementation shape, and a guard installed on a wrapper element instead
// would satisfy the contract just as well, which is why the bubble is modelled.
//
// LIMIT OF THE BUBBLE, stated rather than glossed: the chain is built from
// `props.children`, so it links a control to the wrappers rendered by the SAME
// component. It does not cross a component boundary — a wrapper emitted by a
// PARENT component around a child component's control is not on the chain these
// helpers walk. Moving the guard to such a wrapper preserves the behaviour in a
// browser and would still turn every case here red; read a failure of that shape
// as a harness limit, not a regression.
//
// The simulated default action must be able to MOVE the control, or the case
// proves nothing: a select with no second option "steps" to the value it already
// has, and every assertion downstream passes whether or not anything guards it.
// `wheelAt` throws on such a control rather than dispatching over it, the same
// way a case throws on a render with no control at all.
//
// `document` and `window` are environment seams the guard reads (activeElement,
// scrollBy). They exist in a browser and not under `node --test`, so they are
// installed for the duration of one dispatch and restored afterwards, whatever
// happens. The control is made the ACTIVE element: a focused control is the
// case the contract is hardest on, since it is the one a browser will happily
// let the wheel edit.

import { options } from "preact";
import { render } from "preact-render-to-string";

// One render, keeping every vnode preact builds along the way. The hook is
// restored even if the render throws, so no case can poison the next.
export function renderWith(vnode) {
  const seen = [];
  const previous = options.vnode;
  options.vnode = (v) => {
    seen.push(v);
    if (previous) previous(v);
  };
  try {
    return { out: render(vnode), seen };
  } finally {
    options.vnode = previous;
  }
}

const childList = (children, out = []) => {
  if (Array.isArray(children)) {
    for (const kid of children) childList(kid, out);
    return out;
  }
  if (children && typeof children === "object") out.push(children);
  return out;
};

// child vnode -> its parent vnode, for the bubble.
function parentMap(seen) {
  const map = new Map();
  for (const v of seen) {
    for (const kid of childList(v && v.props && v.props.children)) map.set(kid, v);
  }
  return map;
}

const isWheelControl = (v) =>
  v &&
  typeof v === "object" &&
  (v.type === "select" || (v.type === "input" && ["number", "range"].includes((v.props || {}).type)));

// Every wheel-sensitive control the render produced, in creation order, each
// with a label naming what it is so a case can say which control it drove, and
// with whether a browser's default action could move it at all.
export function controlsIn(seen) {
  const counts = {};
  return seen.filter(isWheelControl).map((node) => {
    const kind = node.type === "select" ? "select" : `${node.props.type}_box`;
    counts[kind] = (counts[kind] || 0) + 1;
    return { node, label: `${kind}_${counts[kind]}`, movable: canMove(node) };
  });
}

// Whether the browser's default action has anywhere to move this control to. A
// dropdown offering one option (or none) has not, and a wheel over it is a
// no-op in a browser too — so it cannot witness the guard either way.
function canMove(node) {
  if (node.type !== "select") return true;
  const current = String((node.props || {}).value ?? "");
  return optionValues(node).some((v) => v !== current);
}

const optionValues = (node) =>
  childList(node.props && node.props.children)
    .filter((v) => v && v.type === "option")
    .map((v) => String((v.props || {}).value ?? ""));

// What the browser's default action would move the control to: the next step on
// a number or range, some other option on a select.
function steppedValue(node) {
  const p = node.props || {};
  if (node.type === "select") {
    const current = String(p.value ?? "");
    const other = optionValues(node).find((v) => v !== current);
    if (other === undefined) {
      throw new Error(`a wheel cannot move this dropdown: its options are [${optionValues(node)}], value ${current}`);
    }
    return other;
  }
  const step = Number(p.step) || 1;
  const current = Number(p.value);
  const base = Number.isFinite(current) ? current : 0;
  const max = Number(p.max);
  const up = base + step;
  return String(Number.isFinite(max) && up > max ? base - step : up);
}

function element(node) {
  const p = node.props || {};
  return {
    tagName: String(node.type).toUpperCase(),
    type: p.type,
    value: String(p.value ?? ""),
    valueAsNumber: Number(p.value),
    checked: !!p.checked,
    dataset: {},
    blur() {},
    focus() {},
    select() {},
    closest: () => null,
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 20 }),
  };
}

function runDefaultAction(node, el) {
  const p = node.props || {};
  const next = steppedValue(node);
  el.value = next;
  el.valueAsNumber = Number(next);
  const ev = {
    target: el,
    currentTarget: el,
    preventDefault() {},
    stopPropagation() {},
  };
  if (typeof p.onInput === "function") p.onInput(ev);
  if (typeof p.onChange === "function") p.onChange(ev);
}

function withBrowserGlobals(active, body) {
  const hadDocument = "document" in globalThis;
  const hadWindow = "window" in globalThis;
  const oldDocument = globalThis.document;
  const oldWindow = globalThis.window;
  globalThis.document = { activeElement: active };
  globalThis.window = { scrollBy: () => {} };
  try {
    return body();
  } finally {
    if (hadDocument) globalThis.document = oldDocument;
    else delete globalThis.document;
    if (hadWindow) globalThis.window = oldWindow;
    else delete globalThis.window;
  }
}

// One wheel over `node`, focused, delivered as a browser delivers it.
export function wheelAt(seen, node, deltaY = 120) {
  // Checked BEFORE the dispatch, not inside the default action: a guard that
  // cancels the event never reaches the default action, so an immovable control
  // would otherwise slip through silently on exactly the tree that is supposed
  // to be green.
  if (!canMove(node)) {
    throw new Error(`a wheel cannot move this ${node.type}: nothing for the default action to change it to`);
  }
  const parents = parentMap(seen);
  const el = element(node);
  const event = {
    type: "wheel",
    deltaX: 0,
    deltaY,
    deltaZ: 0,
    deltaMode: 0,
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
  withBrowserGlobals(el, () => {
    for (let v = node; v; v = parents.get(v)) {
      const handler = v.props && v.props.onWheel;
      if (typeof handler === "function") {
        event.currentTarget = v === node ? el : element(v);
        handler(event);
      }
      if (event.propagationStopped) break;
    }
    if (!event.defaultPrevented) runDefaultAction(node, el);
  });
}

// The values a user can read off a render: what every input CARRIES a value
// attribute for, and which option every dropdown has picked. Specific fields
// with a known meaning, not a snapshot of the markup.
//
// An input with no value attribute is an uncontrolled one, synced by ref in an
// effect SSR never runs (docs/testing.md harness facts): it reads the same
// before and after any edit, so counting it would pad the comparison with
// readings that cannot move. Those are left OUT, and `count` is what remains —
// a case states how many readings it expects to be comparing, so one that
// observes nothing fails loudly instead of comparing two empty lists.
export function formValues(out) {
  const valueOf = (fragment) => (/\bvalue="([^"]*)"/.exec(fragment) || [])[1];
  const inputs = [...out.matchAll(/<input\b[^>]*>/g)].map((m) => valueOf(m[0])).filter((v) => v !== undefined);
  const picked = [...out.matchAll(/<option\b([^>]*)>/g)]
    .filter((m) => /\bselected\b/.test(m[1]))
    .map((m) => valueOf(m[1]) ?? "");
  return { inputs, picked, count: inputs.length + picked.length };
}
