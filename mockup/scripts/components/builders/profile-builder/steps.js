import { h } from "../../../lib/shell/dom.js";
import { mountAutoEq } from "../autoeq.js";
import { seg } from "../../controls/seg.js";
import { BAUER_PRESETS } from "../../../lib/dsp/xdsp.js";
import { CROSSFEED, ENGAGE_BYPASS } from "../../../data/stages/matrix.js";
import { PMAN } from "../../../data/stages/pipelines.js";
import { LISTEN, XF_LINES, KNOWN } from "../../../data/builders/profiles.js";
import { paint } from "../profile-builder.js";
import { set, ctx } from "./values.js";
import { drow, choice, num, group } from "./parts.js";

/** @typedef {import('./records.js').PB} PB */
/** @typedef {import('../../../model/builders/profile.js').StructuralPreset} StructuralPreset */
/** @typedef {(typeof import('../../../data/builders/profiles.js').PB_STEPS)[number]} PbStep  a step, with its guide */

// Steps
/**
 * Mount every step's parts, in walk order.
 *
 * @param {PB} pb
 */
export function mountSteps(pb) {
  mountListenEq(pb);
  mountCrossfeed(pb);
  mountCorrection(pb);
}

/**
 * Listening and EQ / Correction.
 *
 * @param {PB} pb
 */
function mountListenEq(pb) {
  const { v } = pb;
  pb.listenSeg = seg({
    aria: "Listening",
    options: LISTEN,
    value: "speakers",
    onChange: (x) => {
      pb.meta.listen = x;
      paint(pb);
      pb.B.paintState();
    },
  });
  pb.eq = mountAutoEq({
    core: pb.plCore,
    name: () => v.eqname,
    land: (from) => {
      v.eqname = from;
      pb.pl.regray();
    },
  });
  pb.eqRows = {
    auto: drow("Headphone Auto EQ", pb.eq.search, PMAN.peqFile),
    files: drow("Correction files", pb.eq.files, PMAN.conv),
  };
  pb.eqOut = h("div.pbeqout", {}, pb.eq.holds, pb.eq.plot);
}

/**
 * Crossfeed: the implementation, "do you know your settings?", the presets and the values.
 *
 * @param {PB} pb
 */
function mountCrossfeed(pb) {
  const { v, M, presets } = pb;
  pb.xfSel = choice(
    "Crossfeed",
    [
      { v: "off", label: "Off", man: XF_LINES.off },
      { v: "bauer", label: "Bauer", man: M.bauer },
      { v: "structural", label: "Structural", man: XF_LINES.structural },
    ],
    () => v.xfmode,
    (x) => set(pb, x === "off" ? { xfgate: 0, xfmode: "off" } : { xfgate: 1, xfimpl: x, xfmode: x }),
  );
  pb.xfKnown = choice(
    "Settings",
    KNOWN.crossfeed,
    () => pb.known.crossfeed,
    (x) => {
      pb.known.crossfeed = x;
      paint(pb);
    },
  );
  pb.bPre = seg({
    aria: "Preset",
    options: presets.bauer,
    value: "default",
    onChange: (x) => {
      const p = BAUER_PRESETS[/** @type {keyof typeof BAUER_PRESETS} */ (x)];
      set(pb, { xfpreset: x, xffreq: p[0], xflevel: p[1] });
    },
  });
  pb.sPre = seg({
    aria: "Preset",
    options: CROSSFEED.sPresets.map((q) => ({ v: q.v, label: q.label })),
    value: "standard",
    onChange: (x) => {
      const q = /** @type {StructuralPreset} */ (CROSSFEED.sPresets.find((r) => r.v === x));
      set(pb, { xsangle: q.angle, xslambda: q.lambda });
    },
  });
  pb.bPreRow = drow("Preset", pb.bPre, M.preset);
  pb.sPreRow = drow("Preset", pb.sPre, "");
  pb.bNums = [
    num(pb, "xffreq", { label: "Frequency", unit: "Hz", min: 300, max: 2000, step: 1, man: M.freq }),
    num(pb, "xflevel", { label: "Level", unit: "dB", min: 1, max: 15, step: 0.1, man: M.level }),
    num(pb, "xfcomp", { label: "Crossfeed compensation", unit: "%", min: 0, max: 150, step: 1, man: M.comp }),
  ];
  pb.sNums = [
    num(pb, "xsangle", { label: "Speaker angle", unit: "°", min: 5, max: 60, step: 0.5, man: M.angle }),
    num(pb, "xscirc", { label: "Head circumference", unit: "cm", min: 41, max: 66, step: 0.25, man: M.circ }),
    num(pb, "xslambda", { label: "Center character", unit: "%", min: 0, max: 150, step: 1, man: M.lambda, mul: 100 }),
  ];
}

