// Output and conversion: what the output carries, the page's rate tuner, the chain (Resampling · Shaping on the page and
// the rail), the DSD Processing, Resampling and Shaping drawers, and the Output drawer.

import { setChain } from "../lib/narrowing/narrow.js";
import { sizeOf, SIZE } from "../lib/shell/plate.js";
import { setDacType } from "../lib/narrowing/dactype.js";
import { xrefGo } from "../lib/controls/xref.js";
import { mountDrawer } from "../components/drawers/drawer.js";
import { mountOutputTuner } from "../components/page/output-tuner.js";
import { mountConversion } from "../components/page/conversion.js";
import { mountModeDrawer } from "../components/drawers/mode-drawer.js";
import { MODE_DRAWERS } from "../data/stages/conversion.js";
import { OUTPUT_DRAWER, BACKEND_NAMES, DEVICES, RATE_TIERS } from "../data/stages/output.js";
import { OUT } from "../data/shell/scenarios.js";
import { el } from "./markup.js";

/** @typedef {import("./state.js").App} App */
/** @typedef {import("./state.js").Conversion} Conversion */
/** @typedef {import("./state.js").Drawer} Drawer */
/** @typedef {import("../components/drawers/mode-drawer.js").ModeApi} ModeApi */
/** @typedef {import("../components/drawers/drawer/state.js").Store} Store */
/** @typedef {import("../data/stages/output.js").Control} Control */
/** @typedef {import("../data/stages/output.js").Row} Row */
/** @typedef {ReturnType<typeof mountOutputTuner>} Tuner */
/** @typedef {{ group: string, rows: Row[] }} BackendGroup  a backend's rows on the Output drawer's format tab */
/** @typedef {(run: string, p: string, sc: object) => { tier: number | null, rate: string, rest: string, value: string }} OutFor */

/**
 * The output format as applied, and the readouts that follow it.
 *
 * @typedef {object} OutputFormat
 * @property {{ backend: string, bits: Record<string, string | number | undefined> }} outFmt
 * @property {() => string} dithNote
 * @property {OutFor} outFor
 */

// PCM output bit depth = the Output drawer's DAC bits (the dithering level) for the active backend, as applied. Omitted at
// 0 (auto-detect: the engine picks it) and on Combo (one value per sub-device).
/**
 * @param {string} be
 * @returns {Control}
 */
const dacBitsRow = (be) => {
  const group = /** @type {BackendGroup | undefined} */ (
    OUTPUT_DRAWER.tabs[0].body.find((it) => "group" in it && it.group === be)
  );
  return /** @type {Control} */ (group?.rows.find((r) => r.label === "DAC bits")?.control);
};
/** @type {Record<string, keyof import("../lib/narrowing/dactype.js").DacType>} */
const DAC_PREF = { dacr2r: "r2r", dacess: "ess" }; // Shaping's DAC type rows: HQPTuner prefs that fold the shaper lists
/** A path's output by running chain. @type {Record<string, { tier: number, rate: Record<string, string> }>} */
const OUT_BY_RUN = OUT;

/**
 * What the output carries, read off the Output drawer as applied.
 *
 * @param {App} app
 * @returns {OutputFormat}
 */
function outputFormat(app) {
  /** @type {OutputFormat["outFmt"]} */
  const outFmt = {
    backend: /** @type {string} */ (OUTPUT_DRAWER.backend),
    bits: { network: dacBitsRow("network").value, alsa: dacBitsRow("alsa").value },
  };
  const pcmBits = () => {
    const b = Number(outFmt.bits[outFmt.backend]);
    return b > 0 ? ` / ${b}bit` : "";
  };
  // Shaping drawer, PCM out: what the dither targets, read off the Output drawer (DRAFT copy).
  const dithNote = () => {
    const b = Number(outFmt.bits[outFmt.backend]);
    return b > 0
      ? `Dithers to ${b} bits (DAC bits)`
      : "Dithers to the bit depth the DAC reports (DAC bits: auto-detect)";
  };
  /** What the output carries: tier playing (RATE_TIERS index), exact rate, the rest (bits · channels), the rail value.
   *  A pinned rate (page tuner, while Allow pinned rates is On): the output plays it (mock), whatever the source.
   *  @type {OutFor} */
  const outFor = (run, p, sc) => {
    if (p === "idle") return { tier: null, rate: "—", rest: "", value: "—" };
    let tier, rate, bits;
    const pinned = app.pinned;
    if (p === "direct") [tier, rate, bits] = [OUT.direct.tier, OUT.direct.rate.f44, "1bit"];
    else if (pinned && RATE_TIERS.tiers[pinned.tier].family === run) {
      const t = RATE_TIERS.tiers[pinned.tier];
      [tier, rate] = [pinned.tier, `${t[pinned.fam]} ${t.unit}`];
    } else [tier, rate] = [OUT_BY_RUN[run].tier, OUT_BY_RUN[run].rate[/** @type {{ fam: string }} */ (sc).fam]];
    if (p !== "direct") bits = run === "sdm" ? "1bit" : pcmBits().replace(" / ", "");
    return {
      tier,
      rate,
      rest: [bits, "2ch"].filter(Boolean).join(" · "),
      value: [rate, bits, "2ch"].filter(Boolean).join(" / "),
    };
  };
  return { outFmt, dithNote, outFor };
}

/**
 * The page's chain, Resampling · Shaping, on the running mode; app.conversion is set here.
 *
 * @param {App} app
 * @param {Tuner} tuner
 * @param {OutFor} outFor
 * @returns {Conversion}
 */
