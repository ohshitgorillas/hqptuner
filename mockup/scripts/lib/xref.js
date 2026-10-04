// Cross-reference links (`Name ›`): a line naming another place as its cause or fix links there (data/xrefs.js).
// main.js registers each target with xrefGo(id, fn); a link only calls it. Same grammar as the Volume drawer's `Loudness ›`.

import { h } from "./dom.js";
import { REASON_XREF } from "../data/xrefs.js";

const GO = new Map();

/** Where a link id goes (main.js: open a drawer, pick its tab or section). */
export function xrefGo(id, fn) {
  GO.set(id, fn);
}

/** One link: the place's name + ›. */
export function xref(to, label) {
  return h(
    "a.xref",
    {
      href: "#",
      on: {
        click: (e) => {
          e.preventDefault();
          GO.get(to)?.();
        },
      },
    },
    label,
    h("span", { "aria-hidden": "true", text: " ›" }),
  );
}

/** A reason / note line's content: its text, then the link to where it's fixed when the data names one (and link). */
export function withXref(text, link = true) {
  const x = link && REASON_XREF.get(text);
  return x ? [text, " ", xref(x.to, x.label)] : [text];
}

/** Does this text carry a link? */
export const hasXref = (text) => REASON_XREF.has(text);
