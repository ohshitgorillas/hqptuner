// Volume and loudness: the Loudness rail value that follows the live level, and the Volume drawer (Fixed volume, Range).

import { xrefGo } from "../lib/controls/xref.js";
import { shelfScale } from "../model/gauges/shelf.js";
import { mountDrawer } from "../components/drawers/drawer.js";
import { mountVolumeRange } from "../components/drawers/volume-range.js";
import { VOLUME, VOLUME_DRAWER } from "../data/stages/volume.js";
import { percentApplied } from "../model/gauges/loudness.js";
import { el } from "./markup.js";

/** @typedef {import("./state.js").App} App */
/** @typedef {import("./state.js").Volume} Volume */

/**
 * Wire the Loudness rail value and the Volume drawer; app.loudValue is set here.
 *
 * @param {App} app  the shared state (app/state.js)
 */
export function wireVolume(app) {
  const { stages } = app;
  // Loudness rail value: share of the maximum shelving applied at the live volume (v1 eqlab shelfScale): full at/below the
  // range's lower bound, none at/above its upper bound, linear between. Owner copy: `x% applied`.
  // loud.on = loudness in effect (engaged AND the matrix engine running); app.loudEngaged = its own gate. Bypassed matrix:
  // the value reads what is applied, 0% (dependents follow the matrix bypass).
  const loud = app.volumeRange.loudness;
  app.loudValue = (v) => {
    el(".v", stages.get("loudness")).textContent = app.loudEngaged
      ? `${percentApplied(loud.on ? shelfScale(v, loud.low, loud.high) : 0)}% applied`
      : "Off";
  };
  app.levelBus.addEventListener("level", (e) => {
    app.level = /** @type {CustomEvent<number>} */ (e).detail;
    app.loudValue(app.level);
  });
  app.loudValue(VOLUME.value);

  const volDrawer = mountDrawer(el("#body"), stages.get("volume"), VOLUME_DRAWER, {
    blocks: { range: (host, ctx) => mountVolumeRange(host, app.volumeRange, ctx, app.levelBus) },
    // Fixed volume is a restart row: the readouts and ± follow it on Apply.
    onApply: (v) => {
      app.fixedMode = v.vfixmode;
      /** @type {Volume} */ (app.vol).setFixed(v.vfixmode, v.vlevel, v.viso);
    },
    on: {
      vadapt: (v) => {
        app.liveNow.adaptive = v;
      },
    }, // live lane
  });
  volDrawer.setOpen(false);
  xrefGo("volume-level", () => volDrawer.showTab("level")); // Fixed volume (same drawer)
  xrefGo("volume-range", () => volDrawer.showTab("range")); // Min / Max (same drawer)
}
