// Loudness drawer body (under the Loudness Off/On row, which is a plain schema row).
//   Bands  one side at a time behind v1's Bass | Treble switch: Type, Frequency, Steepness / Q, Level left, that side's
//          manual lines right (v1 settings.json, verbatim). Type = engine tokens (lshelf|hshelf / peak / peakq), mono.
//   Range  the bounds on their own axis, −120 … 0 dBFS (the 6.0.4 form's min/max for both bounds): parentheses + strip,
//          the Volume Range bar's glyphs, here as the handles. Green needle = live playback volume (a readout). Each mark
//          is named once, beside its glyph, in the boxes under the bar. Clamp: whole dB, Lower ≤ Upper.
//   Plot   v1's loudness plot: the maximum shelving ("max") against what the live volume applies ("x% applied",
//          the rail's own copy), −3 … +24 dB like v1. Each band is a draggable dot at (frequency, level), v1 REW-style.
// Everything stages through the drawer block context; grays while the matrix engine is bypassed or loudness is Off.

import { h, s } from "../../lib/shell/dom.js";
import { seg, select } from "../controls/seg.js";
import { mountRespPlot } from "../controls/resp-plot.js";
import { loudnessDb } from "../../lib/dsp/xdsp.js";
import { shelfScale } from "../../model/gauges/shelf.js";
import { paintSvg } from "../../lib/plots/gauge.js";
import { grayReason, manPara, numBox } from "../../lib/controls/controls.js";
import { barMarks, bindBar, rangeBox, readout } from "../../lib/plots/range-bar.js";
import { signed } from "../../../../hqptuner/static/model/shell/format.js";
import { percentApplied } from "../../../../hqptuner/static/model/gauges/loudness.js";
import { clampBounds, clampToAxis, pickBound, tickMarks, ticksEvery } from "../../model/gauges/range-axis.js";

const AXIS = { min: -120, max: 0 };
const Y = { bar: 10, barH: 14, tick: 33, label: 54, H: 59 };
const BAR = { axis: AXIS, padX: 14, Y };
const LABELS = new Map([
  [-120, "−120"],
  [-90, "−90"],
  [-60, "−60"],
  [-30, "−30"],
  [0, "0 dBFS"],
]);
const MARKS = tickMarks(ticksEvery(AXIS.min, AXIS.max, 10), LABELS, []);
/**
 * @typedef {import('../../lib/dsp/xdsp.js').LoudnessBand} LoudnessBand
 * @typedef {import('../../model/gauges/range-axis.js').BoundKey} Side
 * @typedef {import('./drawer/state.js').BlockCtx} BlockCtx
 * @typedef {import('./drawer/state.js').Store} Store
 * @typedef {'freq' | 'steep' | 'level'} NumKey
 * @typedef {'type' | NumKey} BandKey
 * @typedef {{ el: HTMLElement, input: HTMLInputElement }} Box
 * @typedef {{ type: HTMLElement } & Record<NumKey, Box>} SideCtl
 */

/**
 * LOUDNESS (data/matrix.js): both bands, the bounds (dBFS), each side's type tokens, the manual copy and the Off reason.
 *
 * @typedef {{ low: LoudnessBand, high: LoudnessBand, rangeLow: number, rangeHigh: number, types: Record<Side, string[]>,
 *   man: Record<Side, Record<BandKey, string>> & { rangeLow: string, rangeHigh: string }, off: string }} LoudnessConfig
 */

/**
 * The body's state `L`: cfg, ctx; p (both bands), rng (the bounds), level (live playback volume), grayed; side (the
 * band on view) and dirtySide; and its parts.
 *
 * @typedef {{ cfg: LoudnessConfig, ctx: BlockCtx, p: Record<Side, LoudnessBand>, rng: Record<Side, number>,
 *   level: number, grayed: boolean, side: Side, dirtySide: Record<Side, boolean>, ctl: Record<Side, SideCtl>,
 *   sideSeg: HTMLElement, rowsHost: HTMLElement, copyHost: HTMLElement, reason: ReturnType<typeof grayReason>,
 *   bands: HTMLElement, svg: SVGSVGElement, boxes: Record<Side, Box>, levelOut: HTMLElement, plotHost: HTMLElement,
 *   rp: ReturnType<typeof mountRespPlot>, bar: { key: string | null } }} Loudness
 */