/**
 * DAC correction and Loudness, then the three value groups.
 *
 * @param {PB} pb
 */
function mountCorrection(pb) {
  const { LM } = pb;
  pb.dcSeg = seg({ aria: "DAC correction", options: ENGAGE_BYPASS, value: "0", onChange: (x) => set(pb, { dcen: x }) });
  pb.dcSel = h(
    "select.vfd",
    { "aria-label": "DAC model" },
    pb.MODELS.map((m) => h("option", { value: m.v, text: m.label })),
  );
  pb.dcSel.addEventListener("change", () => set(pb, { dcdac: pb.dcSel.value }));
  pb.ldSeg = seg({ aria: "Loudness", options: ENGAGE_BYPASS, value: "0", onChange: (x) => set(pb, { ldon: x }) });
  pb.ldKnown = choice(
    "Settings",
    KNOWN.loudness,
    () => pb.known.loudness,
    (x) => {
      pb.known.loudness = x;
      if (x === "preset") set(pb, pb.LD);
      else paint(pb);
    },
  );
  pb.ldNums = [
    num(pb, "ldrlow", { label: "Lower bound", unit: "dBFS", min: -120, max: 0, step: 1, man: LM.rangeLow }),
    num(pb, "ldrhigh", { label: "Upper bound", unit: "dBFS", min: -120, max: 0, step: 1, man: LM.rangeHigh }),
    num(pb, "ldlowlevel", { label: "Bass level", unit: "dB", min: -20, max: 20, step: 0.1, man: LM.low.level }),
    num(pb, "ldhighlevel", { label: "Treble level", unit: "dB", min: -20, max: 20, step: 0.1, man: LM.high.level }),
  ];
  pb.bGroup = group("Values", pb.bNums);
  pb.sGroup = group("Values", pb.sNums);
  pb.ldGroup = group("Values", pb.ldNums);
}

/**
 * The step's guidance line, or why it is skipped.
 *
 * @param {PB} pb
 * @param {string} why  '' = the step applies
 * @param {PbStep} st
 * @returns {HTMLElement}
 */
const guideLine = (pb, why, st) => h("p.pbguide", { class: why && "skip", text: why || st.guide(ctx(pb)) });

/**
 * A step's page (the shell's frame): the guidance or skip line, then its rows.
 *
 * @param {PB} pb
 * @param {string} id
 * @returns {HTMLElement}
 */
export function stepPage(pb, id) {
  const page = pb.B.stepPage(id, {
    guide: (why, st) => guideLine(pb, why, /** @type {PbStep} */ (st)),
    rows: (x) => stepRows(pb, x),
  });
  return /** @type {HTMLElement} */ (page);
}

/**
 * EQ / Correction's rows: Headphone Auto EQ only for headphones.
 *
 * @param {PB} pb
 * @returns {HTMLElement[]}
 */
function eqRows(pb) {
  const rows = [pb.meta.listen === "headphones" && pb.eqRows.auto, pb.eqRows.files, pb.eqOut];
  return /** @type {HTMLElement[]} */ (rows.filter(Boolean));
}

/**
 * Crossfeed's rows: the choice, then (engaged) whether the values are known, then the preset or the values.
 *
 * @param {PB} pb
 * @returns {HTMLElement[]}
 */
function crossfeedRows(pb) {
  const { v, known } = pb;
  if (v.xfmode === "off") return [pb.xfSel.el];
  const pre = v.xfmode === "bauer" ? pb.bPreRow : pb.sPreRow;
  const values = v.xfmode === "bauer" ? pb.bGroup : pb.sGroup;
  return [pb.xfSel.el, pb.xfKnown.el, known.crossfeed === "preset" ? pre : values];
}

/** @type {Record<string, (pb: PB) => HTMLElement[]>} each step's rows */
const ROWS = {
  listen: (pb) => [drow("Listening", pb.listenSeg, "")],
  eq: eqRows,
  crossfeed: crossfeedRows,
  correction: (pb) => [drow("DAC correction", pb.dcSeg, pb.R.dcen.man), drow("DAC model", pb.dcSel, pb.R.dcdac.man)],
  loudness: (pb) => [
    drow("Loudness", pb.ldSeg, pb.LM.enabled),
    ...(pb.v.ldon === "1" ? [pb.ldKnown.el, ...(pb.known.loudness === "values" ? [pb.ldGroup] : [])] : []),
  ],
};

/**
 * Step `id`'s rows.
 *
 * @param {PB} pb
 * @param {string} id
 * @returns {HTMLElement[]}
 */
function stepRows(pb, id) {
  return ROWS[id]?.(pb) ?? [];
}
