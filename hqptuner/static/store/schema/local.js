// The drawers' local controls: rows no lane writes, each declared once here by id the way the catalog
// (store/schema.js) declares an engine control, and named by the drawer that draws it. A local is a browser pref or a
// switch over a store, never an engine field: the HF filter auto-pilot over the backend's own flag, the Shaping
// drawer's DAC type and DAC chip over their browser prefs, Fixed volume as one choice over the two catalog settings it
// stages, the Behavior and Visual settings drawers' browser prefs, and the Hardware drawer's all-stations switch over
// its store. Not merged into `schema`, so nothing that walks the catalog sees a local.
//
// Fixed volume's label and paragraphs come from the settings metadata, read when the drawer draws, since the metadata
// arrives after this module loads; the strings written here are the ones the metadata does not hold.

import { autopilot, metering, setAutopilot } from "../actions.js";
import { advisor } from "../signals.js";
import {
  BOTTOM_BARS,
  DAC_CHIPS,
  DAC_TYPES,
  TOP_OF_PAGE,
  allowPinnedRates,
  apodLight,
  bottomBar,
  dacChip,
  dacType,
  displayFormat,
  plainNames,
  setAllowPinnedRates,
  setApodLight,
  setBottomBar,
  setDacChip,
  setDacType,
  setDisplayFormat,
  setPlainNames,
  setTopOfPage,
  topOfPage,
} from "../ui/prefs.js";
import { applyDyslexic, dyslexic } from "../ui/theme.js";
import { allStations, setAllStations } from "../faceplate/settings/hardware.js";
import { fixedMode, pickFixedMode } from "../faceplate/drawers/volume.js";
import { DISPLAY_FORMATS } from "../../model/shell/plate.js";
import { describe } from "../prose.js";
import { schema as catalog } from "../schema.js";
import { ISO_LEVELS } from "./options.js";

/** @typedef {import("../faceplate/drawer.js").FieldSpec} FieldSpec */
/** @typedef {import("../faceplate/drawer.js").ChoiceSpec} ChoiceSpec */
/** @typedef {import("../faceplate/drawer.js").FieldOption} FieldOption */

const AUTOPILOT_NOTE =
  "Automatically engages and disengages the high-frequency filter 20k to 50k settings as needed for hi-res content. Setting the filter manually disables this setting.";
const NO_METERING = "Metering is disabled; HQPTuner can't determine optimal settings.";
const PIN_RATES_NOTE =
  "Adds the capacity to pin a specific output rate without restarting the engine. Note: this will cause certain filters (integer- or 2x-upsampling only) to produce no output when mixing rate families! That is, certain filters cannot produce output with, e.g., a pinned 44.1k-family output rate and 48k-family source material.";

/** The Visual settings' paragraphs. */
const VISUAL_MAN = {
  format:
    "The format the plate is laid out at. Auto picks the largest of the three that fits the screen: Expanded suits 13-inch tablets, Normal 11-inch, and Compact an iPad Mini and other small tablets.",
  optStyle:
    "This feature reduces the mental load required to parse the signal chain options by stating each selection's properties in plain English. Items are categorized into families, optionally into variants, and listed by their distinguishing properties.",
  apod: 'The Apodizing light flashes to indicate apodizing events. Brighter flashes indicate higher event density. When "Uncorrected events", half-corrected events (e.g., from a half-apodizing filter) occur at half-brightness.',
  fill: "What the top of the page shows. Auto shows both: the Source spectrum, with the matrix profile picker on one line above it. Matrix profile shows the matrix engine at full size, with its response plot; Spectrum shows the spectrum alone. With the matrix engine bypassed, the spectrum shows either way.",
  bottom:
    "Show the Setting Switcher for easy A/B comparisons (pick Volume from its dropdown for a volume slider), or hide the bottom bar entirely.",
  dyslexic: "Use a dyslexic-friendly font (Atkinson Hyperlegible) for non-monospace text.",
};

/** @type {FieldOption[]} */
const OFF_ON = [
  { value: "0", label: "Off" },
  { value: "1", label: "On" },
];

