// Volume range bar (Volume drawer, Range tab). HQPTuner v1's RangeBar on the faceplate:
// Min / Startup / Max on one shared dBFS axis, so the relationship three separate boxes never stated is drawn —
// the filled span between the brackets IS the range the engine will allow at runtime.
//
//   axis      −120 … +12 dBFS, linear (lib/volume.js AXIS_MIN / AXIS_MAX). Ticks every 10 dB to 0, plus +12;
//             numbers at −120 dB, −90, −60, −30, −3, 0, +12; heavy lines at 0 (limiter threshold) and −3
//             (recommended ceiling when resampling).
//   Min / Max brackets on the bar, arms pointing in at the span they enclose. Startup: hollow pin above the bar,
//             so it stays grabbable at Min or Max. Cannot cross: clampVolume (whole dB; Min ≤ 0; Max ≤ +12).
//   Loudness  bounds as parentheses + a strip inside the bar, shown while loudness is engaged. Reference only:
//             they are Loudness settings (one home per setting), edited in the Loudness drawer (the `Loudness ›` link opens it).
//   Needle    live playback volume (engine-row control); a readout, never a handle.
//
// Drag on the bar moves the nearest handle (the pin row prefers Startup); the boxes below take typed values.
// Edits stage (restore lane), so they mark the tab dirty through the drawer block context.
// Grays whole while Fixed volume is not Off (gray reason from the data, re-read on every drawer change).

import { h, s } from "../../lib/shell/dom.js";
import { paintSvg } from "../../lib/plots/gauge.js";
import { grayReason, manPara } from "../../lib/controls/controls.js";
import { barMarks, bindBar, rangeBox, readout } from "../../lib/plots/range-bar.js";
import { signed } from "../../model/shell/format.js";
import { clampVolume, pickVolumeHandle, tickMarks, ticksEvery } from "../../model/gauges/range-axis.js";

const PADX = 16; // track inset, room for the end labels
const Y = { pin: 3, bar: 30, barH: 14, tick: 56, label: 80, H: 86 };
/** @type {VolumeKey[]} */
const KEYS = ["min", "startup", "max"];

/**
 * @typedef {import('../../model/gauges/range-axis.js').Axis} Axis
 * @typedef {import('../../model/gauges/range-axis.js').VolumeKey} VolumeKey
 * @typedef {import('../../lib/plots/range-bar.js').KeyGlyph} KeyGlyph
 * @typedef {import('./drawer/state.js').BlockCtx} BlockCtx
 * @typedef {import('./drawer/state.js').Store} Store
 * @typedef {{ k?: string, text: string }[]} Manual  manual lines, each led by its setting's label
 * @typedef {{ on: boolean, low: number, high: number, man: Manual }} LoudnessRef  bounds dBFS, set in Loudness
 */

/**
 * VOLUME_RANGE (data/volume.js): the axis, each handle's staging id and value (dBFS), the live level, the gray
 * reason, the manual, the loudness bounds shown for reference, and the link to the Loudness drawer.
 *
 * @typedef {object} VolumeRangeConfig
 * @property {string} label
 * @property {Axis} axis
 * @property {Record<VolumeKey, string>} ids
 * @property {number} min
 * @property {number} startup
 * @property {number} max
 * @property {number | null} level
 * @property {(vals: Store) => string} gray
 * @property {Manual} man
 * @property {LoudnessRef} loudness
 * @property {() => void} [openLoudness]
 */

/**
 * One mounted bar's state and parts: the config it was mounted with, the values, the live level, the gray, and the
 * elements the paints reach.
 *
 * @typedef {object} VR
 * @property {HTMLElement} host
 * @property {VolumeRangeConfig} cfg
 * @property {BlockCtx} ctx
 * @property {Axis} axis
 * @property {LoudnessRef} loudness
 * @property {Record<VolumeKey, string>} ids
 * @property {Record<VolumeKey, number>} cur
 * @property {number | null} level
 * @property {boolean} grayed
 * @property {SVGSVGElement} svg
 * @property {Record<VolumeKey, { input: HTMLInputElement, el: HTMLElement }>} boxes
 * @property {HTMLElement} levelOut
 * @property {HTMLElement} lowOut
 * @property {HTMLElement} highOut
 * @property {{ el: HTMLElement, say: (why: string) => void }} reason
 * @property {ReturnType<typeof barScale>} scale
 * @property {{ key: string | null }} bar
 */

/**
 * Mount the volume range bar into `host`, staging Min, Startup and Max through `ctx`.
 *
 * @param {HTMLElement} host   drawer block container
 * @param {VolumeRangeConfig} cfg  VOLUME_RANGE
 * @param {BlockCtx} ctx  drawer block context
 * @param {EventTarget} levelBus  'level' events {detail: dB} from the engine-row volume control
 */
