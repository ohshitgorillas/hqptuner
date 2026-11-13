// Reading a rendered region the way a reader sees it around a `see more` trigger.
//
// A trigger is found by its `data-testid` (`see-more`), the popover it opens by its `role` (`dialog`). What a reader
// has in sight is the region less its popovers, with each trigger read as one token, `TRIGGER`, so a suite can ask
// which words a trigger follows without naming the trigger's own wording. Words are runs of letters, digits and
// hyphens; markup, entities and punctuation separate them and carry none.

import { attr, elements, text } from "./markup.js";

/** @typedef {import("./markup.js").MarkupElement} MarkupElement */

/** The token a trigger in sight reads as. */
export const TRIGGER = "SEEMORETRIGGER";

/** @param {MarkupElement} e */
const isTrigger = (e) => attr(e, "data-testid") === "see-more";

/** @param {MarkupElement} e */
const isPopover = (e) => attr(e, "role") === "dialog";

/**
 * Whether `inner` lies inside `outer`.
 *
 * @param {MarkupElement} inner
 * @param {MarkupElement} outer
 */
const within = (inner, outer) =>
  inner !== outer && inner.start >= outer.start && inner.start < outer.start + outer.html.length;

/**
 * The elements of `els` that lie inside none of the others.
 *
 * @param {MarkupElement[]} els
 * @returns {MarkupElement[]}
 */
const outermost = (els) => els.filter((e) => !els.some((o) => within(e, o)));

/**
 * The popovers and the triggers in sight, each lying inside none of the others.
 *
 * @param {string} html
 * @returns {MarkupElement[]}
 */
function regions(html) {
  const all = elements(html);
  const popovers = all.filter(isPopover);
  const triggers = all.filter((e) => isTrigger(e) && !popovers.some((p) => within(e, p)));
  return outermost([...popovers, ...triggers]).sort((a, b) => a.start - b.start);
}

/**
 * The words a reader has in sight in `html`, in order, each trigger in sight read as `TRIGGER`.
 *
 * @param {string} html
 * @returns {string[]}
 */
function wordsInSight(html) {
  let out = "";
  let at = 0;
  for (const r of regions(html)) {
    out += `${html.slice(at, r.start)} ${isTrigger(r) ? TRIGGER : ""} `;
    at = r.start + r.html.length;
  }
  out += html.slice(at);
  return (
    out
      .replace(/<[^<>]*>/g, " ")
      .replace(/&#?\w+;/g, " ")
      .match(/[\p{L}\p{N}-]+/gu) ?? []
  );
}

/**
 * The words of `s`, split the way `wordsInSight` splits them.
 *
 * @param {string} s
 * @returns {string[]}
 */
export const wordsOf = (s) => s.match(/[\p{L}\p{N}-]+/gu) ?? [];

/**
 * The words in sight after the last run of `lead`'s words, or null when that run is not in sight.
 *
 * @param {string} html
 * @param {string} lead
 * @returns {string[] | null}
 */
export function wordsAfter(html, lead) {
  const seen = wordsInSight(html);
  const run = wordsOf(lead);
  for (let i = seen.length - run.length; i >= 0; i -= 1)
    if (run.every((w, j) => seen[i + j] === w)) return seen.slice(i + run.length);
  return null;
}

/**
 * How many triggers `html` shows in sight.
 *
 * @param {string} html
 */
export const triggersInSight = (html) => regions(html).filter(isTrigger).length;

/**
 * The text of each popover in `html`, read from its paragraphs.
 *
 * @param {string} html
 * @returns {string[]}
 */
export const popoverTexts = (html) =>
  regions(html)
    .filter(isPopover)
    .map((pop) =>
      elements(pop.html)
        .filter((e) => e.name === "p")
        .map(text)
        .join(" "),
    );
