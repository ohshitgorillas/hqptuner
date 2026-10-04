// Profile builder: the page's `Profile builder` button (Matrix engine section) swaps the chain body for this one, as the
// gear does for Settings. Header, engine row and bottom bar stay. It covers the entire process of
// building a matrix profile, pipelines included; it edits a copy (nothing reaches the engine until
// Save, and saving restarts the engine), × on its title; it guides the user (even an expert on what they want isn't one
// on how HQPTuner lays it out), coherent and cohesive, no parts bin.
//   Rail   the walk, in the chain rail's grammar: Overview, then Listening, EQ / Correction, Crossfeed, DAC correction,
//          Loudness, each with its answer (`Skipped` where it doesn't apply). The page showing is lit (amber name +
//          left-hand bar). Tap any to jump: nothing forces the order.
//   Overview  the intro beside the signal chain with its part lit; what the profile holds,
//          one line per part (› jumps to its step) and DSP pipelines with its own access point (the one drawer); then
//          which profile (picker · Name, full width · Stations), its Description, and the ways on: Save (done, for a
//          profile tuned by ear already), Change something (the walk from here), Start from scratch (the walk from
//          defaults). Advanced settings: a quiet link at the foot only.
//   Steps  one part at a time in the drawers' row grammar (control column | the manual's own paragraph; choices as the
//          Volume drawer's choice lines), a guidance line on what the step decides, Back / Next; a step that doesn't apply
//          says why and Next passes it. The last step's Next (`Review`) returns to the overview.
// Edits stay staged per profile until Save or Discard, through switching and leaving. `[Default]` keeps its name and
// can't be deleted (v1). The builder opens on New profile from the running matrix (what's loaded: save it as it is).
// Save writes, restarts and runs the profile when the loaded station is ticked; the builder stays on it.
// Exit: ×, Escape with nothing open, the gear (Settings), or the Snapshot builder button.
// The shell (switching, staging, Save / Delete, the rail, the overview's frame, the swap) is lib/builder.js.
// Its decisions (skips, answers, dirty, layout, picker) are model/profile.js; this file builds and paints.

import { h, s } from "../../lib/shell/dom.js";
import { mountDrawer, closeOthers, familyOf } from "../drawers/drawer.js";
import { createPipelines } from "../drawers/pipelines.js";
import { mountAutoEq } from "./autoeq.js";
import { seg, select } from "../controls/seg.js";
import { BAUER_PRESETS } from "../../lib/dsp/xdsp.js";
import { mountBuilder, paras, drow as row, chainPic, holdRow } from "../../lib/builder/builder.js";
import { numBox } from "../../lib/controls/controls.js";
import { rowOf } from "../../model/builders/schema.js";
import { NEW, homeOf } from "../../model/builders/builder.js";
import { modeName } from "../../model/gauges/crossfeed.js";
import {
  DEFAULT,
  stepContext,
  skipOf,
  knownOf,
  isDirty,
  summaryOf,
  holdSkipped,
  shapeOf,
  needsLayout,
  paintView,
  pickerOf,
  renderView,
} from "../../model/builders/profile.js";
import {
  MATRIX_DRAWER,
  CORRECTION_DRAWER,
  CROSSFEED,
  LOUDNESS,
  ENGAGE_BYPASS,
  XF_MODES,
} from "../../data/stages/matrix.js";
import { PMAN } from "../../data/stages/pipelines.js";
import {
  PROFILE_COPY,
  PB_STEPS,
  PB_COPY,
  LISTEN,
  XF_LINES,
  KNOWN,
  MATRIX_STAGES,
  OUTSIDE_STAGES,
} from "../../data/builders/profiles.js";

const FAM = "pbuild";
const OFF_ON = [
  { v: "0", label: "Off" },
  { v: "1", label: "On" },
];