export function mountVolumeRange(host, cfg, ctx, levelBus) {
  const { axis, loudness, ids } = cfg;
  // The parts are assigned below, before anything paints.
  const vr = /** @type {VR} */ ({
    host,
    cfg,
    ctx,
    axis,
    loudness,
    ids,
    cur: { min: cfg.min, startup: cfg.startup, max: cfg.max },
    level: cfg.level,
    grayed: false,
  });
  for (const k of KEYS) ctx.init(ids[k], vr.cur[k]);

  vr.svg = /** @type {SVGSVGElement} */ (s("svg.vrbar", { role: "img", "aria-label": "Volume range" }));
  const well = h("div.vrwell", {}, vr.svg);
  vr.boxes = {
    min: boxOf(vr, "min", "Min", "min"),
    startup: boxOf(vr, "startup", "Startup", "pin"),
    max: boxOf(vr, "max", "Max", "max"),
  };

  // Every mark on the bar is named once, beside its own glyph: the volume marks in the box stack (Playback is a
  // live readout, not a box), the loudness bounds in their own row (read-only here; set in the Loudness drawer).
  vr.levelOut = h("output.vfd.ro.live", { "aria-label": "Playback volume" });
  vr.lowOut = bound(loudness.low);
  vr.highOut = bound(loudness.high);

  vr.reason = grayReason();
  host.append(h("div.fh", {}, h("b", { text: cfg.label })), well, volumeRow(vr), loudnessRow(vr));

  // Drag: nearest handle; the pin row (above the bar) prefers Startup.
  vr.scale = barScale(axis);
  const svg = vr.svg;
  vr.bar = bindBar(svg, {
    ...vr.scale.BAR,
    blocked: () => vr.grayed,
    pick: (db, yTop) => pickVolumeHandle(db, yTop, vr.cur, Y.bar - 2),
    move: (k, db) => move(vr, /** @type {VolumeKey} */ (k), db),
    draw: () => draw(vr),
    grab: () => svg.classList.add("drag"),
    drop: () => svg.classList.remove("drag"),
  });

  // Discard (mock): the bounds and startup go back.
  ctx.onDiscard((b) => {
    for (const k of KEYS) vr.cur[k] = Number(b[ids[k]]);
    paint(vr);
  });

  ctx.watch((vals) => grayOut(vr, vals));

  levelBus.addEventListener("level", (e) => {
    vr.level = /** @type {CustomEvent<number>} */ (e).detail;
    paintLevel(vr);
    draw(vr);
  });
  // Loudness applied (Loudness drawer, mock Apply): the bounds and their visibility follow.
  levelBus.addEventListener("loudness", () => loudnessApplied(vr));
  paintLevel(vr);
  paint(vr);
}

/**
 * A typed box for one handle; a typed value moves it.
 *
 * @param {VR} vr
 * @param {VolumeKey} k
 * @param {string} label
 * @param {KeyGlyph} key  its glyph
 */
const boxOf = (vr, k, label, key) => rangeBox(label, key, { id: vr.ids[k] }, (v) => move(vr, k, v));

/**
 * A loudness bound's read-only box.
 *
 * @param {number} v  dBFS
 */
const bound = (v) => h("output.vfd.ro", { text: signed(v) });

/**
 * The volume row: the boxes and the Playback readout over the gray reason, the manual beside.
 *
 * @param {VR} vr
 */
const volumeRow = (vr) =>
  h(
    "div.vrrow",
    {},
    h(
      "div.vrctl",
      {},
      h(
        "div.vrboxes",
        {},
        vr.boxes.min.el,
        vr.boxes.startup.el,
        vr.boxes.max.el,
        readout({ glyph: "needle", label: "Playback", out: vr.levelOut, unit: "dB" }),
      ),
      vr.reason.el,
    ),
    h("div.man", {}, vr.cfg.man.map(manPara)),
  );

/**
 * Loudness: reference + (dead) link out to its own drawer, where the bounds are set.
 *
 * @param {VR} vr
 */
const loudnessRow = (vr) =>
  h(
    "div.vrrow.vrloud",
    {},
    h(
      "div.vrctl",
      {},
      h(
        "div.fh",
        {},
        h("b", { text: "Loudness bounds" }),
        h(
          "a.xref",
          {
            href: "#",
            on: {
              click: (e) => {
                e.preventDefault();
                vr.cfg.openLoudness?.();
              },
            },
          },
          "Loudness",
          h("span", { "aria-hidden": "true", text: " ›" }),
        ),
      ),
      h(
        "div.vrboxes.inl",
        { hidden: !vr.loudness.on },
        readout({ glyph: "lparen", label: "Lower", out: vr.lowOut, unit: "dBFS" }),
        readout({ glyph: "rparen", label: "Upper", out: vr.highOut, unit: "dBFS" }),
      ),
    ),
    h("div.man", {}, vr.loudness.man.map(manPara)),
  );

/**
 * The bar's geometry, its numbered ticks and its tick marks.
 *
 * @param {Axis} axis
 */
