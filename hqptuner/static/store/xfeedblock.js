// The crossfeed-compensation block as STATE: what Bauer is currently set to,
// whether a compensation block is installed against those settings, and the
// staging that takes one back out.
//
// Split out of components/XfeedComp.js, which still owns the strip, the badge
// and the lens traces. None of the three functions here renders anything — they
// read the resolved config and stage rows — and leaving them in a component
// meant store/xfmode.js had to reach up into components/ to ask whether a block
// was installed. That was the last upward edge in the frontend import graph.
//
// Bauer preset internals are not surfaced by the daemon (probe finding), so
// preset -> (fc, feed) comes from the vendored bs2b constants in lib/xfeed.js.
import { effective } from "./resolve.js";
import { stagePipelines, edit } from "./actions.js";
import { BAUER_PRESETS, msRecognize } from "../lib/xfeed.js";
import { truthy } from "../lib/coerce.js";

/**
 * @typedef {import("../lib/matrixspec.js").PipelineRow} PipelineRow
 * @typedef {import("../lib/xfeed.js").MsRecognition} MsRecognition
 * @typedef {{ enabled: boolean, fc: number, feed: number }} BauerSettings
 *   The running Bauer crossfeed the correction is fitted against: its on/off
 *   flag and the (corner, feed) pair the preset or the two knobs resolve to.
 */

/**
 * The Bauer crossfeed the running config is set to — enable flag plus the (corner, feed)
 * pair the preset names or the two knobs hold.
 * @returns {BauerSettings}
 */
export function bauerSettings() {
  const preset = String(effective("crossfeed_preset") ?? "default");
  const p = /** @type {Record<string, { fc: number, feed: number }>} */ (BAUER_PRESETS)[preset];
  return {
    enabled: truthy(effective("crossfeed_enabled")),
    fc: p ? p.fc : Number(effective("crossfeed_frequency")) || 700,
    feed: p ? p.feed : Number(effective("crossfeed_level")) || 4.5,
  };
}

/**
 * The current Bauer settings, and the compensation block recognized at rows 0..7 against
 * them — `rec` is null when there is no such block.
 * @param {PipelineRow[]} rows
 * @returns {{ bs: BauerSettings, rec: MsRecognition | null }}
 */
export function xfeedBlock(rows) {
  const bs = bauerSettings();
  return { bs, rec: rows.length >= 8 ? msRecognize(rows, 0, bs.fc, bs.feed) : null };
}

// Public because leaving Bauer takes its rows with it, not just its enable flag:
// the mode segment (store/xfmode.js) and the DSP tab's Speakers switch both call
// this, and a correction left behind would run against a crossfeed that is off.
/**
 * Stage the pipelines with the eight compensation rows replaced by a plain two-channel
 * pair carrying the block's EQ process and preamp gain.
 * @param {PipelineRow[]} rows
 * @param {MsRecognition} rec
 * @returns {void}
 */
export function removeBlock(rows, rec) {
  const g = String(Math.round(rec.preampDb * 100) / 100);
  const pair = [
    { gain: g, gainunit: "dB", mixdown: "0", process: rec.eqProcess, source: "0" },
    { gain: g, gainunit: "dB", mixdown: "1", process: rec.eqProcess, source: "1" },
  ];
  const next = [...pair, ...rows.slice(8)];
  stagePipelines(next);
  edit("pipelines", String(Math.max(2, next.length)));
}
