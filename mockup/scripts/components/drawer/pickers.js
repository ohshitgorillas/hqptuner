// The device and dial control kinds: (D, {c, r, paintOpt}) → their elements. Each stages its own value; neither
// re-reads gray reasons or calls deps.on.

import { h } from "../../lib/dom.js";
import { mountDevicePicker } from "../device-picker.js";
import { mountRateDial } from "../rate-dial.js";
import { markDirty } from "./state.js";

/** A device picker over deps.devices[c.kind]. */
export function deviceCtl(D, { c }) {
  const el = h("div.devpick", { id: c.id, data: { kind: c.kind } });
  const dp = mountDevicePicker(el, c, D.devices[c.kind], () => {
    D.vals[c.id] = dp.value();
    markDirty(D, el);
  });
  D.vals[c.id] = dp.value();
  el._setValue = dp.setValue;
  return el;
}

/** The rate dial over deps.rateTiers. */
export function dialCtl(D, { c }) {
  const el = h("div.dial", { id: c.id, role: "group", "aria-label": c.aria }); // each band is its own slider (rate-dial.js)
  const rd = mountRateDial(el, D.rateTiers, () => {
    D.vals[c.id] = rd.value();
    markDirty(D, el);
  });
  D.vals[c.id] = rd.value();
  el._setValue = rd.setValue;
  return el;
}
