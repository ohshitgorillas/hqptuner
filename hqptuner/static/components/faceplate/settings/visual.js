// The Visual settings drawer's schema and its Settings rail readouts: HQPTuner's own browser preferences, each a field
// that writes at once and never stages, declared as a local control (store/schema/local.js). Two tabs: Display, the
// plate's look, and Layout, what the page shows and which chain stages it hides.

import { hiddenStages } from "../../../store/ui/prefs.js";
import { spectrumOffset } from "../../../store/meter/delay.js";
import { accent, accentHex } from "../../../store/ui/theme.js";
import { local } from "../../../store/schema/local.js";
import { fieldReadout } from "./readouts.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/settings/rail.js").SettingsReadout} SettingsReadout */
/** @typedef {{ v: string, label: string }} Opt */

/** @type {Opt[]} */
const HIDEABLE = [
  { v: "dsd", label: "DSD Processing" },
  { v: "speakers", label: "Speakers" },
  { v: "crossfeed", label: "Crossfeed" },
  { v: "loudness", label: "Loudness" },
  { v: "correction", label: "DAC correction" },
];

/** @type {DrawerSchema} */
export const VISUAL_DRAWER = {
  id: "visual",
  title: "Visual settings",
  aria: "Visual settings",
  tabs: [
    {
      id: "display",
      label: "Display",
      body: [
        { field: local.vformat },
        { field: local.vstyle },
        { field: local.vapod },
        { block: "delay" },
        { field: local.vdys },
        { block: "accent" },
      ],
    },
    {
      id: "layout",
      label: "Layout",
      body: [{ field: local.vfill }, { field: local.vbottom }, { block: "hide" }],
    },
  ],
};

/** @type {readonly SettingsReadout[]} */
export const VISUAL_READOUTS = [
  fieldReadout(local.vformat),
  fieldReadout(local.vstyle),
  fieldReadout(local.vapod),
  {
    id: "vdelay",
    label: "Spectrum delay",
    control: { type: "number", unit: "s" },
    value: () => String(spectrumOffset.value),
  },
  fieldReadout(local.vdys),
  { id: "vacc", label: "Accent color", control: { type: "accent" }, value: () => accentHex.value || accent.value },
  fieldReadout(local.vfill),
  fieldReadout(local.vbottom),
  {
    id: "vhide",
    label: "Hidden",
    wide: true,
    control: { type: "toggles", options: HIDEABLE },
    value: () => hiddenStages.value.join(","),
  },
];