function barScale(axis) {
  const BAR = { axis, padX: PADX, Y };
  const LABELS = new Map([
    [-120, "−120 dB"],
    [-90, "−90"],
    [-60, "−60"],
    [-30, "−30"],
    [-3, "−3"],
    [0, "0"],
    [axis.max, signed(axis.max)],
  ]);
  const MARKS = tickMarks([...ticksEvery(axis.min, 0, 10), -3, axis.max], LABELS, [0, -3]);
  return { BAR, LABELS, MARKS };
}

/**
 * @param {VR} vr
 * @param {VolumeKey} k
 * @param {number} db
 */
function move(vr, k, db) {
  const n = clampVolume(k, db, vr.cur, vr.axis);
  if (n !== vr.cur[k]) {
    vr.cur[k] = n;
    vr.ctx.set(vr.ids[k], n);
  }
  paint(vr);
}

/** @param {VR} vr */
function paint(vr) {
  const { boxes, cur, axis } = vr;
  for (const k of KEYS) boxes[k].input.value = String(cur[k]);
  boxes.min.input.min = String(axis.min);
  boxes.min.input.max = String(Math.min(0, cur.startup));
  boxes.startup.input.min = String(cur.min);
  boxes.startup.input.max = String(cur.max);
  boxes.max.input.min = String(cur.startup);
  boxes.max.input.max = String(axis.max);
  draw(vr);
}

/**
 * A Min / Max bracket, arms pointing in (`dir` 1 for Min, −1 for Max).
 *
 * @param {number} xx  its x
 * @param {number} dir
 * @param {boolean} act  being dragged
 */
function bracket(xx, dir, act) {
  const by = Y.bar,
    bh = Y.barH,
    arm = 6 * dir;
  return s("path", {
    class: `brk ${act ? "act" : ""}`,
    d: `M${xx + arm},${by - 5} H${xx} V${by + bh + 5} H${xx + arm}`,
  });
}

/**
 * The Startup pin above the bar.
 *
 * @param {number} px  its x
 * @param {boolean} act  being dragged
 */
const pin = (px, act) =>
  s("path", {
    class: `pin ${act ? "act" : ""}`,
    d: `M${px - 6},${Y.pin + 3} Q${px - 6},${Y.pin} ${px - 3},${Y.pin} H${px + 3} Q${px + 6},${Y.pin} ${px + 6},${Y.pin + 3} V${Y.pin + 14} L${px},${Y.pin + 21} L${px - 6},${Y.pin + 14} Z`,
  });

/**
 * The loudness strip inside the bar and its parentheses.
 *
 * @param {ReturnType<typeof barMarks>} m  the bar's marks
 * @param {{ low: number, high: number }} loudness
 */
const loudBand = (m, loudness) => {
  const { x } = m;
  return [
    s("rect.lband", {
      x: x(loudness.low),
      y: Y.bar + Y.barH - 4,
      width: x(loudness.high) - x(loudness.low),
      height: 3,
    }),
    m.paren(loudness.low, 1, "paren"),
    m.paren(loudness.high, -1, "paren"),
  ];
};

/** @param {VR} vr */
function draw(vr) {
  const { svg, cur, scale, loudness } = vr;
  const W = svg.clientWidth;
  if (!W) return;
  const m = barMarks(W, scale.BAR);
  const { x } = m;
  const drag = /** @type {VolumeKey | null} */ (vr.bar.key);

  paintSvg(svg, W, Y.H, [
    m.track(),
    m.span("span", cur.min, cur.max),
    loudness.on && loudBand(m, loudness),
    m.ticks(scale.MARKS, "minor"),
    m.labels(scale.LABELS),
    vr.level !== null && m.needle(vr.level),
    bracket(x(cur.min), 1, drag === "min"),
    bracket(x(cur.max), -1, drag === "max"),
    pin(x(cur.startup), drag === "startup"),
    drag && m.bubble(cur[drag]),
  ]);
}

/**
 * The drawer changed: gray the whole bar while the data gives a reason.
 *
 * @param {VR} vr
 * @param {Store} vals
 */
function grayOut(vr, vals) {
  const why = vr.cfg.gray(vals);
  vr.grayed = !!why;
  vr.host.classList.toggle("grayed-range", vr.grayed);
  for (const b of Object.values(vr.boxes)) b.input.disabled = vr.grayed;
  vr.reason.say(why);
}

/** @param {VR} vr */
function paintLevel(vr) {
  vr.levelOut.textContent = vr.level === null ? "—" : signed(vr.level, 1);
}

/**
 * Loudness applied: the bounds and their visibility follow.
 *
 * @param {VR} vr
 */
function loudnessApplied(vr) {
  vr.lowOut.textContent = signed(vr.loudness.low);
  vr.highOut.textContent = signed(vr.loudness.high);
  /** @type {HTMLElement} */ (vr.host.querySelector(".vrloud .vrboxes")).hidden = !vr.loudness.on;
  draw(vr);
}
