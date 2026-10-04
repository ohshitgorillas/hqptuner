// Engine row and meter: the speed gauge and buffer meters, the engine-row volume (and its bottom-bar home), the Source
// meter in the Source drawer and in the page's top section, everything a playback path shows, and the HF filter drawer
// (live: its rail lamp follows at once).

import { $, h } from "../lib/shell/dom.js";
import { sizeOf, SIZE } from "../lib/shell/plate.js";
import { withXref } from "../lib/controls/xref.js";
import { mountDrawer } from "../components/drawers/drawer.js";
import { mountSourceMeter } from "../components/drawers/source-meter.js";
import { mountVolume, mountVolumeBar } from "../components/shell/volume.js";
import { SOURCE_DRAWER, METER } from "../data/stages/source.js";
import { HF_DRAWER } from "../data/stages/hf.js";
import { VOLUME } from "../data/stages/volume.js";
import { PROFILES } from "../data/builders/profiles.js";
import { ENGINE, ZONES, OUT, COPY } from "../data/shell/scenarios.js";
import {
  fillLayout,
  gaugeReading,
  noStream,
  pathView,
  profileRecords,
} from "../../../hqptuner/static/model/shell/frame.js";
import { el } from "./markup.js";

/** @typedef {import("./state.js").App} App */
/** @typedef {import("../../../hqptuner/static/model/shell/frame.js").Seams} Seams */
/** @typedef {Element & { _setPlaying: (i: number | null) => void }} RateDial */

// Not in a Direct path: Direct runs nothing but Speakers (Resampling and Shaping leave the chain on DSD → DSD).
const BYPASS = ["hf", "volume", "matrix", "pipelines", "crossfeed", "loudness", "resampling", "shaping", "correction"];

/**
 * A source meter into its host at the scene's own rate (DSD at its base rate), or v1's owner copy where there is no stream.
 *
 * @param {App} app
 * @param {HTMLElement} host
 * @param {string | null} why  the no-stream line, null for a running meter
 * @param {object} opts
 */
function meterInto(app, host, why, opts) {
  if (why) host.append(h("div.mnone", {}, h("p", {}, withXref(why))));
  else
    mountSourceMeter(host, {
      ...METER,
      ...opts,
      nyquist: /** @type {number} */ (app.scene.nyquist), // a scene with a stream has its rate
      brick: app.scene.brick,
      dsdNoise: app.scene.family === "dsd",
    });
}

/**
 * The speed gauge; app.gaugeSet is set here.
 *
 * @param {App} app
 */
function wireGauge(app) {
  const gauge = { ndl: /** @type {Element} */ ($(".gauge .ndl")), val: el(".gauge .val") };
  /** Process speed gauge (model/app.js gaugeReading). */
  app.gaugeSet = (v) => {
    const g = gaugeReading(v, /** @type {Seams} */ (ZONES.speed));
    gauge.ndl.setAttribute("x2", g.x2);
    gauge.ndl.setAttribute("y2", g.y2);
    gauge.val.textContent = g.text;
    gauge.val.dataset.zone = g.zone;
  };
}

/**
 * The Source drawer's meter and the page's top section; app.paintMeter and app.paintFill are set here.
 *
 * @param {App} app
 */
function wirePaint(app) {
  const { bus } = app;
  /** Source drawer's meter. */
  app.paintMeter = () => {
    if (!app.meterHost) return;
    app.meterHost.replaceChildren();
    meterInto(app, app.meterHost, noStream(app.scene, app.mxApplied, COPY), {});
    app.paintFill();
  };
  /**
   * The page's top section (the fill): Source spectrum and / or the Matrix engine section.
   *   Top of page (Visual settings → Layout, vfill): auto | profile | spectrum.
   *   auto      both: the spectrum takes the fill, the Matrix section folds to its header line (profile picker + Profile
   *             builder) while the matrix engine is engaged, so a profile is one tap away (A/B flat vs EQ'd).
   *   profile   the Matrix section at full size, no spectrum. Bypassed, there is no profile: the spectrum takes the fill.
   *   spectrum  the spectrum, no Matrix section.
   * Bypassed, no Matrix section either way (engaged stages only).
   * Spectrum: full at 13″, slim (strip + bars, no heads or table) at 10.2″ / 11″ (lib/plate.js SIZES meter). Same no-stream
   * lines as the Source drawer's (DSD needs the matrix engine engaged).
   */
  const pmSec = el(".sec.psrc"),
    pmHost = el("#pmeter");
  bus.on("vfill", (d) => {
    app.fillPref = d;
    app.paintFill();
  });
  app.paintFill = () => {
    if (!app.fillReady) return;
    const fill = fillLayout(app.mxApplied, app.fillPref, app.scene, COPY);
    const flat = profileRecords(PROFILES, app.mprof.value).some((r) => "flat" in r && r.flat); // mock: the plot of a profile that changes nothing
    // Matrix section: the top (fill) | folded to its header line | hidden (bypassed, or Spectrum).
    const mxSection = app.mxSection;
    const mxHead = el(":scope > .sh", mxSection),
      mxTwo = el(":scope > .two", mxSection);
    mxSection.hidden = !(fill.profile || fill.fold);
    mxSection.classList.toggle("fill", fill.profile);
    mxSection.classList.toggle("mxfold", fill.fold);
    if (fill.fold) mxHead.append(app.mxPick);
    else el(".mstack", mxSection).prepend(app.mxPick);
    mxTwo.hidden = fill.fold;
    app.matrixPlot.flat = flat;
    // Source spectrum: whenever the Matrix section isn't the top.
    pmSec.classList.toggle("slim", sizeOf(SIZE).meter === "slim");
    pmSec.hidden = !fill.show;
    if (fill.key !== app.pmKey) {
      app.pmKey = fill.key;
      pmHost.replaceChildren(); // a running meter stops once its block leaves the host
      if (fill.show) meterInto(app, pmHost, fill.why, { compact: true });
    }
    bus.emit("relayout"); // the page refits (conversion.js fit), the matrix plot redraws
  };
}

