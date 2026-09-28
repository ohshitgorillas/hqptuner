// Control catalog, DSP group: filter chains, generic processing, DSD source
// decoding. Assembled into `schema` by store/schema.js.

import { DSD_PLAYBACK, SOURCE_GAIN } from "./options.js";

/** @type {Record<string, SchemaField>} */
export const dsp = {
  // --- DSP: two persistent filter chains (both shown, inactive grayed by mode) ---
  // The Embedded /config form carries PCM (filter1x/filter/dither) and SDM
  // (oversampling1x/oversampling/modulator) chains separately and persistently —
  // distinct from the live SetFilter/SetShaping lane, which only writes the
  // active mode. Basic pass uses the http form (option lists come from the live
  // page via optionsFrom 'config'). Crossfeed / DAC correction / filter narrowing
  // are NOT on this form (like CUDA/multicore) — dropped, not hidden.
  // Mode graying is handled by the PCM/SDM collapsibles auto-closing (ResamplingTab.js),
  // not per-field grayWhen. desc drives the inline manual description line.
  // appliesLive: the write path routes these through the Control API's own
  // setters instead of the restore lane, so they take effect immediately and the
  // daemon never restarts for them (lanes/live/routing.py). They stay lane 'http'
  // because their VALUE domain is still the form's enum id — only the delivery
  // changed. The pending bar reads this to count them as live changes.
  pcm_filter_1x: {
    label: "1x filter",
    sublabel: "Sources up to 48 kHz",
    group: "dsp",
    note: "filter_1x",
    widget: "dropdown",
    lane: "http",
    appliesLive: true,
    field: "filter1x",
    optionsFrom: "config",
    // All four chain filter selectors carry one width, sized to the longest name
    // the enumeration holds — a chain reads as a chain only if its steps line up.
    compact: "lg",
    narrow: "1x",
    favKind: "filters",
    desc: "filter",
    plainNames: "filters",
  },
  pcm_filter_nx: {
    label: "Nx filter",
    sublabel: "Sources above 48 kHz",
    group: "dsp",
    note: "filter_nx",
    widget: "dropdown",
    lane: "http",
    appliesLive: true,
    field: "filter",
    optionsFrom: "config",
    compact: "lg",
    narrow: "nx",
    favKind: "filters",
    desc: "filter",
    plainNames: "filters",
  },
  pcm_dither: {
    label: "Dither",
    sublabel: "Low-level noise treatment",
    group: "dsp",
    widget: "dropdown",
    lane: "http",
    appliesLive: true,
    field: "dither",
    optionsFrom: "config",
    compact: "sm",
    // No rateGray. The PCM dither floors are the manual's recommendations, not
    // faults: a ditherer below its floor still dithers and the engine still
    // produces output, so every dither stays selectable at every rate and the
    // mismatch is reported in words instead (store/alerts/shaperfit.js). `rateGray`
    // stays on sdm_modulator, where the floor really does stop output.
    desc: "dither",
    plainNames: "dithers",
  },
  sdm_filter_1x: {
    label: "1x filter",
    sublabel: "Sources up to 48 kHz",
    group: "dsp",
    note: "filter_1x",
    widget: "dropdown",
    lane: "http",
    appliesLive: true,
    field: "oversampling1x",
    optionsFrom: "config",
    compact: "lg",
    narrow: "1x",
    favKind: "filters",
    // sdm_filter, not filter: the same filter is offered in both chains at once
    // and part of its manual prose is true only of the SDM one (store/prose.js).
    desc: "sdm_filter",
    plainNames: "filters",
  },
  sdm_filter_nx: {
    label: "Nx filter",
    sublabel: "Sources above 48 kHz",
    group: "dsp",
    note: "filter_nx",
    widget: "dropdown",
    lane: "http",
    appliesLive: true,
    field: "oversampling",
    optionsFrom: "config",
    compact: "lg",
    narrow: "nx",
    favKind: "filters",
    desc: "sdm_filter",
    plainNames: "filters",
  },
  sdm_modulator: {
    label: "Sigma-delta modulator",
    sublabel: "Builds the 1-bit stream",
    group: "dsp",
    widget: "dropdown",
    lane: "http",
    appliesLive: true,
    field: "modulator",
    optionsFrom: "config",
    compact: "md",
    rateGray: "sdm",
    favKind: "modulators",
    desc: "modulator",
    plainNames: "modulators",
  },

  // --- DSP: generic processing ---
  channels: { label: "Output Channels", group: "dsp", widget: "number", lane: "http", field: "channels" },
  // Detented slider rather than a dropdown: the eight lengths are one scale
  // (short = gentler roll-off, long = steeper, manual §4.7), not eight names.
  // It renders inside whichever chain card has an FFT filter selected
  // (components/tabs/ConversionCards.js), so it has no card of its own.
  fft_size: {
    label: "FFT filter length",
    group: "dsp",
    note: "fft_length",
    widget: "steps",
    wide: true,
    lane: "http",
    field: "fft_size",
    optionsFrom: "config",
  },
  pipelines: {
    label: "DSP pipelines",
    group: "dsp",
    widget: "dropdown",
    lane: "http",
    field: "pipelines",
    optionsFrom: "config",
  },

  // --- DSP: DSD source decoding (SDM input processing) ---
  // No longer grayed by mode — each folds into its matching PCM/SDM
  // Resampling-tab card as a "Sources" subsection, with a mode-mismatch note
  // shown there instead (ResamplingTab.js).
  direct_sdm: {
    label: "DSD playback",
    // HQPlayer's own name for it, so the manual and the daemon's vocabulary are
    // still findable from a label that says what the control does
    sublabel: "Direct SDM",
    bool: true,
    group: "dsp",
    widget: "segment",
    options: DSD_PLAYBACK,
    lane: "http",
    field: "direct_sdm",
  },
  dsd_gain_6db: {
    label: "Source gain",
    bool: true,
    group: "dsp",
    widget: "segment",
    options: SOURCE_GAIN,
    lane: "http",
    field: "dsd_6db",
  },
  sdm_integrator: {
    label: "Remodulator structure",
    sublabel: "Integrator",
    group: "dsp",
    widget: "dropdown",
    lane: "http",
    field: "integrator",
    optionsFrom: "config",
    compact: "sm",
    desc: "config",
    // Grouped overlay, and it keeps every manual sentence: the leaves name the
    // structure, the sentences say what it costs in bandwidth, and neither
    // stands in for the other.
    plainNames: "sdm_integrator",
  },
  sdm_conversion: {
    label: "Rate conversion",
    sublabel: "SDM → SDM conversion",
    group: "dsp",
    widget: "dropdown",
    lane: "http",
    field: "sdm_conversion",
    optionsFrom: "config",
    compact: "sm",
    desc: "config",
    // Flat overlay — three options group into nothing — and `plainQuiet`,
    // because the Simplified rows are the manual's option wording verbatim and
    // the per-option sentence under them would repeat it (components/binder.js).
    plainNames: "sdm_conversion",
    plainQuiet: true,
  },
  noise_filter: {
    label: "Noise filter",
    sublabel: "Removes ultrasonic noise",
    group: "dsp",
    note: "pdm_filter",
    widget: "dropdown",
    lane: "http",
    field: "noise_filter",
    optionsFrom: "config",
    compact: "md",
    desc: "config",
    // Grouped overlay, keeping every manual sentence — the leaves compress the
    // manual's wording rather than repeat it, so no `plainQuiet` here.
    plainNames: "noise_filter",
  },
  pcm_conversion: {
    label: "Decimation filter",
    sublabel: "SDM → PCM conversion",
    group: "dsp",
    note: "pdm_conversion",
    widget: "dropdown",
    lane: "http",
    field: "pcm_conversion",
    optionsFrom: "config",
    compact: "md",
    desc: "config",
    plainNames: "pcm_conversion",
  },
};