function mountChain(app, tuner, outFor) {
  const { bus, stages } = app;
  const conversion = /** @type {Conversion} */ (
    mountConversion(
      {
        rs: el("#rs-body"),
        sh: el("#sh-body"),
        stages,
        bus,
        /** @param {{ mode: string, run: string, tier: number | null }} o */
        onOut: (o) => {
          tuner.set({
            run: o.run,
            tier: o.tier,
            src: app.scene.playing ? /** @type {number} */ (app.scene.tier) : null, // a playing scene has its tier
            fam: app.scene.fam || "f44",
          });
          app.swLight();
          app.outDrawer?.set("omode", o.mode);
        },
        /** @param {string} run */
        onRun: (run) => {
          setChain(run);
          app.raise();
        },
        onPath: app.onPath,
      },
      app.conv,
      outFor,
      app.scene,
    )
  );
  app.conversion = conversion;
  conversion.setRoom(!!sizeOf(SIZE).both); // opened on 13″ (#size-13): both filters open from the start
  return conversion;
}

/**
 * DSD Processing, Resampling, Shaping: one drawer per stage, PCM out | SDM out tabs (components/mode-drawer.js). Filters and
 * shapers are live with two homes (page + drawer); the rest stage. A facade lets the page and the mode switch reach all three.
 *
 * @param {App} app
 * @param {Conversion} conversion
 * @param {() => string} dithNote
 * @returns {{ dsdDrawer: ModeApi, shDrawer: ModeApi }}
 */
function mountModeDrawers(app, conversion, dithNote) {
  const { bus, stages } = app;
  /**
   * @param {keyof typeof MODE_DRAWERS} k
   * @param {(vals: Store) => void} [onApplied]
   */
  const modeDrawer = (k, onApplied) =>
    mountModeDrawer(
      el("#body"),
      MODE_DRAWERS[k].stages.map((id) => stages.get(id)),
      MODE_DRAWERS[k],
      {
        values: app.conv.values,
        running: conversion.running(),
        on: (id, v) => (DAC_PREF[id] ? setDacType(DAC_PREF[id], v, bus) : conversion.update(id, v)),
        onApplied,
      },
    );
  const dsdDrawer = modeDrawer("dsd", (v) => {
    // restart: the rail value follows, DSD playback sets the path
    for (const id of ["integ", "decim", "noise", "sgain"]) conversion.update(id, v[id]);
    conversion.setScene(app.scene, v.dsdplay === "1");
  });
  const rsDrawer = modeDrawer("resampling", (v) => conversion.update("sdmconv", v.sdmconv));
  const shDrawer = modeDrawer("shaping");
  shDrawer.note("dithto", dithNote());
  const modeDrawers = [dsdDrawer, rsDrawer, shDrawer];
  conversion.bindDrawer({
    set: (id, v) => {
      for (const d of modeDrawers) d.set(id, v);
    },
    setRunning: (m) => {
      for (const d of modeDrawers) d.setRunning(m);
    },
  });
  return { dsdDrawer, shDrawer };
}

/**
 * The Output drawer; app.outDrawer is set here.
 *
 * @param {App} app
 * @param {Conversion} conversion
 * @param {OutputFormat} fmt
 * @param {ModeApi} shDrawer
 * @returns {Drawer}
 */
function mountOutputDrawer(app, conversion, fmt, shDrawer) {
  const { outFmt, dithNote } = fmt;
  const outDrawer = mountDrawer(el("#body"), app.stages.get("output"), OUTPUT_DRAWER, {
    groupNames: BACKEND_NAMES,
    devices: DEVICES,
    rateTiers: RATE_TIERS,
    on: { omode: (v) => conversion.setMode(v) }, // live: the page, rail and Setting Switcher follow at once
    // DAC bits restart: the rail's Output value and the Shaping drawer's dither line follow on Apply.
    onApply: (v) => {
      Object.assign(outFmt, {
        backend: v.backend ?? outFmt.backend,
        bits: { network: v.netbits ?? outFmt.bits.network, alsa: v.alsabits ?? outFmt.bits.alsa },
      });
      conversion.refresh();
      shDrawer.note("dithto", dithNote());
    },
  });
  app.outDrawer = outDrawer;
  return outDrawer;
}

/**
 * Wire the output, the conversion chain and their drawers; app.conversion and app.outDrawer are set here.
 *
 * @param {App} app  the shared state (app/state.js)
 */
export function wireOutput(app) {
  const { bus, flags } = app;
  const fmt = outputFormat(app);

  // Output: the rate picker (pins on the running band), only while Allow pinned rates is On. No mode control.
  const tuner = mountOutputTuner(el("#oglass"), RATE_TIERS, {
    onPin: (pin) => {
      app.pinned = pin;
      app.conversion.refresh();
    },
    bus,
  });
  // Mock: `#mode-auto` = the daemon left in Auto ([source]) by another client; HQPTuner doesn't offer it, only reads it.
  if (flags.modeAuto) app.conv.mode = "auto";
  const conversion = mountChain(app, tuner, fmt.outFor);
  const { dsdDrawer, shDrawer } = mountModeDrawers(app, conversion, fmt.dithNote);
  const outDrawer = mountOutputDrawer(app, conversion, fmt, shDrawer);
  outDrawer.setOpen(false);
  outDrawer.set("omode", conversion.state().mode);
  // Settings → Behavior → Allow pinned rates (settings.js effect).
  bus.on("pinallow", (d) => {
    tuner.allow(d);
  });
  xrefGo("output-format", () => {
    outDrawer.setOpen(true);
    outDrawer.showTab("format");
  }); // Shaping → DAC bits
  xrefGo("dsdplay", () => dsdDrawer.openAt("sdm")); // DSD Processing → SDM out → DSD playback
}
