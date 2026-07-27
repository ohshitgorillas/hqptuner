// Control catalog — the single map tying a UI control key to its wire truth.
// This is the glue between architecture §4 controls and the two integration lanes.
//
// Per entry:
//   label        UI label (explicit; http fields don't live in settings.json)
//   group        settings.json group (output|dsp|volume|system) — tooltip source
//   widget       dumb primitive (segment|dropdown|number|checkbox|slider|radio)
//   lane         'live' (4321 setter) | 'http' (POST /config form field)
//   stateField   live only: the /api/state attribute holding its current index
//   liveKey      live only: writer.py setting key (mode|filter|shaper|rate|…)
//   arg          live only: setter arg written (default 'value'; 'value1x' = 1x filter)
//   field        http only: the POST /config form field name
//   optionsFrom  dropdown source: live enum ('filters'|'shapers'|'rates'|'modes')
//                or 'config' (the form field's own <option> set)
//   grayWhen     optional fn(ctx) -> reason string | ''; ctx.effective(key) reads
//                the *staged* value, so graying reacts before Apply (architecture §5)
//   quietGray    suppress the visible gray caption (hover title only) — for
//                controls whose graying is already explained by context (the
//                rate pair, dimmed post-process card bodies)
//
// Output is the full architecture §4 set. DSP/Volume/System still carry the step-1
// subset — filled next, tab by tab.
//
// Mode graying uses the live mode index (architecture §5: 0=[source]/Auto, 1=PCM,
// 2=SDM). auto_family/samplerate/bitrate are forced by the apply layer, not
// exposed here (friendly rate always assumes auto-family follow).

import { truthy } from "../lib/coerce.js";

// Mode is the http `mode` field (auto/pcm/sdm) — stable values, always all three.
// (The live GetModes enum is device-dependent: it drops SDM when the active
// device can't do DSD, so it's the wrong source for a persistent config choice.)
// grayWhen contract: return a reason STRING (rendered as a visible caption on
// the grayed field unless quietGray, and as the hover title), '' when enabled —
// a bare boolean leaks "true" into the title attribute.
const inMode = (ctx, m) => String(ctx.effective("output_mode")) === m;
const isSdm = (ctx) => (inMode(ctx, "sdm") ? "Only relevant to PCM output mode." : "");
const isPcm = (ctx) => (inMode(ctx, "pcm") ? "Only relevant to SDM output mode." : "");

// DirectSDM "will disable volume control and set PCM volume to fixed -3 dBFS
// value" (manual §4.5). Every persistent control that sets a volume level is
// therefore inert while it's on — the daemon accepts and stores the setting but
// nothing reaches the output stage, so the UI has to say so. PlaybackVolume.js
// already grays the live slider for the same reason.
const directSdm = (ctx) => (truthy(ctx.effective("direct_sdm")) ? "Direct SDM bypasses the volume control." : "");
// The fixed-volume dBFS *level* (the <fixed> element) only applies when fixed
// volume is enabled. Optimal ISO (volume_fixed) is NOT gated by this — it is an
// independent fixed-volume mode with its own 0/1/2 enable (readme §1.2, attr
// volume_fixed) — so it must not use fixedOff, or disabling fixed volume traps
// a nonzero Optimal ISO the user can no longer clear.
const fixedOff = (ctx) =>
  directSdm(ctx) || (truthy(ctx.effective("fixed_volume_enabled")) ? "" : "Requires Fixed volume to be enabled.");
