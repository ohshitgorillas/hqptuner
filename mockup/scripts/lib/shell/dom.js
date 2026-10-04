// Tiny DOM helpers. No framework: the mockup stays readable as plain markup + data.

import { classNames } from "../../model/shell/format.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * A child h() and s() append: a node, text (strings, numbers), an array of children (flattened), or a falsy value
 * (skipped).
 *
 * @typedef {Node | string | number | boolean | null | undefined | KidList} Kid
 */

/**
 * An array of children, at any depth.
 *
 * @typedef {{ readonly [i: number]: Kid, readonly length: number }} KidList
 */

/**
 * An `on` handler. Method-typed, so a handler that names its own event type (MouseEvent, InputEvent) fits too.
 *
 * @typedef {{ handle(e: Event): void }["handle"]} Listener
 */

/**
 * h() / s() attributes: the named keys are handled as below, any other key is set as an attribute.
 *
 * @typedef {{
 *   [attr: string]: unknown,
 *   class?: string | number | boolean | null,
 *   text?: string | null,
 *   data?: Record<string, unknown>,
 *   aria?: Record<string, unknown>,
 *   on?: Record<string, Listener>,
 *   hidden?: unknown,
 * }} Attrs
 */

/**
 * The element name a tag string opens with: `button` of `button.btn#save`; the whole string when it has neither.
 *
 * @template {string} T
 * @typedef {T extends `${infer N}.${string}` ? TagName<N> : T extends `${infer N}#${string}` ? TagName<N> : T} TagName
 */

/**
 * The HTML element a tag string makes: its own interface for a known name, HTMLElement otherwise.
 *
 * @template {string} T
 * @typedef {TagName<T> extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[TagName<T>] : HTMLElement} HtmlOf
 */

/**
 * The SVG element a tag string makes: its own interface for a known name, SVGElement otherwise.
 *
 * @template {string} T
 * @typedef {TagName<T> extends keyof SVGElementTagNameMap ? SVGElementTagNameMap[TagName<T>] : SVGElement} SvgOf
 */

/**
 * The first element under `root` that matches `sel`, else null.
 *
 * @param {string} sel
 * @param {ParentNode} [root]
 */
export const $ = (sel, root = document) => root.querySelector(sel);

/**
 * h('button.btn.sm#save', {type: 'button', aria: {expanded: false}, on: {click}}, 'Save', child…)
 * Tag string takes optional .classes and #id. Attrs:
 *   class   extra classes (string, falsy skipped)
 *   text    textContent
 *   data    {key: value} → data-key
 *   aria    {key: value} → aria-key
 *   on      {event: handler}
 *   hidden  boolean property
 *   any other key → setAttribute (true → "", false/null/undefined → skipped)
 * Children: nodes, strings (text), arrays (flattened), falsy (skipped).
 *
 * @template {string} T
 * @param {T} tag
 * @param {Attrs} [attrs]
 * @param {...Kid} kids
 * @returns {HtmlOf<T>}
 */
export function h(tag, attrs = {}, ...kids) {
  return /** @type {HtmlOf<T>} */ (build(document.createElement.bind(document), tag, attrs, kids));
}

/**
 * Same as h() but in the SVG namespace.
 *
 * @template {string} T
 * @param {T} tag
 * @param {Attrs} [attrs]
 * @param {...Kid} kids
 * @returns {SvgOf<T>}
 */
export function s(tag, attrs = {}, ...kids) {
  return /** @type {SvgOf<T>} */ (build((t) => document.createElementNS(SVG_NS, t), tag, attrs, kids));
}

/**
 * Gray a whole block but one element (its gray reason): everything else dims as `.grayed` did on the block, the reason
 * stays legible and its link usable (lib/xref.js).
 *
 * @param {Element} root
 * @param {Element} keep
 * @param {boolean} on
 */
export function grayBut(root, keep, on) {
  for (const c of root.children) {
    if (c === keep) continue;
    if (c.contains(keep)) grayBut(c, keep, on);
    else c.classList.toggle("grayed", on);
  }
}

/**
 * @template {Element} E
 * @param {(name: string) => E} create
 * @param {string} tag
 * @param {Attrs} attrs
 * @param {Kid[]} kids
 * @returns {E}
 */
function build(create, tag, attrs, kids) {
  // 'name.a.b#id' — classes and id in any order after the tag name.
  const name = tag.split(/[.#]/, 1)[0];
  const id = tag.match(/#([^.#]+)/)?.[1];
  const classes = [...tag.matchAll(/\.([^.#]+)/g)].map((m) => m[1]);
  const el = create(name);
  if (id) el.id = id;
  const cls = classNames(...classes, attrs.class);
  if (cls) el.setAttribute("class", cls);
  for (const k of Object.keys(attrs)) if (k !== "class") apply(el, k, attrs);
  append(el, kids);
  return el;
}

/**
 * One attribute key onto the element, by the rules h() lists.
 *
 * @param {Element} el
 * @param {string} k
 * @param {Attrs} attrs
 */
function apply(el, k, attrs) {
  if (k === "text") el.textContent = attrs.text ?? null;
  else if (k === "hidden") Object.assign(el, { hidden: !!attrs.hidden });
  else if (k === "data") setEach(el, "data-", attrs.data, (v) => v);
  else if (k === "aria") setEach(el, "aria-", attrs.aria, (v) => (typeof v === "boolean" ? String(v) : v));
  else if (k === "on") for (const [ev, fn] of Object.entries(attrs.on ?? {})) el.addEventListener(ev, fn);
  else set(el, k, attrs[k]);
}

/**
 * Each entry of a prefixed group (`data-`, `aria-`) as an attribute.
 *
 * @param {Element} el
 * @param {string} prefix
 * @param {Record<string, unknown> | undefined} group
 * @param {(v: unknown) => unknown} value
 */
function setEach(el, prefix, group, value) {
  for (const [k, v] of Object.entries(group ?? {})) set(el, prefix + k, value(v));
}

/**
 * @param {Element} el
 * @param {string} k
 * @param {unknown} v
 */
function set(el, k, v) {
  if (v === false || v === null || v === undefined) return;
  el.setAttribute(k, v === true ? "" : String(v));
}

/**
 * @param {Element} el
 * @param {Kid[]} kids
 */
function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false || k === "") continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