/**
 * @param {object} el  {btn: page button, chain: #body, body: #pbody, rail, page, plate, settings, snapshot, bus: lib/bus.js}
 * @param {{name: string, active?: boolean}[]} stations  in the tree's order
 * @param {object} data  PROFILES (station → name → {desc, listen?, vals?, pipes?})
 * @param {object} o  {running(), level(), levelBus, fixed(), onSaved(touched, rec, name, run),
 *                    pipelines: the page's pipeline set (data/pipelines.js pipelineSet), shared with the chain}
 */
export function mountProfileBuilder(el, stations, data, o) {
  // pb: the builder's tables, its edit state ({meta, known, ready, at, shape}) and its parts, shared by the functions below.
  const pb = tablesOf(stations, data, o, el.page);
  pb.B = mountShell(pb, el);
  pb.pick = pb.B.pick;
  pb.nameBox = pb.B.nameBox;
  mountValues(pb, el);
  mountOverview(pb);
  mountSteps(pb);
  mountAdvanced(pb);
  o.levelBus.addEventListener("level", () => {
    if (pb.ready && !el.body.hidden) paint(pb);
  });

  pb.B.load(pb.B.cur);
  pb.ready = true;
  show(pb, "overview");
  render(pb);
  return pb.B.start();
}

// ── Records (mock: this component's copy) ───────────────────────────────
const asProfile = (x) => ({ eqname: "", ...x, mxen: "1" }); // a profile built here runs the matrix
const listenOf = (vals) => (vals.xfmode !== "off" ? "headphones" : "speakers");

/** The builder's tables and its edit state as it opens. */
function tablesOf(stations, data, o, page) {
  const applied = familyOf("matrix").base; // the chain's applied matrix (what's loaded)
  const R = {
    engine: rowOf(MATRIX_DRAWER, "Engine"),
    expand: rowOf(MATRIX_DRAWER, "Expand HF"),
    iir: rowOf(MATRIX_DRAWER, "IIR to FIR"),
    dcen: rowOf(CORRECTION_DRAWER, "DAC correction"),
    dcdac: rowOf(CORRECTION_DRAWER, "DAC model"),
  };
  return {
    o,
    stations,
    page,
    applied,
    R,
    home: homeOf(stations),
    MODELS: R.dcdac.control.options,
    M: CROSSFEED.man,
    LM: LOUDNESS.man,
    LD: loudnessDefaults(),
    presets: { bauer: CROSSFEED.presets.filter((p) => p.v !== "custom"), structural: CROSSFEED.sPresets }, // bauer: the presets with fixed values
    records: recordsOf(stations, data, applied),
    // Opens on what's loaded: New profile from the running matrix (save it as it is, or change it).
    meta: undefined, // {name, stations, desc, listen} of the one being edited (its values live in the store)
    known: { crossfeed: "preset", loudness: "preset" }, // "do you know your settings?" per step
    ready: false,
    at: "overview",
    shape: "", // what the showing step lays out: a change re-lays it out (choice made, path changed)
  };
}

/** Each station's profiles over what's loaded. */
function recordsOf(stations, data, applied) {
  return Object.fromEntries(
    stations.map((st) => [
      st.name,
      Object.fromEntries(
        Object.entries(data[st.name] ?? {}).map(([name, r]) => {
          const vals = asProfile({ ...applied, ...(r.vals ?? {}) });
          if (r.pipes) vals.mxpipes = JSON.stringify(r.pipes(JSON.parse(applied.mxpipes)));
          return [name, { desc: r.desc ?? "", listen: r.listen ?? listenOf(vals), vals }];
        }),
      ),
    ]),
  );
}

const loudnessDefaults = () => ({
  ldlowtype: LOUDNESS.low.type,
  ldlowfreq: LOUDNESS.low.freq,
  ldlowsteep: LOUDNESS.low.steep,
  ldlowlevel: LOUDNESS.low.level,
  ldhightype: LOUDNESS.high.type,
  ldhighfreq: LOUDNESS.high.freq,
  ldhighsteep: LOUDNESS.high.steep,
  ldhighlevel: LOUDNESS.high.level,
  ldrlow: LOUDNESS.rangeLow,
  ldrhigh: LOUDNESS.rangeHigh,
});

