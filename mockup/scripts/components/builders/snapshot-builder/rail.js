import { h } from "../../../lib/shell/dom.js";
import { NEW } from "../../../../../hqptuner/static/model/builders/builder.js";
import { classNames } from "../../../../../hqptuner/static/model/shell/format.js";
import { pageButtons } from "../../../lib/controls/pager.js";
import { railPer, revealPage, railFolds, litEntry } from "../../../../../hqptuner/static/model/builders/snapshot.js";
import { edit, dirtyOf } from "./edit.js";

/** @typedef {import('../snapshot-builder.js').Snap} Snap */
/** @typedef {import('../../../../../hqptuner/static/model/builders/builder.js').Ref} Ref */
/** @typedef {import('../../../../../hqptuner/static/model/builders/snapshot.js').Edit} Edit */

// ── Rail ────────────────────────────────────────────────────────────────
/**
 * Rail at the most lines that fit: the open station's page shrinks until nothing runs past the rail (no scroll).
 *
 * @param {Snap} S
 */
export function paintRail(S) {
  // Measured on the fullest page (the first), so every page holds the same number of lines.
  const per = railPer((n) => {
    paintRailAt(S, n, true);
    return { client: S.rail.clientHeight, scroll: S.rail.scrollHeight };
  });
  // After a save (or a station opened on its snapshot), its page is the one shown.
  const { cur } = S.B;
  if (S.reveal) {
    const pg = revealPage(S.B.book, cur, per);
    if (pg !== null) S.pageOf.set(cur.st, pg);
  }
  S.reveal = false;
  paintRailAt(S, per);
}
/**
 * The rail with `per` lines to the open station's page: each station a fold, then New snapshot.
 *
 * @param {Snap} S
 * @param {number} per
 * @param {boolean} [first]  a measuring pass: the open station's first page
 */
function paintRailAt(S, per, first) {
  const { B, home } = S;
  const e = edit(S);
  const nw = { st: home, name: NEW };
  const folds = railFolds({
    stations: S.stations.map((st) => st.name),
    book: B.book,
    open: S.openSt,
    home,
    staged: [...B.staged.keys()],
    per,
    pages: S.pageOf,
    first,
  });
  S.rail.replaceChildren(
    // Each station a fold, one open at a time; its snapshots under it. The loaded station's name amber.
    ...folds.flatMap((f) => [
      h(
        "button.brh",
        {
          type: "button",
          class: classNames(f.loaded && "cur", f.dirty && "dirty"),
          aria: { expanded: f.open },
          on: {
            click: () => {
              S.openSt = f.open ? null : f.name;
              paintRail(S);
            },
          },
        },
        h("span.chv", { text: f.open ? "▾" : "▸" }),
        h("span.sn", { text: f.name }),
        h("span.ln"),
        h("span.cnt", { text: String(f.count) }),
      ),
      ...f.items.map((name) => railEntry(S, e, { st: f.name, name })),
      // A short last page keeps its full height (the pipelines list's fixed page), so nothing under it moves.
      ...Array.from({ length: f.fill }, () => h("div.bfill")),
      ...(f.open ? railPager(S, f.name, f.count, per) : []),
    ]),
    h(
      "button.st.bst.bnew",
      {
        type: "button",
        class: classNames(litEntry(nw, B.cur, e) && "open", dirtyOf(S, nw) && "dirty"),
        on: { click: () => B.go(nw) },
      },
      h("span.n", {}, h("span.plus", { text: "+" }), "New snapshot"),
    ),
  );
}
/**
 * One snapshot's line, lit with the edit (the same-named one in every other ticked station too: Save writes there).
 *
 * @param {Snap} S
 * @param {Edit} e
 * @param {Ref} c
 * @returns {HTMLElement}
 */
function railEntry(S, e, c) {
  const lit = litEntry(c, S.B.cur, e);
  return h(
    "button.st.bst",
    {
      type: "button",
      class: classNames(lit && "open", dirtyOf(S, c) && "dirty"),
      aria: { current: lit },
      title: c.name,
      on: { click: () => S.B.go(c) },
    },
    h("span.n", { text: c.name }),
  );
}
/**
 * The open station's page buttons, none while its list fits one page.
 *
 * @param {Snap} S
 * @param {string} st
 * @param {number} n  the snapshots it holds
 * @param {number} per
 * @returns {HTMLElement[]}
 */
function railPager(S, st, n, per) {
  const kids = pageButtons({
    n,
    per,
    page: S.pageOf.get(st) ?? 0,
    go: (k) => {
      S.pageOf.set(st, k);
      paintRail(S);
    },
  });
  return kids.length ? [h("div.opg.bpg", {}, kids)] : [];
}