/**
 * A row's options from the values its preference accepts, in that order, each labelled from `labels`.
 *
 * @param {string[]} values
 * @param {Record<string, string>} labels
 * @returns {FieldOption[]}
 */
const labelled = (values, labels) => values.map((value) => ({ value, label: labels[value] }));

/** @param {boolean} on */
const bit = (on) => (on ? "1" : "0");

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
  options: OFF_ON,
  value: () => bit(autopilot.value),
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
  options: labelled(DAC_TYPES, { other: "Other", r2r: "R-2R" }),
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
  options: labelled(DAC_CHIPS, { other: "Other", ess: "ESS Sabre" }),
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
  writes: ["fixed_volume_enabled", "optimal_iso"],
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

/** @type {FieldSpec} */
const PINALLOW = {
  id: "pinallow",
  label: "Allow pinned rates",
  man: [PIN_RATES_NOTE],
  options: OFF_ON,
  value: () => bit(allowPinnedRates.value),
  set: (v) => setAllowPinnedRates(v === "1"),
};

/** The all-stations switch, drawn under each Hardware tab's id: where the next apply lands, never an edit. */
const ALL_STATIONS = {
  label: "Apply to all stations",
  /** @type {string[]} */
  man: [],
  options: OFF_ON,
  value: () => bit(allStations.value),
  set: (/** @type {string} */ v) => setAllStations(v === "1"),
};

/** @type {FieldSpec} */
const HWALLCPU = { id: "hwallcpu", ...ALL_STATIONS };

/** @type {FieldSpec} */
const HWALLGPU = { id: "hwallgpu", ...ALL_STATIONS };

/** @type {FieldSpec} */
const VFORMAT = {
  id: "vformat",
  label: "Display",
  man: [VISUAL_MAN.format],
  options: labelled(DISPLAY_FORMATS, { auto: "Auto", expanded: "Expanded", normal: "Normal", compact: "Compact" }),
  value: () => displayFormat.value,
  set: setDisplayFormat,
};

/** @type {FieldSpec} */
const VSTYLE = {
  id: "vstyle",
  label: "Option style",
  man: [VISUAL_MAN.optStyle],
  options: [
    { value: "standard", label: "Standard" },
    { value: "simplified", label: "Simplified" },
  ],
  value: () => (plainNames.value ? "simplified" : "standard"),
  set: (v) => setPlainNames(v === "simplified"),
};

/** @type {FieldSpec} */
const VAPOD = {
  id: "vapod",
  label: "Apodizing indicator",
  man: [VISUAL_MAN.apod],
  options: [
    { value: "all", label: "All events" },
    { value: "uncorrected", label: "Uncorrected events" },
  ],
  value: () => apodLight.value,
  set: setApodLight,
};

/** @type {FieldSpec} */
const VDYS = {
  id: "vdys",
  label: "Dyslexic font",
  man: [VISUAL_MAN.dyslexic],
  options: OFF_ON,
  value: () => bit(dyslexic.value),
  set: (v) => applyDyslexic(v === "1"),
};

/** @type {FieldSpec} */
const VFILL = {
  id: "vfill",
  label: "Top of page",
  man: [VISUAL_MAN.fill],
  options: labelled(TOP_OF_PAGE, { auto: "Auto", profile: "Matrix profile", spectrum: "Spectrum" }),
  value: () => topOfPage.value,
  set: setTopOfPage,
};

/** @type {FieldSpec} */
const VBOTTOM = {
  id: "vbottom",
  label: "Bottom bar",
  man: [VISUAL_MAN.bottom],
  options: labelled(BOTTOM_BARS, { switcher: "Setting Switcher", none: "None" }),
  value: () => bottomBar.value,
  set: setBottomBar,
};

/** Every local control, by id. */
export const local = {
  autopilot: AUTOPILOT,
  dactype: DACTYPE,
  dacchip: DACCHIP,
  fixed_mode: FIXED_MODE,
  pinallow: PINALLOW,
  hwallcpu: HWALLCPU,
  hwallgpu: HWALLGPU,
  vformat: VFORMAT,
  vstyle: VSTYLE,
  vapod: VAPOD,
  vdys: VDYS,
  vfill: VFILL,
  vbottom: VBOTTOM,
};
