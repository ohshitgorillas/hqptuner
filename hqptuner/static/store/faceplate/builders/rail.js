// The Snapshot builder's rail: the lines a page holds at a height, from the sheet's own heights, and every station's
// fold over the snapshot book.

import { railPer, railFolds } from "../../../model/builders/snapshot.js";
import { stations, snapshotBook, home } from "./snapshot.js";
import { staged } from "./shell.js";

/** @typedef {import('../../../model/builders/snapshot.js').Fold} Fold */

/** The rail's heights in px (css/v2/builder.css): its top padding, the gap between items, and each item. */
const PAD_PX = 8;
const GAP_PX = 2;
const HEADER_PX = 30;
const LINE_PX = 24;
const FILL_PX = 24;
const PAGER_PX = 34;
const NEW_PX = 42;

/**
 * The rail's content height with `folds` painted at `per`: every fold's header, the open one's lines, blank lines and
 * pager, then New snapshot.
 *
 * @param {Fold[]} folds
 * @param {number} per
 * @returns {number}
 */
function scrollAt(folds, per) {
  const items = folds.flatMap((f) => [
    HEADER_PX,
    ...f.items.map(() => LINE_PX),
    ...Array.from({ length: f.fill }, () => FILL_PX),
    ...(f.open && f.count > per ? [PAGER_PX] : []),
  ]);
  items.push(NEW_PX);
  return PAD_PX + items.reduce((a, b) => a + b, 0) + GAP_PX * (items.length - 1);
}

/**
 * The rail at `height`: the lines a page holds, and every station's fold.
 *
 * @param {number} height
 * @param {{ open: string | null, pages: Map<string, number> }} rail
 * @returns {{ per: number, folds: Fold[] }}
 */
export function railView(height, rail) {
  const names = stations();
  const book = snapshotBook();
  const full = Object.fromEntries(names.map((n) => [n, book[n] ?? {}]));
  const keys = [...staged.value.keys()];
  const at = (/** @type {number} */ per, /** @type {boolean} */ first) =>
    railFolds({
      stations: names,
      book: full,
      open: rail.open,
      home: home(),
      staged: keys,
      per,
      pages: rail.pages,
      first,
    });
  const per = railPer((n) => ({ client: height, scroll: scrollAt(at(n, true), n) }));
  return { per, folds: at(per, false) };
}