/** Start from scratch: the forms' defaults, the stereo pair with no processing. */
function scratchOf({ applied, R, LD }) {
  const pipes = JSON.parse(applied.mxpipes)
    .filter((p) => !p.gen)
    .map((p) => ({ ...p, gain: p.src === p.mix ? 0 : p.gain, unit: "dB", stages: [] }));
  return asProfile({
    ...applied,
    mxpipes: JSON.stringify(pipes),
    eqname: "",
    xfgate: "0",
    xfmode: "off",
    xfimpl: "bauer",
    xfpreset: CROSSFEED.bauer.preset,
    xffreq: CROSSFEED.bauer.freq,
    xflevel: CROSSFEED.bauer.level,
    xfcomp: CROSSFEED.bauer.comp,
    xsangle: CROSSFEED.structural.angle,
    xscirc: CROSSFEED.structural.circ,
    xslambda: CROSSFEED.structural.lambda,
    dcen: "0",
    dcdac: "",
    ldon: "0",
    ...LD,
    mxengine: R.engine.control.value,
    mxexpand: R.expand.control.value,
    mxiir2fir: R.iir.control.value,
  });
}

// ── Shell ───────────────────────────────────────────────────────────────
function mountShell(pb, { btn, chain, body, rail, settings, snapshot, bus }) {
  const { o, stations, home } = pb;
  const reload = () => {
    pb.B.load(pb.B.cur);
    show(pb, "overview");
    render(pb);
  };
  return mountBuilder(
    { btn, chain, body, bus },
    {
      title: "Profile builder",
      closeLabel: "Close Profile builder",
      noun: "Profile",
      stations: stations.map((st) => st.name),
      book: pb.records,
      cur: { st: home, name: NEW },
      copy: {
        remove: (n) => PROFILE_COPY.remove(n),
        overwrite: (n) => PROFILE_COPY.overwrite(n),
        noName: PROFILE_COPY.noName,
        state: {
          restarts: PB_COPY.state.dirtyRun,
          dirty: PB_COPY.state.dirty,
          live: PB_COPY.state.running,
          saved: PB_COPY.state.saved,
        },
      },
      name: () => pb.meta.name,
      to: () => pb.meta.stations,
      record: () => ({ desc: pb.meta.desc, listen: pb.meta.listen, vals: { ...pb.v } }),
      dirty: () => dirty(pb),
      load: (c, buf) => load(pb, c, buf),
      buffer: () => ({ meta: structuredClone(pb.meta), vals: { ...pb.v } }),
      keeps: (c) => c.name === DEFAULT, // the station's unnamed profile: unticking its station copies it out
      ticked: () => pb.meta.stations.length > 0,
      restarts: () => pb.meta.stations.includes(home), // only the loaded station's profiles can run
      live: () => pb.B.cur.st === home && pb.B.cur.name === o.running(),
      view: (where) => {
        if (where) show(pb, where === "here" ? pb.at : "overview");
        render(pb);
      },
      refuse: () => {
        if (pb.at !== "overview") show(pb, "overview");
        pb.B.paintState();
        pb.nameBox.focus();
      },
      saved: ({ name, to, rec }) => {
        pb.B.load(pb.B.cur);
        show(pb, "overview");
        render(pb);
        // Saving restarts the engine; with the loaded station written, the profile runs (main.js).
        o.onSaved?.(
          to.map((st) => [st, Object.keys(pb.B.book[st])]),
          rec,
          name,
          to.includes(home),
        );
        pb.B.paintState();
      },
      removed: () => {
        reload();
        o.onSaved?.([[pb.B.cur.st, Object.keys(pb.B.book[pb.B.cur.st])]]);
      },
      leave: () => {
        settings.setOn(false);
        snapshot()?.setOn(false, false);
      },
      opened: () => {
        // What's loaded may have moved since (a chain tweak): an untouched New profile follows it.
        if (pb.B.cur.name === NEW && !pb.B.staged.has(NEW) && !dirty(pb)) pb.B.load(pb.B.cur);
        show(pb, "overview");
        render(pb);
      },
      painted: (d) => {
        const opt0 = pb.B.pick.selectedOptions[0];
        if (opt0) opt0.textContent = (pb.B.cur.name === NEW ? "New profile" : pb.B.cur.name) + (d ? " •" : "");
      },
      walk: walkSpec(pb, rail),
    },
  );
}

