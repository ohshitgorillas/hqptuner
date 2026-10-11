// The drawers' local controls: rows no lane writes, each declared once here by id the way the catalog
// (store/schema.js) declares an engine control, and named by the drawer that draws it. A local is a browser pref or a
// switch over a store, never an engine field: the HF filter auto-pilot over the backend's own flag, the Shaping
// drawer's DAC type and DAC chip over their browser prefs, and Fixed volume as one choice over the two catalog
// settings it stages. Not merged into `schema`, so nothing that walks the catalog sees a local.
//
// Fixed volume's label and paragraphs come from the settings metadata, read when the drawer draws, since the metadata
// arrives after this module loads; the strings written here are the ones the metadata does not hold.

import { autopilot, metering, setAutopilot } from "../actions.js";
import { advisor } from "../signals.js";
import { dacChip, dacType, setDacChip, setDacType } from "../ui/prefs.js";
import { fixedMode, pickFixedMode } from "../faceplate/drawers/volume.js";
import { describe } from "../prose.js";
import { schema as catalog } from "../schema.js";
import { ISO_LEVELS } from "./options.js";

/** @typedef {import("../faceplate/drawer.js").FieldSpec} FieldSpec */
/** @typedef {import("../faceplate/drawer.js").ChoiceSpec} ChoiceSpec */

const AUTOPILOT_NOTE =
  "Automatically engages and disengages the high-frequency filter 20k to 50k settings as needed for hi-res content. Setting the filter manually disables this setting.";
const NO_METERING = "Metering is disabled; HQPTuner can't determine optimal settings.";

/**
 * A setting's label and paragraph from the settings metadata.
 *
 * @param {string} key
 */
const prose = (key) => describe(catalog[key], key);

/** Cache for the Fixed volume paragraph list, keyed by the tooltip text it was built from. */
let fixedMan = { tip: "", paras: [""] };

/** The Fixed level tooltip as a one-paragraph list; the same array is returned while the tooltip text is unchanged. */
function fixedParagraphs() {
  const tip = prose("fixed_volume_enabled").tooltip;
  if (tip !== fixedMan.tip) fixedMan = { tip, paras: [tip] };
  return fixedMan.paras;
}

/** @type {FieldSpec} */
const AUTOPILOT = {
  id: "autopilot",
  label: "HF filter auto-pilot",
  man: [AUTOPILOT_NOTE],
  options: [
    { value: "0", label: "Off" },
    { value: "1", label: "On" },
  ],
  value: () => (autopilot.value ? "1" : "0"),
  set: (v) => setAutopilot(v === "1"),
  gray: () => (metering.value ? "" : NO_METERING),
  when: () => advisor.value,
};

/** @type {FieldSpec} */
const DACTYPE = {
  id: "dactype",
  label: "DAC type",
  man: [
    "Also when a suitable noise-shaper, such as LNS15, NS9 or NS5 is used in combination with high output rates, linearity errors inherent to all R2R DACs can be corrected. This will lower distortion of especially low level signals and reduce zero-crossing distortions.",
    "R-2R collapses the Additive family in the dither list.",
  ],
  options: [
    { value: "other", label: "Other" },
    { value: "r2r", label: "R-2R" },
  ],
  value: () => dacType.value,
  set: setDacType,
};

/** @type {FieldSpec} */
const DACCHIP = {
  id: "dacchip",
  label: "DAC chip",
  man: [
    "For ESS Sabre based DACs, fifth order modulators are recommended. For most other DACs, seventh order modulators are optimal.",
    "ESS Sabre collapses the seventh order variants in the modulator list.",
  ],
  options: [
    { value: "other", label: "Other" },
    { value: "ess", label: "ESS Sabre" },
  ],
  value: () => dacChip.value,
  set: setDacChip,
};

/** @type {ChoiceSpec} */
const FIXED_MODE = {
  id: "fixed_mode",
  get label() {
    return prose("fixed_volume_enabled").label;
  },
  get man() {
    return fixedParagraphs();
  },
  value: fixedMode,
  pick: pickFixedMode,
  lines: [
    { v: "off", label: "Off", man: "Volume is adjustable live." },
    {
      v: "manual",
      label: "Manual",
      get man() {
        return prose("fixed_volume").tooltip;
      },
      key: "fixed_volume",
    },
    {
      v: "auto",
      label: "Auto",
      sub: catalog.optimal_iso?.sublabel,
      get man() {
        return prose("optimal_iso").tooltip;
      },
      key: "optimal_iso",
      options: ISO_LEVELS.filter((o) => o.value !== "0"),
    },
  ],
};

/** Every local control, by id. */
export const local = {
  autopilot: AUTOPILOT,
  dactype: DACTYPE,
  dacchip: DACCHIP,
  fixed_mode: FIXED_MODE,
};
