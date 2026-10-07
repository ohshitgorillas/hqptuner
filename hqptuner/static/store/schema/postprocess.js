// Control catalog, DSP group: post-processing and the Matrix tab. Assembled
// into `schema` by store/schema.js.

import { crossfeedOff, loudnessGated, loudnessOff, matrixBypassed } from "./gray.js";
import { ENGAGE_BYPASS } from "./options.js";

/** @type {Record<string, SchemaField>} */
export const postprocess = {
  // --- DSP: post-processing (crossfeed + DAC correction). endpoint:"matrix"
  // marks these as /matrix form-read fields (their baseline/options come from
  // GET /matrix). On apply they ride the same snapshot-XML restore lane as every
  // other persistent field — the manager edits their <post_process><plugin> nodes
  // (presetconf.PLUGIN_MAP), so a stray crossfeed can't survive a preset re-assert.
  // Sub-controls are quietGray: the dimmed card body + enable checkbox already
  // say why; per-control captions would repeat it a dozen times.
  crossfeed_enabled: {
    label: "",
    bool: true,
    group: "dsp",
    widget: "segment",
    options: ENGAGE_BYPASS,
    hoverNote: true,
    lane: "http",
    endpoint: "matrix",
    field: "post_bauer_enabled",
    grayWhen: matrixBypassed,
  },
  crossfeed_preset: {
    label: "Preset",
    group: "dsp",
    widget: "dropdown",
    lane: "http",
    endpoint: "matrix",
    field: "post_bauer_preset",
    optionsFrom: "matrix",
    // Four short options ("Default", "Chu Moy", "Jan Meier", "Custom"), so the
    // wide form width left most of the control empty.
    compact: "sm",
    grayWhen: crossfeedOff,
    quietGray: true,
  },
  crossfeed_frequency: {
    label: "Frequency",
    group: "dsp",
    widget: "knob",
    slider: true,
    lane: "http",
    endpoint: "matrix",
    field: "post_bauer_frequency",
    unit: "Hz",
    def: 700,
    grayWhen: crossfeedOff,
    quietGray: true,
  },
  crossfeed_level: {
    label: "Level",
    group: "dsp",
    widget: "knob",
    slider: true,
    lane: "http",
    endpoint: "matrix",
    field: "post_bauer_level",
    unit: "dB",
    def: 4.5,
    grayWhen: crossfeedOff,
    quietGray: true,
  },
  dac_correction_enabled: {
    label: "",
    bool: true,
    group: "dsp",
    note: "dac_correction",
    widget: "segment",
    options: ENGAGE_BYPASS,
    hoverNote: true,
    lane: "http",
    endpoint: "matrix",
    field: "post_correction_enabled",
    grayWhen: matrixBypassed,
  },
  dac_correction_profile: {
    label: "DAC model",
    group: "dsp",
    widget: "dropdown",
    lane: "http",
    endpoint: "matrix",
    field: "post_correction_dac0",
    optionsFrom: "matrix",
    wide: true,
    grayWhen: matrixBypassed,
    quietGray: true,
  },
  // Loudness plugin (bass/treble shelf-or-peak + loudness range). Fields read
  // from GET /matrix; on apply they ride the restore/XML lane via presetconf's
  // PLUGIN_MAP into <post_process><plugin type="loudness">. Number bounds/steps
  // come from the form itself (cfgConstraint), so they track the daemon.
  loudness_enabled: {
    label: "",
    bool: true,
    group: "dsp",
    widget: "segment",
    options: ENGAGE_BYPASS,
    hoverNote: true,
    lane: "http",
    endpoint: "matrix",
    field: "post_loudness_enabled",
    grayWhen: loudnessGated,
    inlineGray: true,
  },
  loudness_low_level: {
    label: "Level",
    group: "dsp",
    widget: "knob",
    slider: true,
    lane: "http",
    endpoint: "matrix",
    field: "post_loudness_lowlevel",
    unit: "dB",
    def: 20,
    grayWhen: loudnessOff,
    quietGray: true,
  },
  // Frequency knobs: fallback bounds for daemon builds whose /matrix form omits
  // min/max on the corner-frequency fields — values are the 6.0.4 form's own
  // attributes; the live form wins whenever it ships them.
  loudness_low_freq: {
    label: "Frequency",
    group: "dsp",
    widget: "knob",
    slider: true,
    scale: "log",
    lane: "http",
    endpoint: "matrix",
    field: "post_loudness_lowfreq",
    unit: "Hz",
    min: 20,
    max: 20000,
    step: 1,
    grayWhen: loudnessOff,
    quietGray: true,
  },
  // Steepness knobs: the /matrix form ships no min/max for the slope factor
  // (readme documents none), so the schema carries a pragmatic 0.1–10 slider
  // range covering all three type domains (shelf slope, Q, bandwidth).
  loudness_low_steep: {
    label: "Steepness / Q",
    group: "dsp",
    widget: "knob",
    slider: true,
    scale: "log",
    lane: "http",
    endpoint: "matrix",
    field: "post_loudness_lowsteep",
    min: 0.1,
    max: 10,
    step: 0.1,
    grayWhen: loudnessOff,
    quietGray: true,
  },
  loudness_low_type: {
    label: "Type",
    group: "dsp",
    widget: "dropdown",
    lane: "http",
    endpoint: "matrix",
    field: "post_loudness_lowtype",
    optionsFrom: "matrix",
    grayWhen: loudnessOff,
    quietGray: true,
  },
  loudness_high_level: {
    label: "Level",
    group: "dsp",
    widget: "knob",
    slider: true,
    lane: "http",
    endpoint: "matrix",
    field: "post_loudness_highlevel",
    unit: "dB",
    def: 10,
    grayWhen: loudnessOff,
    quietGray: true,
  },
  loudness_high_freq: {
    label: "Frequency",
    group: "dsp",
    widget: "knob",
    slider: true,
    scale: "log",
    lane: "http",
    endpoint: "matrix",
    field: "post_loudness_highfreq",
    unit: "Hz",
    min: 20,
    max: 20000,
    step: 1,
    grayWhen: loudnessOff,
    quietGray: true,
  },
  loudness_high_steep: {
    label: "Steepness / Q",
    group: "dsp",
    widget: "knob",
    slider: true,
    scale: "log",
    lane: "http",
    endpoint: "matrix",
    field: "post_loudness_highsteep",
    min: 0.1,
    max: 10,
    step: 0.1,
    grayWhen: loudnessOff,
    quietGray: true,
  },
  loudness_high_type: {
    label: "Type",
    group: "dsp",
    widget: "dropdown",
    lane: "http",
    endpoint: "matrix",
    field: "post_loudness_hightype",
    optionsFrom: "matrix",
    grayWhen: loudnessOff,
    quietGray: true,
  },
  loudness_range_low: {
    label: "Lower bound",
    group: "dsp",
    widget: "number",
    lane: "http",
    endpoint: "matrix",
    field: "post_loudness_rangelow",
    unit: "dB",
    grayWhen: loudnessOff,
    quietGray: true,
  },
  loudness_range_high: {
    label: "Upper bound",
    group: "dsp",
    widget: "number",
    lane: "http",
    endpoint: "matrix",
    field: "post_loudness_rangehigh",
    unit: "dB",
    grayWhen: loudnessOff,
    quietGray: true,
  },

  // --- Matrix tab (matrix-spec.md "Pipeline flow rows"): global controls + the atomic pipeline
  // set. Staged keys are the write lane's prefixed names (presetconf.FIELD_MAP);
  // formField is the daemon's bare form-field name for baseline/options reads.
  // matrix_pipelines is staged by the pipeline editor (stagePipelines), never
  // rendered as a Field — the entry exists so the pending bar counts and lanes it.
  matrix_enabled: {
    label: "",
    bool: true,
    group: "dsp",
    widget: "segment",
    options: ENGAGE_BYPASS,
    hoverNote: true,
    lane: "http",
    endpoint: "matrix",
    field: "matrix_enabled",
    formField: "enabled",
  },
  matrix_engine: {
    label: "Engine",
    group: "dsp",
    widget: "dropdown",
    lane: "http",
    endpoint: "matrix",
    field: "matrix_engine",
    formField: "engine",
    optionsFrom: "matrix",
    desc: "config",
  },
  matrix_expand_hf: {
    label: "Expand HF",
    group: "dsp",
    widget: "checkbox",
    lane: "http",
    endpoint: "matrix",
    field: "matrix_expand_hf",
    formField: "expand_hf",
  },
  matrix_iir2fir: {
    label: "IIR to FIR",
    group: "dsp",
    widget: "dropdown",
    lane: "http",
    endpoint: "matrix",
    field: "matrix_iir2fir",
    formField: "iir2fir",
    optionsFrom: "matrix",
    desc: "config",
  },
  matrix_pipelines: {
    label: "Pipelines",
    group: "dsp",
    widget: "text",
    lane: "http",
    field: "matrix_pipelines",
    fileTruth: true,
  },
  // The two saved-profile verbs (protocol.md "Saved matrix profiles do not persist"). HQPTuner owns the
  // <matrix_profile> element — hqplayerd keeps a saved profile in memory only and
  // never writes it — so a save or a delete is a staged config edit rather than a
  // daemon route. Staged by the profile card, never rendered as a Field; the
  // entries exist so the pending bar counts and lanes them. Neither has a
  // baseline: a verb has no current value, which is what makes it read dirty from
  // the moment it is staged until the apply clears it.
  matrix_profile_save: {
    label: "Save matrix profile",
    group: "dsp",
    widget: "text",
    lane: "http",
    field: "matrix_profile_save",
  },
  matrix_profile_delete: {
    label: "Delete matrix profile",
    group: "dsp",
    widget: "text",
    lane: "http",
    field: "matrix_profile_delete",
  },
};
