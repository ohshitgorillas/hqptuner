// The Timing, UPnP and Behavior drawers' schemas and their Settings rail readouts. Timing and UPnP are catalog rows
// that stage like any engine setting; Behavior's pinned-rates switch is a browser preference that writes at once. A
// catalog readout follows the running value, not the staged one, and prints that option's label.

import { truthy } from "../../../lib/coerce.js";
import { schema as catalog } from "../../../store/schema.js";
import { runningValue } from "../../../store/resolve.js";
import { rowOptions } from "../../../store/faceplate/drawer.js";
import { allowPinnedRates, setAllowPinnedRates } from "../../../store/ui/faceplate.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/settings/rail.js").SettingsReadout} SettingsReadout */

const PIN_RATES_NOTE =
  "Adds the capacity to pin a specific output rate without restarting the engine. Note: this will cause certain filters (integer- or 2x-upsampling only) to produce no output when mixing rate families! That is, certain filters cannot produce output with, e.g., a pinned 44.1k-family output rate and 48k-family source material.";

/**
 * The running value of a catalog key as its options are written: a truth as "1" or "0", anything else as a string.
 *
 * @param {string} key
 * @returns {string}
 */
function runningOption(key) {
  const e = catalog[key];
  const v = runningValue(key);
  if (e && (e.widget === "checkbox" || e.bool)) return truthy(v) ? "1" : "0";
  return v === undefined ? "" : String(v);
}

/**
 * A rail readout for a catalog key: its options as a select, its value the running one.
 *
 * @param {string} key
 * @param {string} label
 * @param {boolean} [wide]
 * @returns {SettingsReadout}
 */
const keyReadout = (key, label, wide = false) => ({
  id: key,
  label,
  wide,
  get control() {
    return { type: "select", options: rowOptions(key).map((o) => ({ v: String(o.value), label: o.label })) };
  },
  value: () => runningOption(key),
});

/** @type {DrawerSchema} */
export const TIMING_DRAWER = {
  id: "timing",
  title: "Timing",
  aria: "Timing settings",
  tabs: [
    {
      id: "timing",
      label: "Timing",
      body: [{ row: { key: "idle_time" } }, { row: { key: "quick_pause" } }, { row: { key: "short_buffer" } }],
    },
  ],
};

/** @type {SettingsReadout[]} */
export const TIMING_READOUTS = [
  keyReadout("idle_time", "Engine idle time"),
  keyReadout("quick_pause", "Quick pause"),
  keyReadout("short_buffer", "Short buffer"),
];

/** @type {DrawerSchema} */
export const UPNP_DRAWER = {
  id: "upnp",
  title: "UPnP",
  aria: "UPnP settings",
  tabs: [{ id: "upnp", label: "UPnP", body: [{ row: { key: "upnp_freewheel" } }] }],
};

/** @type {SettingsReadout[]} */
export const UPNP_READOUTS = [keyReadout("upnp_freewheel", "UPnP freewheel")];

/** @type {DrawerSchema} */
export const BEHAVIOR_DRAWER = {
  id: "behavior",
  title: "Behavior",
  aria: "Behavior settings",
  tabs: [
    {
      id: "behavior",
      label: "Behavior",
      body: [
        {
          field: {
            id: "pinallow",
            label: "Allow pinned rates",
            man: [PIN_RATES_NOTE],
            options: [
              { value: "0", label: "Off" },
              { value: "1", label: "On" },
            ],
            value: () => (allowPinnedRates.value ? "1" : "0"),
            set: (v) => setAllowPinnedRates(v === "1"),
          },
        },
      ],
    },
  ],
};

/** @type {SettingsReadout[]} */
export const BEHAVIOR_READOUTS = [
  {
    id: "pinallow",
    label: "Allow pinned rates",
    control: {
      type: "seg",
      options: [
        { v: "0", label: "Off" },
        { v: "1", label: "On" },
      ],
    },
    value: () => (allowPinnedRates.value ? "1" : "0"),
  },
];