/** The walk: its steps, their answers, Start from scratch and the name box. */
function walkSpec(pb, rail) {
  return {
    rail,
    steps: PB_STEPS,
    copy: PB_COPY,
    skipOf: (id) => skip(pb, id),
    answer: (id) => (skip(pb, id) ? PB_COPY.skipped : answerOf(pb, id)),
    at: () => pb.at,
    show: (id) => show(pb, id),
    newLabel: "New profile",
    scratch: () => {
      pb.B.load(pb.B.cur, { meta: structuredClone(pb.meta), vals: scratchOf(pb) });
      show(pb, PB_STEPS[0].id);
      render(pb);
    },
    nameBox: {
      type: "text",
      "aria-label": "Profile name",
      maxlength: 60,
      spellcheck: "false",
      placeholder: PROFILE_COPY.name,
    },
    setName: (n) => {
      pb.meta.name = n;
    },
  };
}

// ── Values: one family store (the DSP pipelines drawer is its one drawer member) ─────
function mountValues(pb, { body, plate }) {
  const { PIPELINES, PIPELINES_DRAWER, FULL_FITS } = pb.o.pipelines;
  const pl0 = holdRow("DSP pipelines", null, "button.pbhold.pbpl");
  pb.plBtn = pl0.el;
  pb.plCount = pl0.a;
  pb.plCore = createPipelines(PIPELINES, {
    bypassed: () => "",
    plate,
    openCrossfeed: () => {
      pb.pl.setOpen(false);
      show(pb, "crossfeed");
    },
    goTab: (id) => pb.pl.showTab(id),
  });
  pb.pl = mountDrawer(body, pb.plBtn, PIPELINES_DRAWER, {
    prefix: "pb-",
    family: FAM,
    head: h("div.apply.pbact", {}, pb.B.discardButton()),
    onValues: () => {
      if (pb.ready) {
        paint(pb);
        pb.B.paintState();
      }
    },
    blocks: Object.fromEntries([
      ["pl-overview", pb.plCore.overview],
      ...Array.from({ length: PIPELINES.outputs }, (_, k) => [`pl-out${k}`, pb.plCore.output(k)]),
    ]),
  });
  pb.pl.setOpen(false);
  if (!FULL_FITS) body.querySelector("#pb-drawer-pipelines").classList.add("pl-short");
  pb.fam = familyOf(FAM);
  pb.v = pb.fam.vals;
}

/** Set values from the page: stages them (the pipelines member re-reads, so crossfeed blocks follow), repaints. */
function set(pb, patch) {
  for (const [k, x] of Object.entries(patch)) pb.v[k] = String(x);
  pb.pl.regray();
}

/** What record `c` holds as saved (New: what's loaded, in the loaded station). */
function savedOf(pb, c) {
  if (c.name === NEW)
    return {
      meta: { name: "", stations: [pb.home], desc: "", listen: listenOf(pb.applied) },
      vals: asProfile(pb.applied),
    };
  const r = pb.B.book[c.st][c.name];
  return { meta: { name: c.name, stations: [c.st], desc: r.desc, listen: r.listen }, vals: r.vals };
}

const dirty = (pb) => isDirty(pb.v, pb.meta, savedOf(pb, pb.B.cur));

