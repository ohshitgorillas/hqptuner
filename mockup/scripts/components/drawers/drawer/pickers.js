// The device and dial control kinds: (D, {c, r, paintOpt}) → their elements. Each stages its own value; neither
// re-reads gray reasons or calls deps.on.

import { h } from "../../../lib/shell/dom.js";
import { mountDevicePicker } from "../../controls/device-picker.js";
import { mountRateDial } from "../../controls/rate-dial.js";
import { markDirty } from "./state.js";

/** @typedef {import("./state.js").Drawer} Drawer */
/** @typedef {import("./state.js").Ctl} Ctl */
/** @typedef {import("./state.js").Control} Control */
/** @typedef {import("./state.js").Devices} Devices */
/** @typedef {import("./state.js").RateTiers} RateTiers */
/** @typedef {import("./state.js").SettableEl} SettableEl */

/**
 * A device picker over deps.devices[c.kind]; a schema with a device control is mounted with devices.
 *
 * @param {Drawer} D
 * @param {Ctl} b
 * @returns {SettableEl}
 */
export function deviceCtl(D, { c: ctl }) {
  const c = /** @type {Control & { kind: string, aria: string }} */ (ctl);
  /** @type {SettableEl} */
  const el = h("div.devpick", { id: c.id, data: { kind: c.kind } });
  const dp = mountDevicePicker(el, c, /** @type {Record<string, Devices>} */ (D.devices)[c.kind], () => {
    D.vals[String(c.id)] = dp.value();
    markDirty(D, el);
  });
  D.vals[String(c.id)] = dp.value();
  el._setValue = dp.setValue;
  return el;
}

/**
 * The rate dial over deps.rateTiers; a schema with a dial is mounted with rateTiers.
 *
 * @param {Drawer} D
 * @param {Ctl} b
 * @returns {SettableEl}
 */
export function dialCtl(D, { c }) {
  /** @type {SettableEl} */
  const el = h("div.dial", { id: c.id, role: "group", "aria-label": c.aria }); // each band is its own slider (rate-dial.js)
  const rd = mountRateDial(el, /** @type {RateTiers} */ (D.rateTiers), () => {
    D.vals[String(c.id)] = rd.value();
    markDirty(D, el);
  });
  D.vals[String(c.id)] = rd.value();
  el._setValue = rd.setValue;
  return el;
}
