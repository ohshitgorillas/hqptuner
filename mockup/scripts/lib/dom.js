// Tiny DOM helpers. No framework: the mockup stays readable as plain markup + data.

import { classNames } from "../model/format.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

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
 */
export function h(tag, attrs = {}, ...kids) {
  return build(document.createElement.bind(document), tag, attrs, kids);
}

/** Same as h() but in the SVG namespace. */
export function s(tag, attrs = {}, ...kids) {
  return build((t) => document.createElementNS(SVG_NS, t), tag, attrs, kids);
}

/**
 * Gray a whole block but one element (its gray reason): everything else dims as `.grayed` did on the block, the reason
 * stays legible and its link usable (lib/xref.js).
 */
export function grayBut(root, keep, on) {
  for (const c of root.children) {
    if (c === keep) continue;
    if (c.contains(keep)) grayBut(c, keep, on);
    else c.classList.toggle("grayed", on);
  }
}

function build(create, tag, attrs, kids) {
  // 'name.a.b#id' — classes and id in any order after the tag name.
  const [name] = tag.match(/^[^.#]+/);
  const id = tag.match(/#([^.#]+)/)?.[1];
  const classes = [...tag.matchAll(/\.([^.#]+)/g)].map((m) => m[1]);
  const el = create(name);
  if (id) el.id = id;
  const cls = classNames(...classes, attrs.class);
  if (cls) el.setAttribute("class", cls);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") continue;
    if (k === "text") el.textContent = v;
    else if (k === "hidden") el.hidden = !!v;
    else if (k === "data") for (const [dk, dv] of Object.entries(v)) set(el, "data-" + dk, dv);
    else if (k === "aria")
      for (const [ak, av] of Object.entries(v)) set(el, "aria-" + ak, typeof av === "boolean" ? String(av) : av);
    else if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else set(el, k, v);
  }
  append(el, kids);
  return el;
}

function set(el, k, v) {
  if (v === false || v === null || v === undefined) return;
  el.setAttribute(k, v === true ? "" : String(v));
}

function append(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false || k === "") continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
