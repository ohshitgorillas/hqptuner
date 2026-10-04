// DSP pipelines drawer: tabs. Overview = the routing alone; then one tab per output channel in use.
//
// Overview  the pin grid on the whole panel: inputs (source channels) down the side, outputs (mix channels) across the
//           top, one pin per crosspoint, so a column is one output bus. Pin: glass well = no pipeline; amber jewel =
//           routed, its gain engraved (or `×n` when it holds several); `ø` = a negative Lin gain; dashed edge + the block's
//           name = a crossfeed block; a fill along its foot = its share of all pipelines. Tap a lit pin → that output's
//           tab, on that input; tap an empty one → a new pipeline there (0 dB, empty chain), same tab. Beside the grid:
//           the totals, `Import EQ…` (onto the stereo pair) and `Upload convolution filters`, and the
//           manual's Pipelines and convolution paragraphs.
// Out x     everything feeding that speaker, one input at a time: an input switch (`L · 48 | R · 12`, `+` adds an input
//           not yet feeding it), `+ Pipeline`, then that input's pipelines as a fixed page of 6 lines (`#n`, chain as compact text,
//           gain) with numbered page buttons; a crossfeed block folds to one line. Under the list, the selected pipeline
//           only, as one chip strip (`+` stage, gain last, `Raw`, `×`); under that, its stage editor (the dock) beside
//           the plot (`#n` · `L → L` the crosspoint summed · `Out L` one trace per input). PEQ bands drag on the plot.
// Channels named while the daemon names them (slots 1–8, readme §1.9), numbers beyond. Up to 8 a side. Every edit stages profile-wide (matrix family, dirty dot on the tab it was made in); the
// crossfeed blocks follow the Crossfeed drawer's staged values; everything grays while the matrix engine is bypassed.
//
// The tabs live under pipelines/: state.js (shared state, crossfeed blocks), popovers.js, overview.js, output.js,
// strip.js, dock.js (its editors in editors.js), plot.js; their decisions in model/pipelines.js.

import { createState, importEq, paint, rebuild, want } from "./pipelines/state.js";
import { mountPopovers } from "./pipelines/popovers.js";
import { overview } from "./pipelines/overview.js";
import { output } from "./pipelines/output.js";

/** @typedef {import('../../model/shell/pipelines.js').Pipe} Pipe */
/** @typedef {import('./pipelines/state.js').Config} Config */
/** @typedef {import('./pipelines/state.js').Deps} Deps */
/** @typedef {import('./pipelines/state.js').Ctx} Ctx */
/** @typedef {import('./pipelines/state.js').Values} Values */
/** @typedef {Parameters<typeof importEq>[1]} Eq */
/** @typedef {(host: HTMLElement, ctx: Ctx) => void} Mount  a drawer block: mount into `host`, stage through `ctx` */

/**
 * The drawer's face to its callers.
 *
 * @typedef {object} Pipelines
 * @property {Mount} overview
 * @property {(o: number) => Mount} output
 * @property {() => number} count
 * @property {() => [Pipe | null | undefined, Pipe | null | undefined]} ears
 * @property {(eq: Eq, mirror: boolean) => void} importEq
 * @property {() => Pipe[]} list
 * @property {number} rate
 * @property {number} outputs
 * @property {(v: Values) => void} sync
 */

/**
 * The DSP pipelines drawer over pipeline set `cfg`: its Overview and output tabs as drawer blocks, and what the chain
 * and the Profile builder read and land on it.
 *
 * @param {Config} cfg  PIPELINES (data/stages/pipelines.js)
 * @param {Deps} deps
 * @returns {Pipelines}
 */
export function createPipelines(cfg, { bypassed, plate, openCrossfeed, goTab }) {
  const dr = createState(cfg, { bypassed, plate, openCrossfeed, goTab });
  mountPopovers(dr);
  return {
    overview: (host, ctx) => overview(dr, host, ctx),
    output: (o) => (host, ctx) => output(dr, o, host, ctx),
    count: () => dr.pipes.length,
    /** The stereo pair's pipelines (In L→Out L, In R→Out R): where a headphone / room correction lands. */
    ears: () => [dr.ear[0], dr.ear[1]],
    /**
     * Land an EQ on the stereo pair from outside (Profile builder): its peak / shelf stages replace the pair's, its preamp
     * becomes the pipeline gain (Import EQ's path); `mirror` false = the first ear only. conv = a convolution file instead.
     */
    importEq: (eq, mirror) => importEq(dr, eq, mirror),
    /** The pipeline set as it stands (crossfeed block rows included): the Profile builder's response plot. */
    list: () => dr.pipes,
    rate: dr.fs,
    outputs: dr.nOut,
    /** Apply (mock): catch up with Crossfeed's values even if this drawer wasn't opened since they changed. */
    sync: (v) => {
      rebuild(dr, want(v));
      paint(dr);
    },
  };
}
