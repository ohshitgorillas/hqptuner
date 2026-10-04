// The shell's walk (Profile, Station): the rail, the step pages and the overview, and the page title with its × that
// every page wears.

import { h } from "../shell/dom.js";
import { closeBtn } from "../controls/controls.js";
import { OVERVIEW, shownName, nextStep, prevStep } from "../../model/builders/builder.js";

/** @typedef {import('./record.js').Shell} Shell */
/** @typedef {(text: string, n?: any, mid?: any[]) => HTMLElement} Title */

/**
 * The × that leaves the builder.
 *
 * @param {{ closeLabel: string }} spec
 * @param {(on: boolean) => void} setOn
 */
export function closeButton(spec, setOn) {
  const x = closeBtn(() => setOn(false), spec.closeLabel);
  x.classList.add("pbx");
  return x;
}

/**
 * A page title in the section header grammar (engraved + rule), × at its end.
 *
 * @param {() => HTMLElement} close
 * @param {string} text
 * @param {any} n
 * @param {any[]} mid
 */
export const pageTitle = (close, text, n, mid) =>
  h("div.sh.btitle", {}, h("span.t", { text }), n, h("span.ln"), mid, close());

/**
 * The walk's step order: the step ids, and the step after or before one (skipping those that don't apply).
 *
 * @param {any} walk
 */
export function walkNav(walk) {
  const ids = walk ? walk.steps.map((/** @type {{ id: string }} */ x) => x.id) : [];
  const skipped = (/** @type {string} */ id) => !!walk?.skipOf(id);
  return {
    nextOf: (/** @type {number} */ i) => nextStep(ids, i, skipped),
    prevOf: (/** @type {number} */ i) => prevStep(ids, i, skipped),
  };
}

/**
 * @param {any} walk
 * @param {string} id
 * @param {string} name
 */
const entry = (walk, id, name) =>
  h(
    "button.st",
    { type: "button", data: { stage: id }, on: { click: () => walk?.show(id) } },
    h("span.n", { text: name }),
    h("span.v"),
  );

/**
 * The rail's entries (Overview, then one per step), put on the rail.
 *
 * @param {any} walk
 * @returns {Map<string, HTMLElement>}
 */
export function railOf(walk) {
  const railEls = new Map(
    walk
      ? [
          [OVERVIEW, entry(walk, OVERVIEW, walk.copy.overview)],
          ...walk.steps.map(
            (/** @type {{ id: string, title: string }} */ x) =>
              /** @type {[string, HTMLElement]} */ ([x.id, entry(walk, x.id, x.title)]),
          ),
        ]
      : [],
  );
  walk?.rail.replaceChildren(...railEls.values());
  return railEls;
}

/**
 * The rail: the page showing lit (Overview for a page off the walk), each step's answer, `Skipped` where it doesn't apply.
 *
 * @param {any} walk
 * @param {any} spec
 * @param {Shell} sh
 * @param {Map<string, HTMLElement>} railEls
 */
export function paintRail(walk, spec, sh, railEls) {
  if (!walk) return;
  const at = walk.at();
  for (const [id, el] of railEls) {
    el.classList.toggle("open", id === at || (id === OVERVIEW && !railEls.has(at)));
    el.setAttribute("aria-current", String(id === at));
    /** @type {HTMLElement} */ (el.querySelector(".v")).textContent =
      id === OVERVIEW ? shownName(spec.name(), sh.cur) || walk.newLabel : walk.answer(id);
    el.classList.toggle("skip", id !== OVERVIEW && !!walk.skipOf(id));
  }
}

/**
 * A step's page: header (title, step n of t, ×), guide or skip line, rows, Back / Next.
 *
 * @param {any} walk
 * @param {{ title: Title, nextOf: (i: number) => string, prevOf: (i: number) => string }} nav
 * @param {string} id
 * @param {{ tag?: string, attrs?: object, guide: (skip: string, st: any) => any, rows: (id: string) => any }} o
 */
export function stepPage(walk, { title, nextOf, prevOf }, id, { tag = "div.pbstepp", attrs = {}, guide, rows }) {
  if (!walk) return null;
  const i = walk.steps.findIndex((/** @type {{ id: string }} */ x) => x.id === id);
  const st = walk.steps[i];
  const skip = walk.skipOf(id);
  const last = nextOf(i) === OVERVIEW;
  return h(
    tag,
    attrs,
    title(st.title, h("span.pbn", { text: walk.copy.stepOf(i + 1, walk.steps.length) })),
    guide(skip, st),
    h("div.pbsrows", {}, skip ? [] : rows(id)),
    h(
      "div.pbnav",
      {},
      h("span.grow"),
      h("button.btn.sm", { type: "button", text: walk.copy.back, on: { click: () => walk.show(prevOf(i)) } }),
      h("button.btn.sm.pbnext", {
        type: "button",
        text: last ? walk.copy.review : walk.copy.next,
        on: { click: () => walk.show(nextOf(i)) },
      }),
    ),
  );
}

/**
 * The overview: intro and holds beside the signal chain, then which record (picker · Name · extras), its extras, the
 * confirm line, the state line and the ways on.
 *
 * @param {any} walk
 * @param {{ title: string, noun: string }} spec
 * @param {{ title: Title, pick: HTMLElement, nameBox: any, stateLine: HTMLElement, cap: HTMLElement }} parts
 * @param {{ tags?: { ov?: string, save?: string, id?: string }, intro: any, holds: any[], chain: any, ids?: any[],
 *   mid?: any[], ask: any, acts: { del: any, discard: any, save: any }, after?: any }} o
 */
export function overview(
  walk,
  spec,
  { title, pick, nameBox, stateLine, cap },
  { tags = {}, intro, holds, chain: pic, ids: more = [], mid = [], ask: askEl, acts: a, after },
) {
  if (!walk) return null;
  return h(
    tags.ov ?? "div.pbov",
    {},
    title(spec.title),
    h(
      "div.pbovtop",
      {},
      h("div.pbovl", {}, intro, h("div.pbholds", {}, h("div.pbhh", { text: walk.copy.holds }), holds)),
      pic,
    ),
    h(
      tags.save ?? "div.pbsavebox",
      {},
      h(
        tags.id ?? "div.pbid",
        {},
        h("label.vfd.pbpick", {}, h("span.l", { text: spec.noun }), pick),
        h("label.vfd.bname.pbname", {}, h("span.l", { text: "Name" }), nameBox),
        more,
      ),
      mid,
      askEl,
      h(
        "div.pbfoot",
        {},
        h("div.pbstw", {}, stateLine, cap),
        h("span.grow"),
        h("button.btn.sm", { type: "button", text: walk.copy.scratch, on: { click: () => walk.scratch() } }),
        h("button.btn.sm", {
          type: "button",
          text: walk.copy.change,
          on: { click: () => walk.show(walk.steps[0].id) },
        }),
        a.del,
        a.discard,
        a.save,
      ),
    ),
    after,
  );
}