// Optimal ISO supersedes the manual level with an auto-optimized one (manual
// §4.x "Fixed volume check box … optimized level setting"), so they're exclusive.
// volume_fixed's XML domain is 0 = off / 1 = −3 dB / 2 = −6 dB (readme §1.2), but
// the value reaches us either as one of those strings (file truth) or as a bare
// bool (the /config form's checkbox, which cannot express 2). Normalize to the
// XML domain so both sources read the same.
const isoLevel = (v) => {
  if (v === true) return "1";
  if (v === false || v == null) return "0";
  const s = String(v);
  if (s === "2") return "2";
  return s === "0" || s === "" || s === "false" ? "0" : "1";
};
const isoOn = (ctx) => isoLevel(ctx.effective("optimal_iso")) !== "0";
const levelGray = (ctx) => fixedOff(ctx) || (isoOn(ctx) ? "Auto headroom sets the level automatically." : "");
// The live volume control is bypassed in three documented cases (manual §4.2,
// §4.5): Direct SDM, fixed volume / Optimal ISO, and volume min = max = 0.
// Adaptive volume offsets the live volume, so it is inert in all three.
// The range controls themselves (min / max / startup level) share the first two
// reasons but deliberately NOT the third: min = max = 0 is a state you escape by
// editing min or max, so graying them there would trap the user in it.
const volumeRangeGray = (ctx) =>
  directSdm(ctx) ||
  (truthy(ctx.effective("fixed_volume_enabled")) || isoOn(ctx) ? "Fixed volume bypasses the volume control." : "");
const volumeBypassed = (ctx) =>
  volumeRangeGray(ctx) ||
  (Number(ctx.effective("volume_min")) === 0 && Number(ctx.effective("volume_max")) === 0
    ? "Volume min and max are both 0 — volume control is bypassed."
    : "");
const logOff = (ctx) => (truthy(ctx.effective("log_enabled")) ? "" : "Enable logging to set a log file path.");
// a post-process card's sub-controls gray out until the feature is enabled
const crossfeedOff = (ctx) => (truthy(ctx.effective("crossfeed_enabled")) ? "" : "Enable crossfeed to adjust.");
// Loudness is volume-ADAPTIVE (manual §7): the applied fraction follows the
// live volume across the loudness range. A bypassed/fixed volume pins it —
// at −3/−6 dB (above any sane range upper bound) that means 0% applied, ever.
const loudnessGated = (ctx) => {
  const r = volumeBypassed(ctx);
  return r ? `${r} Volume-adaptive loudness cannot adapt — use a Matrix EQ for a volume-agnostic equivalent.` : "";
};
const loudnessOff = (ctx) =>
  loudnessGated(ctx) || (truthy(ctx.effective("loudness_enabled")) ? "" : "Enable loudness to adjust.");

// Fixed friendly rate menus. Values are the 48k-base ceilings (see pcm_rate).
// Frequency-carrying labels ("1x (44.1 / 48 kHz)") were tried and dropped —
// they clip in the third-width Rate box (user decision 2026-07-21).
const PCM_RATES = [
  { value: "48000", label: "1x" },
  { value: "96000", label: "2x" },
  { value: "192000", label: "4x" },
  { value: "384000", label: "8x" },
  { value: "768000", label: "16x" },
  { value: "1536000", label: "32x" },
];
const DSD_RATES = [
  { value: "3072000", label: "DSD64" },
  { value: "6144000", label: "DSD128" },
  { value: "12288000", label: "DSD256" },
  { value: "24576000", label: "DSD512" },
  { value: "49152000", label: "DSD1024" },
  { value: "98304000", label: "DSD2048" },
];
// Backend http-field values are stable strings (not volatile enum indices), so
// the segment order + labels are fixed here — ALSA / Network / Combo.
const BACKENDS = [
  { value: "alsa", label: "ALSA" },
  { value: "network", label: "Network" },
  { value: "combo", label: "Combo" },
];
// Optimal ISO fuses an enable and a headroom level into one attribute, so it is
// one three-way control rather than a checkbox plus a level (HQPlayer Desktop
// renders the same thing as a tri-state checkbox, which reads as ambiguous).
const ISO_LEVELS = [
  { value: "0", label: "Off" },
  { value: "1", label: "−3 dB" },
  { value: "2", label: "−6 dB" },
];
// Fixed mode segment — order PCM / SDM (DSD) / Auto, stable http `mode` values.
const MODES = [
  { value: "pcm", label: "PCM" },
  { value: "sdm", label: "SDM (DSD)" },
  { value: "auto", label: "Auto" },
];

