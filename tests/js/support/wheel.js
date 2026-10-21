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
//   2. if nothing canceled the event, the DEFAULT ACTION runs — a wheel over a
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
// would satisfy the contract just as well, which is why the bubble is modeled.
//
// LIMIT OF THE BUBBLE, stated rather than glossed: the chain is built from
// `props.children`, so it links a control to the wrappers rendered by the SAME
// component. It does not cross a component boundary — a wrapper emitted by a
// PARENT component around a child component's control is not on the chain these
// helpers walk. Moving the guard to such a wrapper preserves the behavior in a
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

/**
 * A vnode's props, as the harnesses read them.
 *
 * The named members are the DOM attributes these helpers reason about; the index
 * signature carries everything else a component passes through, `unknown` rather
 * than a guess, so a handler is reached by testing `typeof … === "function"`.
 *
 * @typedef {{
 *   [key: string]: unknown,
 *   children?: unknown,
 *   type?: string,
 *   value?: string | number,
 *   step?: string | number,
 *   max?: string | number,
 *   checked?: boolean,
 * }} VNodeProps
 */

/**
 * A preact vnode, as `options.vnode` hands it over.
 *
 * `type` is the tag name for a host element and the component function for a
 * component, which is why the helpers below compare it against a string rather
 * than assuming one.
 *
 * @typedef {{ type: string | Function, props: VNodeProps }} VNode
 */

/**
 * A vnode's props, standing in an empty bag for a node created without any.
 *
 * @param {VNode} v
 * @returns {VNodeProps}
 */
export const propsOf = (v) => v.props || {};

// Every wheel-sensitive control the render produced, in creation order, each
// with a label naming what it is so a case can say which control it drove, and
// with whether a browser's default action could move it at all.
/**
 * One wheel-sensitive control of a render: the vnode, the name a case refers to
 * it by, and whether a browser's default action could move it at all.
 *
 * @typedef {{ node: VNode, label: string, movable: boolean }} WheelControl
 */

/**
 * A DOM event as a handler receives it: `el` is both target and current target, and `preventDefault` marks it canceled.
 *
 * @param {string} type
 * @param {unknown} el
 * @param {Record<string, unknown>} [extra]
 */
export function domEvent(type, el, extra = {}) {
  const ev = {
    type,
    target: el,
    currentTarget: el,
    defaultPrevented: false,
    cancelable: true,
    preventDefault() {
      ev.defaultPrevented = true;
    },
    stopPropagation() {},
    ...extra,
  };
  return ev;
}

/**
 * Calls one handler prop with an event, when the vnode carries it.
 *
 * @param {VNode} node
 * @param {string} name
 * @param {unknown} ev
 */
export function fire(node, name, ev) {
  const fn = propsOf(node)[name];
  if (typeof fn === "function") fn(ev);
}

/**
 * Hands an element to a vnode's ref, object or callback, as mounting would.
 *
 * @param {VNode} box
 * @param {unknown} el
 */
export function attach(box, el) {
  const ref = /** @type {{ ref?: unknown }} */ (/** @type {unknown} */ (box)).ref;
  if (typeof ref === "function") ref(el);
  else if (ref && typeof ref === "object") /** @type {{ current: unknown }} */ (ref).current = el;
}

/**
 * The vnodes from `node` out to the outermost element of the same render: the chain a wheel bubbles along.
 *
 * @param {VNode[]} seen
 * @param {VNode} node
 * @returns {VNode[]}
 */
function ancestry(seen, node) {
  /** @param {unknown} kids */
  const flat = (kids) => (Array.isArray(kids) ? kids.flat(Infinity) : [kids]);
  /** @type {VNode[]} */
  const chain = [node];
  let at = node;
  for (;;) {
    const here = at;
    const parent = seen.find((v) => flat(propsOf(v).children).includes(here));
    if (!parent) return chain;
    chain.push(parent);
    at = parent;
  }
}

/**
 * One wheel over a control, as a browser delivers it: the event bubbles from the control's vnode outwards through every
 * wheel listener of the same render, then, unless canceled or the control is not the document's active element, the
 * default action runs. `document` and `window` exist only for the dispatch.
 *
 * @param {{ seen: VNode[], node: VNode, el: unknown, doc: { activeElement: unknown } }} at every vnode of the render,
 *   the control's vnode and element (the event's target), and the document, whose active element decides the default
 *   action
 * @param {number} deltaY the wheel's vertical delta
 * @param {() => void} byDefault the default action: what the browser does to a focused control the wheel was not stopped on
 */
export function wheelAt({ seen, node, el, doc }, deltaY, byDefault) {
  const g = /** @type {Record<string, unknown>} */ (globalThis);
  const before = { document: g.document, window: g.window };
  g.document = doc;
  g.window = { scrollBy() {}, scroll() {} };
  try {
    const ev = domEvent("wheel", el, { deltaY, deltaX: 0, deltaMode: 0 });
    for (const on of ancestry(seen, node)) fire(on, "onWheel", ev);
    if (!ev.defaultPrevented && doc.activeElement === el) byDefault();
  } finally {
    g.document = before.document;
    g.window = before.window;
  }
}
