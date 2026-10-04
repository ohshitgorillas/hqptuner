// Output and conversion: what the output carries, the page's rate tuner, the chain (Resampling · Shaping on the page and
// the rail), the DSD Processing, Resampling and Shaping drawers, and the Output drawer.

import { $ } from "../lib/dom.js";
import { setChain } from "../lib/narrow.js";
import { sizeOf, SIZE } from "../lib/plate.js";
import { setDacType } from "../lib/dactype.js";
import { xrefGo } from "../lib/xref.js";
import { mountDrawer } from "../components/drawer.js";
import { mountOutputTuner } from "../components/output-tuner.js";
import { mountConversion } from "../components/conversion.js";
import { mountModeDrawer } from "../components/mode-drawer.js";
import { MODE_DRAWERS } from "../data/conversion.js";
import { OUTPUT_DRAWER, BACKEND_NAMES, DEVICES, RATE_TIERS } from "../data/output.js";
import { OUT } from "../data/scenarios.js";

// PCM output bit depth = the Output drawer's DAC bits (the dithering level) for the active backend, as applied. Omitted at
// 0 (auto-detect: the engine picks it) and on Combo (one value per sub-device).
const dacBitsRow = (be) =>
  OUTPUT_DRAWER.tabs[0].body.find((it) => it.group === be)?.rows.find((r) => r.label === "DAC bits")?.control;
const DAC_PREF = { dacr2r: "r2r", dacess: "ess" }; // Shaping's DAC type rows: HQPTuner prefs that fold the shaper lists

/**
 * Wire the output, the conversion chain and their drawers; app.conversion and app.outDrawer are set here.
 *
 * @param {object} app  the shared state (main.js)
 */
export function wireOutput(app) {
  const { bus, stages, flags } = app;
  const outFmt = {
    backend: OUTPUT_DRAWER.backend,
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
   *  A pinned rate (page tuner, while Allow pinned rates is On): the output plays it (mock), whatever the source. */
  const outFor = (run, p, sc) => {
    if (p === "idle") return { tier: null, rate: "—", rest: "", value: "—" };
    let tier, rate, bits;
    const pinned = app.pinned;
    if (p === "direct") [tier, rate, bits] = [OUT.direct.tier, OUT.direct.rate.f44, "1bit"];
    else if (pinned && RATE_TIERS.tiers[pinned.tier].family === run) {
      const t = RATE_TIERS.tiers[pinned.tier];
      [tier, rate] = [pinned.tier, `${t[pinned.fam]} ${t.unit}`];
    } else [tier, rate] = [OUT[run].tier, OUT[run].rate[sc.fam]];
    if (p !== "direct") bits = run === "sdm" ? "1bit" : pcmBits().replace(" / ", "");
    return {
      tier,
      rate,
      rest: [bits, "2ch"].filter(Boolean).join(" · "),
      value: [rate, bits, "2ch"].filter(Boolean).join(" / "),
    };
  };

  // Output: the rate picker (pins on the running band), only while Allow pinned rates is On. No mode control.
  const tuner = mountOutputTuner($("#oglass"), RATE_TIERS, {
    onPin: (pin) => {
      app.pinned = pin;
      app.conversion.refresh();
    },
    bus,
  });
  // Mock: `#mode-auto` = the daemon left in Auto ([source]) by another client; HQPTuner doesn't offer it, only reads it.
  if (flags.modeAuto) app.conv.mode = "auto";
  const conversion = mountConversion(
    {
      rs: $("#rs-body"),
      sh: $("#sh-body"),
      stages,
      bus,
      onOut: (o) => {
        tuner.set({
          run: o.run,
          tier: o.tier,
          src: app.scene.playing ? app.scene.tier : null,
          fam: app.scene.fam || "f44",
        });
        app.swLight();
        app.outDrawer?.set("omode", o.mode);
      },
      onRun: (run) => {
        setChain(run);
        app.raise();
      },
      onPath: app.onPath,
    },
    app.conv,
    outFor,
    app.scene,
  );
  app.conversion = conversion;
  conversion.setRoom(!!sizeOf(SIZE).both); // opened on 13″ (#size-13): both filters open from the start
  // DSD Processing, Resampling, Shaping: one drawer per stage, PCM out | SDM out tabs (components/mode-drawer.js). Filters and
  // shapers are live with two homes (page + drawer); the rest stage. A facade lets the page and the mode switch reach all three.
  const modeDrawer = (k, onApplied) =>
    mountModeDrawer(
      $("#body"),
      MODE_DRAWERS[k].stages.map((id) => stages.get(id)),
      MODE_DRAWERS[k],
      app.conv.values,
      {
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
  const outDrawer = mountDrawer($("#body"), stages.get("output"), OUTPUT_DRAWER, {
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
