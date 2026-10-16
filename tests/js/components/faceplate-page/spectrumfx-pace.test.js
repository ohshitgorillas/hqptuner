// Suite for the pace of the page spectrum's effects painter, every style it draws taken together: a style steps on the
// wall time the meter loop hands each paint, so a run painted at one rate leaves the canvas showing what a run painted
// at another rate over the same time shows, and a paint told no time does not step as if told one loop step.
//
// The styles are the options the Display popover renders, read by their values in `data-v`, that the spectrum style
// setter takes, kept where a steady run leaves ink on the effects canvas; a style drawn somewhere else, or one the page
// comes to offer, is decided at run time and never named here.
//
// Each run paints through fxPainter on a canvas that keeps pixels (tests/js/support/raster.js), and reads what the
// canvas shows as one ink value per pixel every tenth of a second, a moment at which every run paints. The spectrum is
// loud for a first stretch and quiet after it, the same over time in every run, so caps hold and fall, rows stack,
// halos dim and flames settle over the run. Run times are counted in whole sixtieths of a second, so two runs reach a
// moment exactly. A canvas a painter builds itself, through `OffscreenCanvas` or `document.createElement`, keeps
// pixels too. `Math.random` hands back one fixed value during the paints, so a style drawn at random draws the same at
// any paint count.
//
// Two canvases show the same thing when no more of their pixels differ by more than the halo's rounding, half an alpha
// step a paint behind either, than make up two rows of the canvas, the most a float landing either side of a pixel's
// center moves a cap's top and foot.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/spectrumfx-pace.test.js

import "../../support/domseam.js";
import test from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Faceplate } from "../../../../hqptuner/static/app.js";
import { fxPainter } from "../../../../hqptuner/static/components/faceplate/page/spectrumfx.js";
import { body, openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { setSpectrumStyle, spectrumStyle } from "../../../../hqptuner/static/store/ui/prefs.js";
import { rasterCanvas } from "../../support/raster.js";
import { useStorage } from "../../support/storage.js";
import { renderTree } from "../../support/vnodeseam.js";

/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */
/** @typedef {ReturnType<typeof rasterCanvas>} RasterCanvas */
/** @typedef {{ disp: Float32Array, ghost: Float32Array }} SpectrumHold */
/** @typedef {[number, number][]} Run  [ticks since the last paint, dBFS] per paint */
/** @typedef {{ tick: number, paints: number, ink: Float32Array }} Seen */

//: The Display popover's id, which its panel carries as `data-pop`.
const DISPLAY = "display";
//: The canvas, in device pixels: small, so each paint rasterizes cheaply.
const W = 48;
const H = 100;
//: The meter loop's column count.
const COLS = 600;
//: A 60 dB plot.
const RANGE = 60;
//: Three quarters of the way up a 60 dB plot, and a quarter of the way up.
const LOUD_DB = -15;
const QUIET_DB = -45;
//: The time unit the runs are counted in, s: whole ticks keep every run's elapsed time exact.
const TICK_S = 1 / 60;
//: Paint intervals, ticks: one meter loop step as the loop hands it, a step and a half, and three steps.
const STEP = 2;
const SLOW = 3;
const LATE = 6;
//: How often both runs paint at one moment and are read there, ticks.
const CHECK_EVERY = 6;
//: The loud stretch, then a quiet one past the caps' half-second hold, ticks.
const LOUD_TICKS = 6;
const QUIET_TICKS = 54;
//: What `Math.random` hands back during the paints.
const RANDOM = 0.5;
//: The colors a painter is built with: five CSS colors.
const COLORS = { lo: "#2a8", mid: "#cc4", hi: "#d43", meter: "#999", glass: "#fff" };
//: The most alpha a pixel holds.
const OPAQUE = 255;

/**
 * Paints `every` ticks apart making up `ticks`, every column at `db`.
 *
 * @param {number} ticks
 * @param {number} every
 * @param {number} db
 * @returns {Run}
 */
const paints = (ticks, every, db) => new Array(ticks / every).fill([every, db]);

//: Steady paints, one a loop step, over the loud and the quiet stretch.
const STEADY = [...paints(LOUD_TICKS, STEP, LOUD_DB), ...paints(QUIET_TICKS, STEP, QUIET_DB)];
//: The same stretches at another rate, which changes part way through the quiet one: the loud stretch one late paint,
//: then the quiet stretch as paints a step and a half apart, then three steps apart, then a step and a half again.
const UNEVEN = [
  ...paints(LOUD_TICKS, LATE, LOUD_DB),
  ...paints(18, SLOW, QUIET_DB),
  ...paints(18, LATE, QUIET_DB),
  ...paints(18, SLOW, QUIET_DB),
];

/**
 * The global the canvas constructors are installed on, viewed as optional members: plain node has neither.
 *
 * @type {{ OffscreenCanvas?: unknown, document?: { createElement?: (tag: string) => unknown } }}
 */
const env = globalThis;

// A canvas a painter builds for itself, off the page or as an element, keeps pixels too; HTML's default canvas is 300
// by 150.
env.OffscreenCanvas = function OffscreenCanvas(/** @type {number} */ w, /** @type {number} */ h) {
  return rasterCanvas(w, h);
};
if (env.document) {
  env.document.createElement = (tag) => {
    if (tag !== "canvas") throw new Error(`no ${tag} element in this suite`);
    return rasterCanvas(300, 150);
  };
}

/**
 * A spectrum hold with every column at `db`.
 *
 * @param {number} db
 * @returns {SpectrumHold}
 */
function hold(db) {
  const disp = new Float32Array(COLS).fill(db);
  return { disp, ghost: disp };
}

/**
 * Run `act` with `Math.random` handing back RANDOM, and put `Math.random` back after.
 *
 * @param {() => void} act
 */
function withFixedRandom(act) {
  const own = Math.random;
  Math.random = () => RANDOM;
  try {
    act();
  } finally {
    Math.random = own;
  }
}

/**
 * What the effects canvas shows during `run` under `style`, one ink value per pixel, read after every paint that ends a
 * CHECK_EVERY stretch; each paint is told the seconds since the last one, or, with `told` false, no time at all. Null
 * where a paint told no time throws.
 *
 * @param {string} style
 * @param {Run} run
 * @param {boolean} [told]
 * @returns {Seen[] | null}
 */
function shown(style, run, told = true) {
  const canvas = rasterCanvas(W, H);
  const fx = fxPainter(/** @type {HTMLCanvasElement} */ (/** @type {unknown} */ (canvas)), COLORS);
  /** The painter as a caller that forgot `dt` sees it: paint takes three arguments. */
  const untold = /** @type {{ paint: (...args: any[]) => void }} */ (/** @type {unknown} */ (fx));
  /** @type {Seen[]} */
  const seen = [];
  let tick = 0;
  try {
    withFixedRandom(() => {
      run.forEach(([ticks, db], i) => {
        if (told) fx.paint(hold(db), RANGE, style, { dt: ticks * TICK_S });
        else untold.paint(hold(db), RANGE, style);
        tick += ticks;
        if (tick % CHECK_EVERY === 0) seen.push({ tick, paints: i + 1, ink: canvas.ink.slice() });
      });
    });
  } catch (err) {
    if (told || String(err).includes("raster canvas")) throw err;
    return null;
  }
  return seen;
}

/**
 * Whether two canvases show the same thing: no more pixels differ by more than half an alpha step a paint behind them
 * than make up two rows.
 *
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @param {number} paintsBehind  paints of both runs together
 */
function alike(a, b, paintsBehind) {
  const rounding = paintsBehind / 2 / OPAQUE;
  let differing = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > rounding) differing += 1;
  return differing <= 2 * W;
}