function load(pb, c, buf) {
  const s0 = savedOf(pb, c);
  const to = buf ? buf.vals : s0.vals;
  Object.assign(pb.v, to);
  Object.assign(pb.fam.base, to);
  pb.pl.discarded();
  pb.pl.settle(); // the pipelines block repaints from the values (crossfeed blocks rebuilt)
  if (buf) {
    Object.assign(pb.fam.base, s0.vals);
    pb.pl.remark();
  }
  pb.meta = structuredClone(buf?.meta ?? s0.meta);
  pb.known = knownOf(pb.v, pb.presets, pb.LD);
  if (pb.ready) pb.eq.reset();
}

// ── Rail: the walk's answers ────────────────────────────────────────────
const ctx = (pb) => stepContext(pb.meta.listen, pb.o.fixed(), pb.MODELS);
const skip = (pb, id) => skipOf(PB_STEPS, id, ctx(pb));
/** Each step's answer from the profile's summary (EQ answers for itself). */
const ANSWER = {
  listen: (x) => LISTEN.find((l) => l.v === x.listen)?.label,
  crossfeed: ({ crossfeed: x }) => (x.on ? `${modeName(XF_MODES, x.mode) ?? "Off"} · ${x.preset ?? "Custom"}` : "Off"),
  correction: ({ correction: x }) => (x.on ? x.model || "[none]" : "Bypassed"),
  loudness: ({ loudness: x }) => (x.on ? `${x.percent}% applied` : "Off"),
};
function answerOf(pb, id) {
  if (id === "eq") return pb.eq.answer();
  return ANSWER[id](summaryOf(pb.meta, pb.v, pb.presets, { level: pb.o.level(), fixed: pb.o.fixed() }));
}

// ── Page parts ──────────────────────────────────────────────────────────
const drow = (label, ctl, man, extra) => row(label, ctl, man, { extra });
/** Choice lines (the Volume drawer's grammar): radio + name + its own paragraph. */
function choice(label, options, get, pickOne) {
  const lines = options.map((op) => {
    const radio = h("button.radio", {
      type: "button",
      role: "radio",
      aria: { label: op.label },
      on: { click: () => pickOne(op.v) },
    });
    const el = h(
      "div.chline",
      { data: { v: op.v } },
      h("div.chl", {}, radio, h("span.chn", { on: { click: () => pickOne(op.v) } }, h("b", { text: op.label }))),
      h("div.man", {}, paras(op.man)),
    );
    return { op, el, radio };
  });
  const el = h(
    "div.drow.drow-full.pbchoice",
    {},
    h("div.ctl", {}, h("div.fh", {}, h("b", { text: label }))),
    h(
      "div.chlist",
      { role: "radiogroup", "aria-label": label },
      lines.map((l) => l.el),
    ),
  );
  // fold(): once a pick leads somewhere (crossfeed engaged), the unpicked lines fold to their names (the Crossfeed
  // drawer's fold of the unpicked implementation), so the step's next rows keep their room.
  return {
    el,
    paint: (fold) => {
      for (const l of lines) {
        const on = l.op.v === get();
        l.el.classList.toggle("cur", on);
        l.el.classList.toggle("fold", !!fold && !on);
        l.radio.setAttribute("aria-checked", String(on));
      }
    },
  };
}
function num(pb, label, unit, k, attrs, man, mul = 1) {
  const { el: box, input } = numBox({ ...attrs, aria: label, unit });
  input.addEventListener("change", () => {
    const n = Number(input.value);
    if (Number.isFinite(n)) set(pb, { [k]: +(n / mul).toFixed(4) });
  });
  return {
    label,
    man,
    el: h("label.ci", {}, h("span.cl", { text: label }), box),
    paint: () => {
      input.value = +(Number(pb.v[k]) * mul).toFixed(2);
    },
  };
}
/** Several values in one row (the drawers' `group` grammar): boxes side by side, each with its label above; the
 *  manual's paragraphs keyed by those labels on the right. */
