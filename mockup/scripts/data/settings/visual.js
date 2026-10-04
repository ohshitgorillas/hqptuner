// Visual settings: HQPTuner client prefs: apply at once, never stage.
// Mock state: every visual pref at v1's default but the accent (v2 amber).

import { OFF_ON } from "./common.js";

const MAN = {
  showDesc:
    "Show the description from the manual beside each setting. Disabling this converts those descriptions to hover tips.",
  keepOpt: "Keep filter and DSD source option descriptions when setting descriptions are hidden",
  // v1 narrowbar Stages.js OPTION_STYLE_TIP (owner copy), verbatim.
  optStyle:
    "This feature reduces the mental load required to parse the signal chain options by stating each selection's properties in plain English. Items are categorized into families, optionally into variants, and listed by their distinguishing properties.",
  apod: 'The Apodizing light flashes to indicate apodizing events. Brighter flashes indicate higher event density. When "Uncorrected events", half-corrected events (e.g., from a half-apodizing filter) occur at half-brightness.',
  // DRAFT (agent): the page's top section (main.js paintFill).
  fill: "What the top of the page shows. Auto shows both: the Source spectrum, with the matrix profile picker on one line above it. Matrix profile shows the matrix engine at full size, with its response plot; Spectrum shows the spectrum alone. With the matrix engine bypassed, the spectrum shows either way.",
  bottom:
    "Show the Setting Switcher for easy A/B comparisons (pick Volume from its dropdown for a volume slider), or hide the bottom bar entirely.", // DRAFT (agent): the owner's line named a Volume bar option that is now a Setting Switcher target
  accent: "Set the accent color of HQPTuner.", // owner copy
  hideSpk: "Hide the stages you don't use from the signal chain. Speakers is primarily for surround sound setups.", // owner copy, reworded for v2 (four stages, not just Speakers)
  dyslexic: "Use a dyslexic-friendly font (Atkinson Hyperlegible) for non-monospace text.",
};

const ON_OFF = [
  { v: "1", label: "On" },
  { v: "0", label: "Off" },
]; // default leftmost where the default is On

// v1 theme.js presets (labels + hex), amber = the v2 token. Custom hex overrides the preset until a swatch is picked again.
// Order: default leftmost: amber first, then v1's order.
export const ACCENTS = [
  { v: "amber", label: "Amber", hex: "#e9a63c" },
  { v: "blue", label: "Blue", hex: "#4f9dde" },
  { v: "green", label: "Phosphor green", hex: "#3fe0a0" },
  { v: "violet", label: "Violet", hex: "#a78bfa" },
];

// Two tabs: Display | Layout.
// Stages that can be hidden from the chain rail: DSD Processing, Speakers, Crossfeed, Loudness, DAC correction.
export const HIDEABLE = [
  { v: "dsd", label: "DSD Processing" },
  { v: "speakers", label: "Speakers" },
  { v: "crossfeed", label: "Crossfeed" },
  { v: "loudness", label: "Loudness" },
  { v: "correction", label: "DAC correction" },
];

/** @type {import('../stages/output.js').DrawerSchema} */
export const VISUAL_DRAWER = {
  id: "visual",
  title: "Visual settings",
  aria: "Visual settings",
  restart: false,
  tabs: [
    {
      id: "display",
      label: "Display",
      body: [
        {
          row: {
            label: "Setting descriptions",
            live: true,
            man: MAN.showDesc,
            control: { type: "seg", id: "vdesc", aria: "Setting descriptions", value: "1", options: ON_OFF },
          },
        },
        {
          row: {
            label: "Option descriptions",
            live: true,
            man: MAN.keepOpt,
            // v1: live only while Setting descriptions is off (the master forces them on); reads On meanwhile.
            control: {
              type: "seg",
              id: "vopt",
              aria: "Option descriptions",
              value: "1",
              options: ON_OFF,
              gray: (v) => (v.vdesc === "1" ? " " : ""),
            },
          },
        },
        // Option style (Display): v1's Standard | Simplified (narrow bar). Simplified = the plain titles the
        // mock shows; Standard = engine names. Mock acts on it (every chain select).
        {
          row: {
            label: "Option style",
            live: true,
            man: MAN.optStyle,
            control: {
              type: "seg",
              id: "vstyle",
              aria: "Option style",
              value: "simplified",
              options: [
                { v: "standard", label: "Standard" },
                { v: "simplified", label: "Simplified" },
              ],
            },
          },
        },
        // The lamp is permanent; the setting only picks what it flashes for. Two options → a seg.
        {
          row: {
            label: "Apodizing indicator",
            live: true,
            man: MAN.apod,
            control: {
              type: "seg",
              id: "vapod",
              aria: "Apodizing indicator",
              value: "all",
              options: [
                { v: "all", label: "All events" },
                { v: "uncorrected", label: "Uncorrected events" },
              ],
            },
          },
        },
        {
          row: {
            label: "Dyslexic font",
            live: true,
            man: MAN.dyslexic,
            control: { type: "seg", id: "vdys", aria: "Dyslexic font", value: "0", options: OFF_ON },
          },
        },
        {
          row: {
            label: "Accent color",
            live: true,
            man: MAN.accent,
            control: { type: "accent", id: "vacc", aria: "Accent color", value: "amber", options: ACCENTS },
          },
        },
      ],
    },
    {
      id: "layout",
      label: "Layout",
      body: [
        // Top of page: Auto (both: the spectrum, the Matrix section folded to its header line) | Matrix profile (the Matrix
        // section alone) | Spectrum (the spectrum alone). Label and copy DRAFT.
        {
          row: {
            label: "Top of page",
            live: true,
            man: MAN.fill,
            control: {
              type: "seg",
              id: "vfill",
              aria: "Top of page",
              value: "auto",
              options: [
                { v: "auto", label: "Auto" },
                { v: "profile", label: "Matrix profile" },
                { v: "spectrum", label: "Spectrum" },
              ],
            },
          },
        },
        // Setting Switcher | None. Volume is a Setting Switcher target now (its slots become the volume bar).
        {
          row: {
            label: "Bottom bar",
            live: true,
            man: MAN.bottom,
            control: {
              type: "seg",
              id: "vbottom",
              aria: "Bottom bar",
              value: "switcher",
              options: [
                { v: "switcher", label: "Setting Switcher" },
                { v: "none", label: "None" },
              ],
            },
          },
        },
        // Independent toggles, one per hideable stage; lit = hidden.
        {
          row: {
            label: "Hide from signal chain",
            live: true,
            full: true,
            man: MAN.hideSpk, // full: five toggles, the copy under them
            control: { type: "toggles", id: "vhide", aria: "Hide from signal chain", value: "", options: HIDEABLE },
          },
        },
      ],
    },
  ],
};