export const schema = {
  // --- Output: always-visible masters + independents ---
  output_mode: {
    label: "Mode",
    group: "output",
    widget: "segment",
    lane: "http",
    appliesLive: true,
    field: "mode",
    options: MODES,
    hoverNote: true,
  },
  backend: {
    label: "Backend",
    group: "output",
    widget: "segment",
    lane: "http",
    field: "backend",
    options: BACKENDS,
    hoverNote: true,
  },
  idle_time: {
    label: "Engine idle time",
    group: "output",
    widget: "dropdown",
    lane: "http",
    field: "idle_time",
    optionsFrom: "config",
  },
  upnp_freewheel: {
    label: "UPnP freewheel",
    group: "output",
    widget: "checkbox",
    lane: "http",
    field: "upnp_freewheel",
  },
  quick_pause: { label: "Quick pause", group: "output", widget: "checkbox", lane: "http", field: "quick_pause" },
  short_buffer: {
    label: "Short buffer",
    group: "output",
    widget: "dropdown",
    lane: "http",
    field: "short_buffer",
    optionsFrom: "config",
  },
  // The manual's "Playback filter" (§2.8) — a source-side high-frequency cut for
  // noise, errors and fake hires. Named for what it does; every option is an HF
  // cut (20k–50k roll off at that frequency, 2x/4x/8x cut at that multiple of
  // the base rate), which "Playback filter" does not convey.
  //
  // Live lane, and the only one besides adaptive_volume: the daemon's own
  // /config form has no field for it, so options come from the GetJunkFilters
  // enumeration, SetJunkFilter writes the list index, and State.filter_junk
  // reads it back. It is switchable during playback (manual §2.8), so it is
  // never grayed by transport state.
  junk_filter: {
    label: "High-frequency filter",
    // HQPlayer's own name for it, so the manual and the daemon's vocabulary are
    // still findable from a label that says what the control does
    sublabel: "(Playback filter)",
    group: "output",
    widget: "dropdown",
    lane: "live",
    stateField: "filter_junk",
    liveKey: "junk_filter",
    optionsFrom: "enum",
    enumKey: "junk_filters",
    desc: "config",
  },

  // --- Output: per-family rate (both shown, inactive one grayed by mode) ---
  // Fixed friendly labels — NOT derived from the engine's rate list. HQPTuner
  // forces auto-family, so a per-family Nx/DSDx multiplier is the whole UX; each
  // maps to the 48k-base ceiling value (the higher of the 44.1/48 pair) so a
  // source of either family reaches its own Nx under the "equal or lower" cap.
  // quietGray: the PCM/SDM pair next to the Mode segment explains itself.
  pcm_rate: {
    label: "PCM",
    group: "output",
    widget: "dropdown",
    lane: "http",
    field: "defaults_samplerate",
    options: PCM_RATES,
    grayWhen: isSdm,
    quietGray: true,
    hoverNote: true,
  },
  sdm_rate: {
    label: "SDM",
    group: "output",
    widget: "dropdown",
    lane: "http",
    field: "defaults_bitrate",
    options: DSD_RATES,
    grayWhen: isPcm,
    quietGray: true,
    hoverNote: true,
  },

  // --- Output: ALSA backend section (backend alsa|combo) ---
  alsa_device: {
    label: "Output Device",
    group: "output",
    note: "output_device",
    widget: "dropdown",
    lane: "http",
    field: "alsa_device",
    optionsFrom: "config",
    wide: true,
    rescan: true,
    span: true,
  },
  alsa_offset: {
    label: "Channel offset",
    group: "output",
    note: "channel_offset",
    widget: "number",
    lane: "http",
    field: "alsa_offset",
  },
  alsa_bits: {
    label: "DAC bits",
    group: "output",
    note: "dac_bits",
    widget: "number",
    lane: "http",
    field: "alsa_bits",
    grayWhen: isSdm,
  },
  alsa_period: {
    label: "Buffer time",
    group: "output",
    note: "buffer_time",
    widget: "number",
    lane: "http",
    field: "alsa_period",
    unit: "ms",
    hint: "−1 = minimum, 0 = default",
  },
  alsa_dop: {
    label: "DSD over PCM (DoP)",
    group: "output",
    note: "dop",
    widget: "checkbox",
    lane: "http",
    field: "alsa_dop",
    grayWhen: isPcm,
  },
  alsa_anydsd: {
    label: "48kHz DSD rates",
    group: "output",
    note: "dsd_48k",
    widget: "checkbox",
    lane: "http",
    field: "alsa_anydsd",
    grayWhen: isPcm,
  },

  // --- Output: Network Audio backend section (backend network|combo) ---
  net_device: {
    label: "Output Device",
    group: "output",
    note: "output_device",
    widget: "dropdown",
    lane: "http",
    field: "net_device",
    optionsFrom: "config",
    wide: true,
    rescan: true,
    span: true,
  },
  net_bits: {
    label: "DAC bits",
    group: "output",
    note: "dac_bits",
    widget: "number",
    lane: "http",
    field: "net_bits",
    grayWhen: isSdm,
  },
  net_period: {
    label: "Buffer time",
    group: "output",
    note: "buffer_time",
    widget: "number",
    lane: "http",
    field: "net_period",
    unit: "ms",
    hint: "−1 = minimum, 0 = default",
  },
  net_dop: {
    label: "DSD over PCM (DoP)",
    group: "output",
    note: "dop",
    widget: "checkbox",
    lane: "http",
    field: "net_dop",
    grayWhen: isPcm,
  },
  net_anydsd: {
    label: "48kHz DSD rates",
    group: "output",
    note: "dsd_48k",
    widget: "checkbox",
    lane: "http",
    field: "net_anydsd",
    grayWhen: isPcm,
  },
  net_ipv6: {
    label: "IPv6 discovery",
    group: "output",
    note: "ipv6",
    widget: "checkbox",
    lane: "http",
    field: "net_ipv6",
  },

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
  // daemon never restarts for them (lanes/livemap.py). They stay lane 'http'
  // because their VALUE domain is still the form's enum id — only the delivery
  // changed. The pending bar reads this to count them as live changes.
  pcm_filter_1x: {
    label: "1x filter",
    group: "dsp",
    note: "filter_1x",
    widget: "dropdown",
    lane: "http",
    appliesLive: true,
    field: "filter1x",
    optionsFrom: "config",
    wide: true,
    narrow: "1x",
    apodNarrow: true,
    desc: "filter",
  },
  pcm_filter_nx: {
    label: "Nx filter",
    group: "dsp",
    note: "filter_nx",
    widget: "dropdown",
    lane: "http",
    appliesLive: true,
    field: "filter",
    optionsFrom: "config",
    wide: true,
    narrow: "nx",
    desc: "filter",
  },
  pcm_dither: {
    label: "Dither",
    group: "dsp",
    note: "shaper",
    widget: "dropdown",
    lane: "http",
    appliesLive: true,
    field: "dither",
    optionsFrom: "config",
    wide: true,
    rateGray: "pcm",
    desc: "dither",
  },
  sdm_filter_1x: {
    label: "1x filter",
    group: "dsp",
    note: "filter_1x",
    widget: "dropdown",
    lane: "http",
    appliesLive: true,
    field: "oversampling1x",
    optionsFrom: "config",
    wide: true,
    narrow: "1x",
    apodNarrow: true,
    desc: "filter",
  },
  sdm_filter_nx: {
    label: "Nx filter",
    group: "dsp",
    note: "filter_nx",
    widget: "dropdown",
    lane: "http",
    appliesLive: true,
    field: "oversampling",
    optionsFrom: "config",
    wide: true,
    narrow: "nx",
    desc: "filter",
  },
  sdm_modulator: {
    label: "Sigma-delta modulator",
    group: "dsp",
    note: "shaper",
    widget: "dropdown",
    lane: "http",
    appliesLive: true,
    field: "modulator",
    optionsFrom: "config",
    wide: true,
    rateGray: "sdm",
    desc: "modulator",
  },

  // --- DSP: generic processing ---
  channels: { label: "Output Channels", group: "dsp", widget: "number", lane: "http", field: "channels" },
  fft_size: {
    label: "FFT filter length",
    group: "dsp",
    note: "fft_length",
    widget: "dropdown",
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
    label: "Direct SDM",
    group: "dsp",
    widget: "checkbox",
    lane: "http",
    field: "direct_sdm",
  },
  dsd_gain_6db: {
    label: "Gain +6 dB",
    group: "dsp",
    widget: "checkbox",
    lane: "http",
    field: "dsd_6db",
  },
  sdm_integrator: {
    label: "Integrator",
    group: "dsp",
    widget: "dropdown",
    lane: "http",
    field: "integrator",
    optionsFrom: "config",
    wide: true,
    desc: "config",
  },
  sdm_conversion: {
    label: "SDM → SDM",
    group: "dsp",
    widget: "dropdown",
    lane: "http",
    field: "sdm_conversion",
    optionsFrom: "config",
    wide: true,
    desc: "config",
  },
  noise_filter: {
    label: "Noise filter",
    group: "dsp",
    note: "pdm_filter",
    widget: "dropdown",
    lane: "http",
    field: "noise_filter",
    optionsFrom: "config",
    wide: true,
    desc: "config",
  },
  pcm_conversion: {
    label: "SDM → PCM",
    group: "dsp",
    note: "pdm_conversion",
    widget: "dropdown",
    lane: "http",
    field: "pcm_conversion",
    optionsFrom: "config",
    wide: true,
    desc: "config",
  },

  // --- DSP: post-processing (crossfeed + DAC correction). endpoint:"matrix"
  // marks these as /matrix form-read fields (their baseline/options come from
  // GET /matrix). On apply they ride the same snapshot-XML restore lane as every
  // other persistent field — the manager edits their <post_process><plugin> nodes
  // (presetconf.PLUGIN_MAP), so a stray crossfeed can't survive a preset re-assert.
  // Sub-controls are quietGray: the dimmed card body + enable checkbox already
  // say why; per-control captions would repeat it a dozen times.
  crossfeed_enabled: {
    label: "Enable",
    group: "dsp",
    widget: "checkbox",
    lane: "http",
    endpoint: "matrix",
    field: "post_bauer_enabled",
  },
  crossfeed_preset: {
    label: "Preset",
    group: "dsp",
    widget: "dropdown",
    lane: "http",
    endpoint: "matrix",
    field: "post_bauer_preset",
    optionsFrom: "matrix",
    wide: true,
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
    label: "Enable",
    group: "dsp",
    note: "dac_correction",
    widget: "checkbox",
    lane: "http",
    endpoint: "matrix",
    field: "post_correction_enabled",
  },
  dac_correction_profile: {
    label: "Profile",
    group: "dsp",
    widget: "dropdown",
    lane: "http",
    endpoint: "matrix",
    field: "post_correction_dac0",
    optionsFrom: "matrix",
    wide: true,
  },
  // Loudness plugin (bass/treble shelf-or-peak + loudness range). Fields read
  // from GET /matrix; on apply they ride the restore/XML lane via presetconf's
  // PLUGIN_MAP into <post_process><plugin type="loudness">. Number bounds/steps
  // come from the form itself (cfgConstraint), so they track the daemon.
  loudness_enabled: {
    label: "Enable",
    group: "dsp",
    widget: "checkbox",
    lane: "http",
    endpoint: "matrix",
    field: "post_loudness_enabled",
    grayWhen: loudnessGated,
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
  loudness_low_freq: {
    label: "Frequency",
    group: "dsp",
    widget: "number",
    lane: "http",
    endpoint: "matrix",
    field: "post_loudness_lowfreq",
    unit: "Hz",
    grayWhen: loudnessOff,
    quietGray: true,
  },
  // Steepness sliders: the /matrix form ships no min/max for the slope factor
  // (readme documents none), so the schema carries a pragmatic 0.1–10 slider
  // range covering all three type domains (shelf slope, Q, bandwidth).
  loudness_low_steep: {
    label: "Steepness / Q",
    group: "dsp",
    widget: "slidernum",
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
    widget: "number",
    lane: "http",
    endpoint: "matrix",
    field: "post_loudness_highfreq",
    unit: "Hz",
    grayWhen: loudnessOff,
    quietGray: true,
  },
  loudness_high_steep: {
    label: "Steepness / Q",
    group: "dsp",
    widget: "slidernum",
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

  // --- Matrix tab (matrix-spec step 3): global controls + the atomic pipeline
  // set. Staged keys are the write lane's prefixed names (presetconf.FIELD_MAP);
  // formField is the daemon's bare form-field name for baseline/options reads.
  // matrix_pipelines is staged by the pipeline editor (stagePipelines), never
  // rendered as a Field — the entry exists so the pending bar counts and lanes it.
  matrix_enabled: {
    label: "Enabled",
    group: "dsp",
    widget: "checkbox",
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
  // The two saved-profile verbs (matrix-spec round 5). HQPTuner owns the
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

  // --- Volume ---
  // Field names per the live /config form + readme: volume_fixed is "Optimal ISO"
  // (inter-sample-overs-optimized fixed volume, readme §1.9), fixed_volume is the
  // dBFS level (readme §1.13 <fixed><volume>); fixed_volume_enabled gates the
  // dBFS level only. Optimal ISO (volume_fixed) is an independent mode (see below).
  // Only adaptive_volume is live (SetAdaptiveVolume); the rest are http/restart.
  fixed_volume_enabled: {
    label: "Fixed volume",
    group: "volume",
    widget: "checkbox",
    lane: "http",
    field: "fixed_volume_enabled",
    grayWhen: directSdm,
  },
  // fileTruth: while fixed volume is OFF the daemon's form reports its OWN
  // remembered level, not the user's — so a level typed before switching the
  // feature off came back as the daemon's number and read as "reverted". The file
  // carries the user's, parked in a commented <fixed> line, so it is the authority.
  fixed_volume: {
    label: "Fixed volume level",
    group: "volume",
    widget: "number",
    lane: "http",
    field: "fixed_volume",
    fileTruth: true,
    unit: "dBFS",
    grayWhen: levelGray,
  },
  // volume_fixed's XML domain is wider than the daemon's own form: 0 = off /
  // 1 = −3 dB / 2 = −6 dB, but /config renders a bare checkbox that can only
  // express 0/1. HQPTuner writes it on the snapshot-XML restore lane (which
  // carries 2 — verified live on 6.0.4) and reads its true value from the config
  // file (fileTruth), since the form's bool cannot tell −3 from −6.
  optimal_iso: {
    label: "Auto headroom",
    sublabel: "(Optimal ISO)",
    size: "lg",
    group: "volume",
    widget: "segment",
    lane: "http",
    field: "volume_fixed",
    fileTruth: true,
    options: ISO_LEVELS,
    grayWhen: directSdm,
  },
  volume_max: {
    label: "Max volume",
    group: "volume",
    widget: "number",
    lane: "http",
    field: "volume_max",
    unit: "dBFS",
    grayWhen: volumeRangeGray,
  },
  volume_min: {
    label: "Min volume",
    group: "volume",
    widget: "number",
    lane: "http",
    field: "volume_min",
    unit: "dBFS",
    grayWhen: volumeRangeGray,
  },
  startup_volume: {
    label: "Startup volume",
    group: "volume",
    widget: "number",
    lane: "http",
    field: "defaults_volume",
    unit: "dBFS",
    grayWhen: volumeRangeGray,
  },
  gain_comp: {
    label: "PCM gain compensation",
    group: "volume",
    widget: "slidernum",
    lane: "http",
    field: "gain_comp",
    note: "gain_compensation",
    unit: "dB",
    ticks: [0, -6],
  },
  adaptive_volume: {
    label: "Adaptive volume",
    group: "volume",
    widget: "checkbox",
    lane: "live",
    stateField: "adaptive",
    liveKey: "adaptive_volume",
    grayWhen: volumeBypassed,
  },
  playlist_album_gain: {
    label: "Playlist album gain",
    group: "volume",
    widget: "checkbox",
    lane: "http",
    field: "playlist_album_gain",
  },

  // --- System ---
  pre_before_meter: {
    label: "Pre-process before metering",
    group: "system",
    widget: "checkbox",
    lane: "http",
    field: "pre_before_meter",
  },
  log_enabled: { label: "Enable logging", group: "system", widget: "checkbox", lane: "http", field: "log_enabled" },
  log_file: {
    label: "Log file",
    group: "system",
    note: "log_path",
    widget: "text",
    lane: "http",
    field: "log_file",
    grayWhen: logOff,
    wide: true,
    span: true,
  },
};