// One side at a time (v1's own Bass | Treble switch): its four rows left, its four manual lines right. A side holding
// staged edits keeps a dot on its switch button while hidden (v1: staged edits on the hidden side are never invisible).
/** @type {[BandKey, string][]} */
const ROWS = [
  ["type", "Type"],
  ["freq", "Frequency"],
  ["steep", "Steepness / Q"],
  ["level", "Level"],
];
/** @type {Side[]} */
const SIDES = ["low", "high"];
/** @type {BandKey[]} */
const KEYS = ["type", "freq", "steep", "level"];
/** @type {NumKey[]} */
const NUMS = ["freq", "steep", "level"];

/** @param {Side} side  @param {BandKey} k */
const id = (side, k) => `ld${side}${k}`;

// ── Bands ─────────────────────────────────────────────────────────────
/** @param {Loudness} L  @param {Side} sd */
const typeSeg = (L, sd) =>
  seg({
    aria: `${sd === "low" ? "Bass" : "Treble"} type`,
    cls: "enum mini2",
    options: L.cfg.types[sd].map((t) => ({ v: t, label: t })),
    value: L.p[sd].type,
    onChange: (v) => {
      L.p[sd].type = v;
      stage(L, sd, "type", v);
      plot(L);
    },
  });
/**
 * @param {Loudness} L  @param {Side} sd  @param {NumKey} k
 * @param {{ step: number, min: number, max: number, unit?: string }} r
 */
function numIn(L, sd, k, { step, min, max, unit }) {
  const box = numBox({ step, min, max, aria: `${sd === "low" ? "Bass" : "Treble"} ${k}`, unit });
  box.input.addEventListener("change", () => {
    L.p[sd][k] = Number(box.input.value);
    stage(L, sd, k, L.p[sd][k]);
    plot(L);
  });
  return box;
}

/** One side's controls. @param {Loudness} L  @param {Side} sd  @returns {SideCtl} */
const sideCtl = (L, sd) => ({
  type: typeSeg(L, sd),
  freq: numIn(L, sd, "freq", { step: 1, min: 20, max: 20000, unit: "Hz" }),
  steep: numIn(L, sd, "steep", { step: 0.1, min: 0.1, max: 10 }),
  level: numIn(L, sd, "level", { step: 0.1, min: -20, max: 20, unit: "dB" }),
});

/** Both sides' controls, the Bass | Treble switch and the two columns it fills. @param {Loudness} L */
function buildBands(L) {
  L.ctl = { low: sideCtl(L, "low"), high: sideCtl(L, "high") };
  L.sideSeg = seg({
    aria: "Band",
    cls: "lsw view",
    value: L.side,
    options: [
      { v: "low", label: "Bass" },
      { v: "high", label: "Treble" },
    ],
    onChange: (v) => showSide(L, /** @type {Side} */ (v)),
  });
  L.rowsHost = h("div.lrows");
  L.copyHost = h("div.man.lcopy");
  // The gray reason sits at the head of the copy column, beside the switch it explains (no height of its own).
  L.reason = grayReason(false);
  L.bands = h("div.lbands", {}, h("div.lleft", {}, L.sideSeg, L.rowsHost), h("div.lrc", {}, L.reason.el, L.copyHost));
}
/** @param {Loudness} L  @param {Side} v */
function showSide(L, v) {
  L.side = v;
  select(L.sideSeg, v);
  L.rowsHost.replaceChildren(
    ...ROWS.map(([k, label]) =>
      h("div.lrow", {}, h("span.ll", { text: label }), k === "type" ? L.ctl[v].type : L.ctl[v][k].el),
    ),
  );
  L.copyHost.replaceChildren(...ROWS.map(([k, label]) => manPara({ k: label, text: L.cfg.man[v][k] })));
  paintSideDots(L);
}
/** @param {Loudness} L */
function paintSideDots(L) {
  for (const b of L.sideSeg.querySelectorAll("button")) {
    const sd = /** @type {Side} */ (b.dataset.v);
    b.classList.toggle("dirty", L.dirtySide[sd] && sd !== L.side);
  }
}
/** @param {Loudness} L  @param {Side} sd  @param {BandKey} k  @param {string | number} v */
const stage = (L, sd, k, v) => {
  L.dirtySide[sd] = true;
  L.ctx.set(id(sd, k), v);
  paintSideDots(L);
};