const group = (label, nums) =>
  drow(
    label,
    h(
      "div.cgrp",
      {},
      nums.map((n) => n.el),
    ),
    nums.map((n) => ({ k: n.label, text: n.man })),
  );

// Overview
function mountOverview(pb) {
  const { B, pick } = pb;
  pb.holdRows = ["eq", "crossfeed", "correction", "loudness"].map((id) => ({
    id,
    ...holdRow(PB_STEPS.find((x) => x.id === id).title, () => show(pb, id)),
  }));
  pick.addEventListener("change", () => {
    const [st, name] = pick.value === NEW ? [pb.home, NEW] : pick.value.split("\u0001");
    B.go({ st, name });
  });
  /** Stations menu (Snapshot builder's): ✓ = Save writes there; a station already holding this name shows it. */
  pb.stMenu = B.stationsMenu({
    ticked: () => pb.meta.stations,
    name: () => pb.meta.name,
    pick: (list) => {
      pb.meta.stations = list;
      pb.stMenu.paint();
      B.paintState();
    },
  });
  const desc = h("textarea", {
    "aria-label": "Profile description",
    spellcheck: "false",
    maxlength: 500,
    placeholder: PROFILE_COPY.desc,
  });
  desc.addEventListener("input", () => {
    pb.meta.desc = desc.value;
    B.paintState();
  });
  pb.desc = desc;
  pb.acts = B.buttons();
  pb.askHost = h("div.pbask");
  pb.overview = B.overview({
    intro: h("p.pbintro", { text: PB_COPY.intro }),
    holds: [pb.holdRows.map((r) => r.el), pb.plBtn],
    chain: chainPic(
      "Signal chain: the matrix engine's part lit",
      (id) => MATRIX_STAGES.includes(id),
      (id) => OUTSIDE_STAGES.includes(id),
    ),
    ids: [pb.stMenu.el],
    mid: [h("label.desc.pbdesc", {}, desc, pencil())],
    ask: pb.askHost,
    acts: pb.acts,
    after: h(
      "button.pbadvlink",
      { type: "button", on: { click: () => show(pb, "advanced") } },
      PB_COPY.advanced,
      h("span", { "aria-hidden": "true", text: " ›" }),
    ),
  });
}

// Steps
function mountSteps(pb) {
  const { v, M, LM, presets } = pb;
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
    onChange: (x) => set(pb, { xfpreset: x, xffreq: BAUER_PRESETS[x][0], xflevel: BAUER_PRESETS[x][1] }),
  });
  pb.sPre = seg({
    aria: "Preset",
    options: CROSSFEED.sPresets.map((q) => ({ v: q.v, label: q.label })),
    value: "standard",
    onChange: (x) => {
      const q = CROSSFEED.sPresets.find((r) => r.v === x);
      set(pb, { xsangle: q.angle, xslambda: q.lambda });
    },
  });
  pb.bPreRow = drow("Preset", pb.bPre, M.preset);
  pb.sPreRow = drow("Preset", pb.sPre, "");
  pb.bNums = [
    num(pb, "Frequency", "Hz", "xffreq", { min: 300, max: 2000, step: 1 }, M.freq),
    num(pb, "Level", "dB", "xflevel", { min: 1, max: 15, step: 0.1 }, M.level),
    num(pb, "Crossfeed compensation", "%", "xfcomp", { min: 0, max: 150, step: 1 }, M.comp),
  ];
  pb.sNums = [
    num(pb, "Speaker angle", "°", "xsangle", { min: 5, max: 60, step: 0.5 }, M.angle),
    num(pb, "Head circumference", "cm", "xscirc", { min: 41, max: 66, step: 0.25 }, M.circ),
    num(pb, "Center character", "%", "xslambda", { min: 0, max: 150, step: 1 }, M.lambda, 100),
  ];
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
    num(pb, "Lower bound", "dBFS", "ldrlow", { min: -120, max: 0, step: 1 }, LM.rangeLow),
    num(pb, "Upper bound", "dBFS", "ldrhigh", { min: -120, max: 0, step: 1 }, LM.rangeHigh),
    num(pb, "Bass level", "dB", "ldlowlevel", { min: -20, max: 20, step: 0.1 }, LM.low.level),
    num(pb, "Treble level", "dB", "ldhighlevel", { min: -20, max: 20, step: 0.1 }, LM.high.level),
  ];
  pb.bGroup = group("Values", pb.bNums);
  pb.sGroup = group("Values", pb.sNums);
  pb.ldGroup = group("Values", pb.ldNums);
}