/**
 * Everything that shows playback follows the path conversion.js reports; app.onPath is set here.
 *
 * @param {App} app
 */
function wirePath(app) {
  const { bus, stages } = app;
  const bufs = /** @type {HTMLElement[]} */ ([...document.querySelectorAll(".engine .meter")]);
  app.onPath = (p, run) => {
    const zones = { buffer: /** @type {Seams} */ (ZONES.buffer) };
    const view = pathView(p, run, app.scene, { engine: ENGINE, zones, out: OUT });
    app.gaugeSet(view.speed);
    bufs.forEach((m, i) => {
      const { v, zone } = view.buffers[i];
      el(".fill", m).style.width = v + "%";
      el(".mv", m).textContent = v + "%";
      m.dataset.zone = zone;
    });
    el(".v", stages.get("source")).textContent = view.source;
    for (const id of BYPASS) stages.get(id).classList.toggle("byp", view.direct);
    app.vol?.setDirect(view.direct, COPY.directVolume);
    app.spk?.direct(view.direct, COPY.directSpeakers);
    /** @type {RateDial | null} */ ($("#drawer-output .dial"))?._setPlaying(view.tier);
    app.paintMeter();
    app.raise();
    bus.emit("sigpath", { p, stage: app.scene.stage || "1x" }); // Settings → Signal path
    bus.emit("relayout"); // rail wire redraws (taps follow the lamps)
  };
}

/**
 * The engine-row volume and its bottom-bar home, the Source drawer and the HF filter drawer; app.levelBus, app.vol and
 * app.source are set here.
 *
 * @param {App} app
 */
function wireRowAndDrawers(app) {
  const { stages, plate } = app;
  // Engine-row volume; live level → Range bar needle.
  app.levelBus = new EventTarget();
  app.vol = mountVolume(
    plate,
    {
      down: /** @type {HTMLButtonElement} */ (el("#vol-dn")),
      readout: /** @type {HTMLButtonElement} */ (el("#vol-rd")),
      up: /** @type {HTMLButtonElement} */ (el("#vol-up")),
    },
    stages.get("volume"),
    { cfg: VOLUME, bus: app.levelBus, loud: app.volumeRange.loudness },
  );
  mountVolumeBar(el("#vbar"), app.vol, { cfg: VOLUME, bus: app.levelBus, loud: app.volumeRange.loudness }); // bottom-bar home: the Setting Switcher's Volume target

  app.source = mountDrawer(el("#body"), stages.get("source"), SOURCE_DRAWER, {
    blocks: {
      meter: (host) => {
        app.meterHost = host;
        app.paintMeter();
      },
    },
  });
  // HF filter: the filter is live, so the rail lamp and value follow it at once (engine name, or Inactive at none).
  // Setting the filter by hand switches auto-pilot off (backend rule, architecture §9.3).
  const hfStage = stages.get("hf");
  const hf = mountDrawer(el("#body"), hfStage, HF_DRAWER, {
    on: {
      hfsel: (v) => {
        const on = v !== "none";
        app.lamp(hfStage, on, on ? v : "Inactive");
        hf.set("hfauto", "0");
        app.liveNow.autopilot = "0";
      },
      hfauto: (v) => {
        app.liveNow.autopilot = v;
      },
    },
  });
  hf.setOpen(false);
}

/**
 * Wire the engine row, the source meters, the playback path and the HF filter; app.gaugeSet, app.paintMeter,
 * app.paintFill, app.onPath, app.levelBus, app.vol and app.source are set here.
 *
 * @param {App} app  the shared state (app/state.js)
 */
export function wireEngine(app) {
  wireGauge(app);
  wirePaint(app);
  wirePath(app);
  wireRowAndDrawers(app);
}
