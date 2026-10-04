// Bauer's crossfeed compensation in the Crossfeed drawer (v1 xfeed/Comp.js): eight mid/side matrix rows at the head of
// the pipelines that bring centered sound back to neutral, built from a symmetric stereo pair. The drawer shows it as
// one percent, 0 to 150, on the scale v1 prints beside it: 0% off, 100% neutral. Committing a percent builds the
// block at that percent (or rebuilds it against the Bauer corner now staged); committing 0% takes it back out to its
// plain pair. Everything stages.

import { signal } from "@preact/signals";
import { centerTiltDb, fitComp, msCompile } from "../../../../vendor/eqlab/core/xfeed.js";
import { effectivePipelines } from "../../../resolve.js";
import { edit, stagePipelines } from "../../../actions.js";
import { bauerSettings, removeBlock, xfeedBlock } from "../../../xfeed/block.js";

/** @typedef {import("../../../../vendor/eqlab/core/matrixspec.js").PipelineRow} PipelineRow */

/**
 * What the compensation control shows: the percent in force (an in-flight drag first), whether a block is installed
 * or a pair is there to build one from, the Bauer corner it is fitted against and how much that corner dulls the
 * center (dB).
 *
 * @typedef {{ pct: number, ready: boolean, fc: number, feed: number, tilt: number }} CompView
 */

/** The percent under an in-flight slider drag, or null. */
const drag = signal(/** @type {number | null} */ (null));

/**
 * A straight, symmetric stereo pair at rows 0 and 1 with dB gains (v1 Comp.js pairInfo): the EQ chain and preamp a
 * block is built from, or null.
 *
 * @param {PipelineRow[]} rows
 * @returns {{ eq: string, preampDb: number } | null}
 */
function pairOf(rows) {
  const [a, b] = rows;
  if (!a || !b) return null;
  return straightPair(a, b) && symmetricPair(a, b) ? { eq: a.process, preampDb: Number(a.gain) } : null;
}

/**
 * In 1 to Out 1 and In 2 to Out 2, in either row order.
 *
 * @param {PipelineRow} a
 * @param {PipelineRow} b
 */
function straightPair(a, b) {
  const through = (/** @type {PipelineRow} */ x, /** @type {string} */ ch) => x.source === ch && x.mixdown === ch;
  return (through(a, "0") && through(b, "1")) || (through(a, "1") && through(b, "0"));
}

/**
 * One EQ chain and one dB gain on both rows.
 *
 * @param {PipelineRow} a
 * @param {PipelineRow} b
 */
function symmetricPair(a, b) {
  return a.gainunit === "dB" && b.gainunit === "dB" && a.process === b.process && a.gain === b.gain;
}

/**
 * The compensation percent the rows carry: the installed block's, else 0.
 *
 * @param {PipelineRow[]} rows
 * @returns {number}
 */
export function compPct(rows) {
  const { rec } = xfeedBlock(rows);
  return rec ? Math.round(rec.sFraction * 100) : 0;
}

/**
 * The compensation control's view over the staged store.
 *
 * @returns {CompView}
 */
export function compView() {
  const rows = effectivePipelines.value;
  const { bs, rec } = xfeedBlock(rows);
  return {
    pct: drag.value ?? compPct(rows),
    ready: !!rec || !!pairOf(rows),
    fc: bs.fc,
    feed: bs.feed,
    tilt: centerTiltDb(bs.fc, bs.feed),
  };
}

/**
 * Follow a slider drag without staging.
 *
 * @param {number} pct
 */
export function dragComp(pct) {
  drag.value = pct;
}

/**
 * Commit a percent: build or rebuild the block at it, or take the block out at 0%. Rows it cannot build from stage
 * nothing.
 *
 * @param {number} pct
 */
export function commitComp(pct) {
  drag.value = null;
  const rows = effectivePipelines.value;
  const { rec } = xfeedBlock(rows);
  const p = Math.max(0, Math.min(150, Math.round(pct)));
  if (p === 0) {
    if (rec) removeBlock(rows, rec);
    return;
  }
  const from = rec ? { eq: rec.eqProcess, preampDb: rec.preampDb } : pairOf(rows);
  if (!from) return;
  const { fc, feed } = bauerSettings();
  const next = [
    ...msCompile(from.eq, from.preampDb, { fit: fitComp(fc, feed), s: p / 100 }, { a: 0, b: 1 }),
    ...rows.slice(rec ? 8 : 2),
  ];
  stagePipelines(next);
  edit("pipelines", String(next.length));
}