// Advanced settings (only from the overview's foot): the engine rows with every option's manual line.
function optList(pb, r, k) {
  const rows = r.optMan.map((x) =>
    h(
      "button.optrow",
      { type: "button", data: { v: x.v }, on: { click: () => set(pb, { [k]: x.v }) } },
      h("code", { text: x.label ?? x.v }),
      h("span", { text: x.man }),
    ),
  );
  return {
    el: h("div.optlist", { role: "list" }, rows),
    paint: () => {
      for (const b of rows) b.classList.toggle("cur", b.dataset.v === pb.v[k]);
    },
  };
}
function mountAdvanced(pb) {
  const { R } = pb;
  pb.engSeg = seg({
    aria: "Engine",
    cls: "enum",
    options: R.engine.optMan.map((x) => ({ v: x.v, label: x.label })),
    value: "1",
    onChange: (x) => set(pb, { mxengine: x }),
  });
  pb.hfSeg = seg({ aria: "Expand HF", options: OFF_ON, value: "0", onChange: (x) => set(pb, { mxexpand: x }) });
  pb.iirSeg = seg({
    aria: "IIR to FIR",
    cls: "enum",
    options: R.iir.optMan.map((x) => ({ v: x.v, label: x.label ?? x.v })),
    value: "0",
    onChange: (x) => set(pb, { mxiir2fir: x }),
  });
  pb.engList = optList(pb, R.engine, "mxengine");
  pb.iirList = optList(pb, R.iir, "mxiir2fir");
}
function advancedPage(pb) {
  const { B, R } = pb;
  return h(
    "div.pbstepp",
    {},
    B.title(PB_COPY.advanced),
    h(
      "div.pbsrows",
      {},
      drow("Engine", pb.engSeg, R.engine.man, pb.engList.el),
      drow("Expand HF", pb.hfSeg, R.expand.man),
      drow("IIR to FIR", pb.iirSeg, R.iir.man, pb.iirList.el),
    ),
    h(
      "div.pbnav",
      {},
      h("span.grow"),
      h("button.btn.sm", { type: "button", text: PB_COPY.overview, on: { click: () => show(pb, "overview") } }),
    ),
  );
}

/** A step's page (the shell's frame): the guidance or skip line, then its rows. */
const stepPage = (pb, id) =>
  pb.B.stepPage(id, {
    guide: (why, st) => h("p.pbguide", { class: why && "skip", text: why || st.guide(ctx(pb)) }),
    rows: (x) => stepRows(pb, x),
  });
function stepRows(pb, id) {
  const { v, known } = pb;
  if (id === "listen") return [drow("Listening", pb.listenSeg, "")];
  if (id === "eq")
    return [pb.meta.listen === "headphones" && pb.eqRows.auto, pb.eqRows.files, pb.eqOut].filter(Boolean);
  if (id === "crossfeed") {
    if (v.xfmode === "off") return [pb.xfSel.el];
    const pre = v.xfmode === "bauer" ? pb.bPreRow : pb.sPreRow;
    return [
      pb.xfSel.el,
      pb.xfKnown.el,
      known.crossfeed === "preset" ? pre : v.xfmode === "bauer" ? pb.bGroup : pb.sGroup,
    ];
  }
  if (id === "correction")
    return [drow("DAC correction", pb.dcSeg, pb.R.dcen.man), drow("DAC model", pb.dcSel, pb.R.dcdac.man)];
  if (id === "loudness")
    return [
      drow("Loudness", pb.ldSeg, pb.LM.enabled),
      ...(v.ldon === "1" ? [pb.ldKnown.el, ...(known.loudness === "values" ? [pb.ldGroup] : [])] : []),
    ];
  return [];
}

