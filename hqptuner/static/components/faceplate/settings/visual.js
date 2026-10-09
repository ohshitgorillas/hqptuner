// The Visual settings drawer's schema and its Settings rail readouts: HQPTuner's own browser preferences, each a field
// that writes at once and never stages. Display holds the spectrum-style and ghost picks, the option-style and apodizing-indicator
// switches, the spectrum delay box, the font switch, then the accent block; Layout the top-of-page and bottom-bar picks,
// then the block hiding chain stages.

import {
  apodLight,
  plainNames,
  setApodLight,
  setPlainNames,
  setSpectrumGhost,
  setSpectrumStyle,
  spectrumGhost,
  spectrumStyle,
} from "../../../store/ui/prefs.js";
import { spectrumOffset } from "../../../store/meter/delay.js";
import { accent, accentHex, applyDyslexic, dyslexic } from "../../../store/ui/theme.js";
import { bottomBar, hiddenStages, setBottomBar, setTopOfPage, topOfPage } from "../../../store/ui/faceplate.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/settings/rail.js").SettingsReadout} SettingsReadout */
/** @typedef {{ v: string, label: string }} Opt */

const MAN = {
  spec: "Adjust how the spectrum is drawn.",
  ghost: "Adjust how the faint line above the trace moves.",
  optStyle:
    "This feature reduces the mental load required to parse the signal chain options by stating each selection's properties in plain English. Items are categorized into families, optionally into variants, and listed by their distinguishing properties.",
  apod: 'The Apodizing light flashes to indicate apodizing events. Brighter flashes indicate higher event density. When "Uncorrected events", half-corrected events (e.g., from a half-apodizing filter) occur at half-brightness.',
  fill: "What the top of the page shows. Auto shows both: the Source spectrum, with the matrix profile picker on one line above it. Matrix profile shows the matrix engine at full size, with its response plot; Spectrum shows the spectrum alone. With the matrix engine bypassed, the spectrum shows either way.",
  bottom:
    "Show the Setting Switcher for easy A/B comparisons (pick Volume from its dropdown for a volume slider), or hide the bottom bar entirely.",
  dyslexic: "Use a dyslexic-friendly font (Atkinson Hyperlegible) for non-monospace text.",
};

/** @type {Opt[]} */
const SPECTRA = [
  { v: "trace", label: "Trace" },
  { v: "bars", label: "Bars" },
  { v: "soft", label: "Soft bars" },
  { v: "ridges", label: "Ridges" },
  { v: "aurora", label: "Aurora" },
];
/** @type {Opt[]} */
const GHOSTS = [
  { v: "fall", label: "Fall" },
  { v: "average", label: "Average" },
  { v: "fade", label: "Fade" },
];
/** @type {Opt[]} */
const OFF_ON = [
  { v: "0", label: "Off" },
  { v: "1", label: "On" },
];
/** @type {Opt[]} */
const STYLES = [
  { v: "standard", label: "Standard" },
  { v: "simplified", label: "Simplified" },
];
/** @type {Opt[]} */
const APOD = [
  { v: "all", label: "All events" },
  { v: "uncorrected", label: "Uncorrected events" },
];
/** @type {Opt[]} */
const FILLS = [
  { v: "auto", label: "Auto" },
  { v: "profile", label: "Matrix profile" },
  { v: "spectrum", label: "Spectrum" },
];
/** @type {Opt[]} */
const BOTTOMS = [
  { v: "switcher", label: "Setting Switcher" },
  { v: "none", label: "None" },
];
/** @type {Opt[]} */
const HIDEABLE = [
  { v: "dsd", label: "DSD Processing" },
  { v: "speakers", label: "Speakers" },
  { v: "crossfeed", label: "Crossfeed" },
  { v: "loudness", label: "Loudness" },
  { v: "correction", label: "DAC correction" },
];

/** @param {Opt[]} opts */
const fieldOptions = (opts) => opts.map(({ v, label }) => ({ value: v, label }));

/** @param {boolean} on */
const bit = (on) => (on ? "1" : "0");

const specValue = () => spectrumStyle.value;
const ghostValue = () => spectrumGhost.value;
const styleValue = () => (plainNames.value ? "simplified" : "standard");
const apodValue = () => apodLight.value;
const dysValue = () => bit(dyslexic.value);
const fillValue = () => topOfPage.value;
const bottomValue = () => bottomBar.value;

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
        {
          field: {
            id: "vspec",
            label: "Spectrum style",
            man: [MAN.spec],
            options: fieldOptions(SPECTRA),
            value: specValue,
            set: setSpectrumStyle,
          },
        },
        {
          field: {
            id: "vghost",
            label: "Ghost",
            man: [MAN.ghost],
            options: fieldOptions(GHOSTS),
            value: ghostValue,
            set: setSpectrumGhost,
          },
        },
        {
          field: {
            id: "vstyle",
            label: "Option style",
            man: [MAN.optStyle],
            options: fieldOptions(STYLES),
            value: styleValue,
            set: (v) => setPlainNames(v === "simplified"),
          },
        },
        {
          field: {
            id: "vapod",
            label: "Apodizing indicator",
            man: [MAN.apod],
            options: fieldOptions(APOD),
            value: apodValue,
            set: setApodLight,
          },
        },
        { block: "delay" },
        {
          field: {
            id: "vdys",
            label: "Dyslexic font",
            man: [MAN.dyslexic],
            options: fieldOptions(OFF_ON),
            value: dysValue,
            set: (v) => applyDyslexic(v === "1"),
          },
        },
        { block: "accent" },
      ],
    },
    {
      id: "layout",
      label: "Layout",
      body: [
        {
          field: {
            id: "vfill",
            label: "Top of page",
            man: [MAN.fill],
            options: fieldOptions(FILLS),
            value: fillValue,
            set: setTopOfPage,
          },
        },
        {
          field: {
            id: "vbottom",
            label: "Bottom bar",
            man: [MAN.bottom],
            options: fieldOptions(BOTTOMS),
            value: bottomValue,
            set: setBottomBar,
          },
        },
        { block: "hide" },
      ],
    },
  ],
};

/** @type {readonly SettingsReadout[]} */
export const VISUAL_READOUTS = [
  { id: "vspec", label: "Spectrum style", control: { type: "seg", options: SPECTRA }, value: specValue },
  { id: "vghost", label: "Ghost", control: { type: "seg", options: GHOSTS }, value: ghostValue },
  { id: "vstyle", label: "Option style", control: { type: "seg", options: STYLES }, value: styleValue },
  { id: "vapod", label: "Apodizing indicator", control: { type: "seg", options: APOD }, value: apodValue },
  {
    id: "vdelay",
    label: "Spectrum delay",
    control: { type: "number", unit: "s" },
    value: () => String(spectrumOffset.value),
  },
  { id: "vdys", label: "Dyslexic font", control: { type: "seg", options: OFF_ON }, value: dysValue },
  { id: "vacc", label: "Accent color", control: { type: "accent" }, value: () => accentHex.value || accent.value },
  { id: "vfill", label: "Top of page", control: { type: "seg", options: FILLS }, value: fillValue },
  { id: "vbottom", label: "Bottom bar", control: { type: "seg", options: BOTTOMS }, value: bottomValue },
  {
    id: "vhide",
    label: "Hidden",
    wide: true,
    control: { type: "toggles", options: HIDEABLE },
    value: () => hiddenStages.value.join(","),
  },
];