// ── Range bar ─────────────────────────────────────────────────────────
/**
 * The bands, then the range bar with its boxes beside the plot's host, appended to `host`.
 *
 * @param {Loudness} L
 * @param {HTMLElement} host
 */
function buildBody(L, host) {
  L.svg = /** @type {SVGSVGElement} */ (s("svg.vrbar.lrbar", { role: "img", "aria-label": "Loudness range" }));
  /**
   * @param {Side} k
   * @param {string} label
   * @param {import('../../lib/plots/range-bar.js').KeyGlyph} glyph
   */
  const box = (k, label, glyph) => rangeBox(label, glyph, { min: AXIS.min, max: AXIS.max }, (v) => move(L, k, v));
  L.boxes = { low: box("low", "Lower", "lparen"), high: box("high", "Upper", "rparen") };
  L.levelOut = h("output.vfd.ro.live", { "aria-label": "Playback volume" });
  L.plotHost = h("div.eq.lplot");
  host.append(
    L.bands,
    h(
      "div.lbot",
      {},
      h(
        "div.lrange",
        {},
        // The needle is named on the head line, beside its glyph; the two bounds in the boxes under the bar.
        h(
          "div.fh.lrh",
          {},
          h("b", { text: "Range" }),
          readout({ glyph: "needle", label: "Playback", out: L.levelOut, unit: "dB", cls: "lpb" }),
        ),
        h("div.vrwell", {}, L.svg),
        // Each bound's box with its own manual line straight under it (copy beside its setting).
        h("div.lbound", {}, L.boxes.low.el, h("p.man", { text: L.cfg.man.rangeLow })),
        h("div.lbound", {}, L.boxes.high.el, h("p.man", { text: L.cfg.man.rangeHigh })),
      ),
      L.plotHost,
    ),
  );
}

/**
 * @param {Loudness} L
 * @param {Side} k
 * @param {number} d  dBFS
 */
function move(L, k, d) {
  const n = clampBounds(k, d, L.rng, AXIS);
  if (n !== L.rng[k]) {
    L.rng[k] = n;
    L.ctx.set(k === "low" ? "ldrlow" : "ldrhigh", n);
  }
  paintRange(L);
  plot(L);
}

/** @param {Loudness} L */
function paintRange(L) {
  const { boxes, rng } = L;
  boxes.low.input.value = String(rng.low);
  boxes.high.input.value = String(rng.high);
  boxes.low.input.max = String(rng.high);
  boxes.high.input.min = String(rng.low);
  L.levelOut.textContent = signed(L.level, 1);
  draw(L);
}

/** @param {Loudness} L */
function draw(L) {
  const { svg, rng } = L;
  const W = svg.clientWidth;
  if (!W) return;
  const m = barMarks(W, BAR);
  const drag = /** @type {Side | null} */ (L.bar.key);
  paintSvg(svg, W, Y.H, [
    m.track(),
    m.span("lspan", rng.low, rng.high),
    m.ticks(MARKS, ""),
    m.labels(LABELS),
    m.needle(clampToAxis(L.level, AXIS)),
    m.paren(rng.low, 1, `paren ${drag === "low" ? "act" : ""}`),
    m.paren(rng.high, -1, `paren ${drag === "high" ? "act" : ""}`),
    drag && m.bubble(rng[drag]),
  ]);
}

// ── Plot ──────────────────────────────────────────────────────────────
/** @param {Loudness} L */
function paintBands(L) {
  for (const sd of SIDES) {
    select(L.ctl[sd].type, L.p[sd].type);
    for (const k of NUMS) L.ctl[sd][k].input.value = String(L.p[sd][k]);
  }
}
/**
 * Grabbing a dot points the switch at that dot's side (v1).
 *
 * @param {Loudness} L
 * @param {Side} sd
 * @returns {import('../controls/resp-plot.js').Handle}
 */