const shapeNow = (pb) => shapeOf(pb.at, pb.meta, pb.v, pb.known, skip(pb, pb.at));
function show(pb, id) {
  if (!pb.B.inWalk(id) && id !== "advanced") id = "overview";
  closeOthers(null);
  pb.at = id;
  pb.page.replaceChildren(id === "overview" ? pb.overview : id === "advanced" ? advancedPage(pb) : stepPage(pb, id));
  pb.shape = shapeNow(pb);
  if (pb.ready) {
    paint(pb);
    pb.B.paintState();
  }
}

// ── Paint ───────────────────────────────────────────────────────────────
function paint(pb) {
  if (needsLayout(pb.at, pb.shape, shapeNow(pb))) {
    show(pb, pb.at);
    return;
  }
  const { v } = pb;
  const view = paintView(v, CROSSFEED.sPresets);
  select(pb.listenSeg, pb.meta.listen);
  pb.eq.paint();
  pb.xfSel.paint(v.xfmode !== "off");
  pb.xfKnown.paint();
  select(pb.bPre, v.xfpreset);
  select(pb.sPre, view.structural);
  for (const n of [...pb.bNums, ...pb.sNums, ...pb.ldNums]) n.paint();
  select(pb.dcSeg, v.dcen);
  pb.dcSel.value = v.dcdac;
  pb.dcSel.disabled = !view.dacModel;
  pb.dcSel.classList.toggle("grayed", !view.dacModel);
  select(pb.ldSeg, v.ldon);
  pb.ldKnown.paint();
  select(pb.engSeg, v.mxengine);
  select(pb.hfSeg, v.mxexpand);
  select(pb.iirSeg, v.mxiir2fir);
  pb.engList.paint();
  pb.iirList.paint();
  for (const r of pb.holdRows)
    r.a.textContent = holdSkipped(r.id, skip(pb, r.id), v) ? PB_COPY.skipped : answerOf(pb, r.id);
  pb.plCount.textContent = `${pb.plCore.count()} active`;
  pb.B.paintRail();
}

function render(pb) {
  const { B, pick, nameBox, meta } = pb;
  const { cur } = B;
  const view = renderView(cur, B.staged.has(NEW), dirty(pb));
  pick.replaceChildren(
    ...pickerOf(
      pb.stations.map((st) => st.name),
      B.book,
      (c) => B.isDirty(c),
    ).map((g) =>
      h(
        "optgroup",
        { label: g.st },
        g.options.map((x) => h("option", { value: x.key, text: x.dirty ? `${x.name} •` : x.name })),
      ),
    ),
    h("option", { value: NEW, text: view.newDirty ? "New profile •" : "New profile" }),
  );
  pick.value = B.K(cur);
  nameBox.value = meta.name;
  nameBox.readOnly = view.fixedName; // the station's unnamed profile: the daemon's name, not one to change (v1)
  pb.desc.value = meta.desc;
  pb.acts.del.hidden = !view.deletable;
  pb.askHost.replaceChildren(...(B.ask ? [B.askLine()] : []));
  pb.stMenu.paint();
  paint(pb);
  B.paintState();
}

/** The description's pencil (it marks the text as the user's to edit). */
const pencil = () =>
  s(
    "svg",
    {
      viewBox: "0 0 16 16",
      width: 12,
      height: 12,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 1.4,
      "stroke-linejoin": "round",
      "aria-hidden": "true",
    },
    s("path", { d: "M10.5 2.5l3 3-8 8H2.5v-3z" }),
    s("path", { d: "M9 4l3 3" }),
  );