/**
 * The ticks at which two runs' canvases do not show the same thing; a run a paint threw on shows the same as nothing
 * at every moment.
 *
 * @param {Seen[] | null} a
 * @param {Seen[] | null} b
 * @returns {number[]}
 */
function unlike(a, b) {
  if (!a || !b) return a === b ? [] : [0];
  const at = new Map(b.map((s) => [s.tick, s]));
  return a
    .filter((s) => {
      const other = at.get(s.tick);
      return !other || !alike(s.ink, other.ink, s.paints + other.paints);
    })
    .map((s) => s.tick);
}

/**
 * The spectrum styles the page offers that the effects painter draws: the option values the Display popover renders
 * that the style setter takes, kept where a steady run leaves ink on the canvas.
 *
 * @returns {string[]}
 */
function drawnStyles() {
  useStorage();
  body.value = "chain";
  openStage.value = null;
  openPopover.value = DISPLAY;
  const { seen } = renderTree(html`<${Faceplate} />`);
  const values = seen
    .filter((/** @type {VNode} */ n) => n.type === "button" && typeof n.props?.["data-v"] === "string")
    .map((/** @type {VNode} */ n) => String(n.props["data-v"]));
  const styles = [...new Set(values)].filter((v) => {
    setSpectrumStyle(v);
    return spectrumStyle.value === v;
  });
  const drawn = styles.filter((s) => shown(s, STEADY)?.some((frame) => frame.ink.some((v) => v > 0)));
  if (!drawn.length) throw new Error("the effects painter drew no style the Display popover offers");
  return drawn;
}

for (const style of drawnStyles()) {
  test(`test_${style}_painted_at_another_rate_shows_what_steady_paints_show_at_every_moment_both_paint`, () => {
    assert.deepEqual(unlike(shown(style, UNEVEN), shown(style, STEADY)), []);
  });

  test(`test_${style}_painted_with_no_time_told_does_not_step_as_if_told_one_loop_step`, () => {
    assert.notDeepEqual(unlike(shown(style, STEADY, false), shown(style, STEADY)), []);
  });
}