const handle = (L, sd) => ({
  f: L.p[sd].freq,
  db: L.p[sd].level,
  off: L.grayed,
  onDrag: (f, d) => {
    if (L.side !== sd) showSide(L, sd);
    L.p[sd].freq = f;
    L.p[sd].level = Math.max(-20, Math.min(20, d));
    paintBands(L);
    plot(L);
  },
  onEnd: (f, d) => {
    L.p[sd].freq = f;
    L.p[sd].level = Math.max(-20, Math.min(20, d));
    stage(L, sd, "freq", L.p[sd].freq);
    stage(L, sd, "level", L.p[sd].level);
    paintBands(L);
    plot(L);
  },
});
/** @param {Loudness} L */
function plot(L) {
  const { p } = L;
  const amt = shelfScale(L.level, L.rng.low, L.rng.high);
  L.rp.draw(
    [
      { cls: "ghost", label: "max", fn: (f) => loudnessDb(p, f, 1) },
      { label: `${percentApplied(amt)}% applied`, fn: (f) => loudnessDb(p, f, amt) },
    ],
    [handle(L, "low"), handle(L, "high")],
  );
}

/**
 * The block's values moved: gray while bypassed or Off, with the reason said.
 *
 * @param {Loudness} L
 * @param {HTMLElement} host
 * @param {Store} v
 * @param {(vals: Store) => string} bypassed
 */
function watch(L, host, v, bypassed) {
  const why = bypassed(v) || (v.ldon === "0" ? L.cfg.off : "");
  L.grayed = !!why;
  // Controls, bar and plot gray; the copy and the reason stay legible (as in every drawer).
  const left = /** @type {Element} */ (L.bands.querySelector(".lleft"));
  for (const el of [left, /** @type {Element} */ (host.querySelector(".lrange")), L.plotHost])
    el.classList.toggle("grayed", L.grayed);
  for (const x of host.querySelectorAll("button,input")) {
    const field = /** @type {HTMLButtonElement | HTMLInputElement} */ (x);
    field.disabled = L.grayed;
  }
  L.reason.say(why);
  plot(L);
}

/**
 * Discard (mock): both bands and the bounds go back; the side dots clear.
 *
 * @param {Loudness} L
 * @param {Store} b
 */
function discard(L, b) {
  for (const sd of SIDES)
    for (const k of KEYS) {
      if (k === "type") L.p[sd].type = b[id(sd, k)];
      else L.p[sd][k] = Number(b[id(sd, k)]);
    }
  L.rng.low = Number(b.ldrlow);
  L.rng.high = Number(b.ldrhigh);
  L.dirtySide.low = L.dirtySide.high = false;
  paintSideDots(L);
  paintBands(L);
  paintRange(L);
  plot(L);
}

/**
 * Mount the loudness drawer body into `host`, staging through `ctx`.
 *
 * @param {HTMLElement} host
 * @param {LoudnessConfig} cfg  LOUDNESS (data/matrix.js)
 * @param {BlockCtx} ctx
 * @param {{ bypassed: (vals: Store) => string, level: number, levelBus: EventTarget }} o
 */
export function mountLoudness(host, cfg, ctx, { bypassed, level: lvl0, levelBus }) {
  // The parts are assigned by buildBands, buildBody and below, before anything paints.
  const L = /** @type {Loudness} */ ({
    cfg,
    ctx,
    p: { low: { ...cfg.low }, high: { ...cfg.high } },
    rng: { low: cfg.rangeLow, high: cfg.rangeHigh },
    level: lvl0,
    grayed: false,
    side: "low",
    dirtySide: { low: false, high: false },
  });
  for (const side of SIDES) for (const k of KEYS) ctx.init(id(side, k), L.p[side][k]);
  ctx.init("ldrlow", L.rng.low);
  ctx.init("ldrhigh", L.rng.high);
  buildBands(L);
  buildBody(L, host);
  L.rp = mountRespPlot(L.plotHost, { lo: -3, hi: 24, step: 6, minor: 3, aria: "Loudness response" });

  // Drag: the nearer bound.
  L.bar = bindBar(L.svg, {
    ...BAR,
    blocked: () => L.grayed,
    pick: (d) => pickBound(d, L.rng),
    move: (k, d) => move(L, /** @type {Side} */ (k), d),
    draw: () => draw(L),
  });

  ctx.watch((v) => watch(L, host, v, bypassed));
  levelBus.addEventListener("level", (e) => {
    L.level = /** @type {CustomEvent<number>} */ (e).detail;
    paintRange(L);
    plot(L);
  });
  ctx.onDiscard((b) => discard(L, b));
  showSide(L, "low");
  paintBands(L);
  paintRange(L);
  plot(L);
  return { range: () => ({ ...L.rng }) };
}
