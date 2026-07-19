// Control catalog — the single map tying a UI control key to its wire truth.
// This is the glue between outline §4 controls and the two integration lanes.
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
//                the *staged* value, so graying reacts before Apply (outline §5)
//
// Output is the full outline §4 set. DSP/Volume/System still carry the step-1
// subset — filled next, tab by tab.
//
// Mode graying uses the live mode index (outline §5: 0=[source]/Auto, 1=PCM,
// 2=SDM). auto_family/samplerate/bitrate are forced by the apply layer, not
// exposed here (friendly rate always assumes auto-family follow).

// Mode is the http `mode` field (auto/pcm/sdm) — stable values, always all three.
// (The live GetModes enum is device-dependent: it drops SDM when the active
// device can't do DSD, so it's the wrong source for a persistent config choice.)
const isSdm = (ctx) => String(ctx.effective("output_mode")) === "sdm";
const isPcm = (ctx) => String(ctx.effective("output_mode")) === "pcm";

// checkbox value can arrive as bool (config) or "1"/"0" (staged) — normalize.
const truthy = (v) => v === true || v === 1 || v === "1" || v === "on" || v === "true";
// the fixed-volume level + Optimal ISO only apply when fixed volume is enabled.
const fixedOff = (ctx) => (truthy(ctx.effective("fixed_volume_enabled")) ? "" : "requires fixed volume");
// Optimal ISO supersedes the manual level with an auto-optimized one (manual
// §4.x "Fixed volume check box … optimized level setting"), so they're exclusive.
const isoOn = (ctx) => truthy(ctx.effective("optimal_iso"));
const levelGray = (ctx) => fixedOff(ctx) || (isoOn(ctx) ? "Optimal ISO sets the level" : "");
const logOff = (ctx) => (truthy(ctx.effective("log_enabled")) ? "" : "logging disabled");
// a post-process card's sub-controls gray out until the feature is enabled
const crossfeedOff = (ctx) => (truthy(ctx.effective("crossfeed_enabled")) ? "" : "enable crossfeed");
const loudnessOff = (ctx) => (truthy(ctx.effective("loudness_enabled")) ? "" : "enable loudness");

// Fixed friendly rate menus. Values are the 48k-base ceilings (see pcm_rate).
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
// Fixed mode segment — order PCM / SDM (DSD) / Auto, stable http `mode` values.
const MODES = [
  { value: "pcm", label: "PCM" },
  { value: "sdm", label: "SDM (DSD)" },
  { value: "auto", label: "Auto" },
];

export const schema = {
  // --- Output: always-visible masters + independents ---
  output_mode: { label: "Mode", group: "output", widget: "segment", lane: "http", field: "mode", options: MODES },
  backend: { label: "Backend", group: "output", widget: "segment", lane: "http", field: "backend", options: BACKENDS },
  idle_time: { label: "Idle time", group: "output", widget: "dropdown", lane: "http", field: "idle_time", optionsFrom: "config" },
  upnp_freewheel: { label: "UPnP freewheel", group: "output", widget: "checkbox", lane: "http", field: "upnp_freewheel" },

  // --- Output: per-family rate (both shown, inactive one grayed by mode) ---
  // Fixed friendly labels — NOT derived from the engine's rate list. HQPTuner
  // forces auto-family, so a per-family Nx/DSDx multiplier is the whole UX; each
  // maps to the 48k-base ceiling value (the higher of the 44.1/48 pair) so a
  // source of either family reaches its own Nx under the "equal or lower" cap.
  pcm_rate: { label: "PCM", group: "output", widget: "dropdown", lane: "http", field: "defaults_samplerate", options: PCM_RATES, grayWhen: isSdm },
  sdm_rate: { label: "SDM", group: "output", widget: "dropdown", lane: "http", field: "defaults_bitrate", options: DSD_RATES, grayWhen: isPcm },

  // --- Output: ALSA backend section (backend alsa|combo) ---
  alsa_device: { label: "Device", group: "output", widget: "dropdown", lane: "http", field: "alsa_device", optionsFrom: "config", wide: true, rescan: true },
  alsa_offset: { label: "Channel offset", group: "output", widget: "number", lane: "http", field: "alsa_offset" },
  alsa_bits: { label: "DAC bits", group: "output", widget: "number", lane: "http", field: "alsa_bits", grayWhen: isSdm },
  alsa_period: { label: "Buffer time", group: "output", widget: "number", lane: "http", field: "alsa_period", unit: "ms", hint: "−1 = minimum, 0 = default" },
  alsa_dop: { label: "DoP", group: "output", widget: "checkbox", lane: "http", field: "alsa_dop" },
  alsa_anydsd: { label: "48k DSD", group: "output", widget: "checkbox", lane: "http", field: "alsa_anydsd" },

  // --- Output: Network Audio backend section (backend network|combo) ---
  net_device: { label: "Device", group: "output", widget: "dropdown", lane: "http", field: "net_device", optionsFrom: "config", wide: true, rescan: true },
  net_bits: { label: "DAC bits", group: "output", widget: "number", lane: "http", field: "net_bits", grayWhen: isSdm },
  net_period: { label: "Buffer time", group: "output", widget: "number", lane: "http", field: "net_period", unit: "ms", hint: "−1 = minimum, 0 = default" },
  net_dop: { label: "DoP", group: "output", widget: "checkbox", lane: "http", field: "net_dop" },
  net_anydsd: { label: "48k DSD", group: "output", widget: "checkbox", lane: "http", field: "net_anydsd" },
  net_ipv6: { label: "IPv6", group: "output", widget: "checkbox", lane: "http", field: "net_ipv6" },

  // --- DSP: two persistent filter chains (both shown, inactive grayed by mode) ---
  // The Embedded /config form carries PCM (filter1x/filter/dither) and SDM
  // (oversampling1x/oversampling/modulator) chains separately and persistently —
  // distinct from the live SetFilter/SetShaping lane, which only writes the
  // active mode. Basic pass uses the http form (option lists come from the live
  // page via optionsFrom 'config'). Crossfeed / DAC correction / filter narrowing
  // are NOT on this form (like CUDA/multicore) — dropped, not hidden.
  // Mode graying is handled by the PCM/SDM collapsibles auto-closing (tabs.js),
  // not per-field grayWhen. desc drives the inline manual description line.
  pcm_filter_1x: { label: "1x oversampling filter", group: "dsp", widget: "dropdown", lane: "http", field: "filter1x", optionsFrom: "config", wide: true, narrow: "1x", desc: "filter" },
  pcm_filter_nx: { label: "Nx oversampling filter", group: "dsp", widget: "dropdown", lane: "http", field: "filter", optionsFrom: "config", wide: true, narrow: "nx", desc: "filter" },
  pcm_dither: { label: "Dither", group: "dsp", widget: "dropdown", lane: "http", field: "dither", optionsFrom: "config", wide: true, rateGray: "pcm", desc: "dither" },
  sdm_filter_1x: { label: "1x oversampling filter", group: "dsp", widget: "dropdown", lane: "http", field: "oversampling1x", optionsFrom: "config", wide: true, narrow: "1x", desc: "filter" },
  sdm_filter_nx: { label: "Nx oversampling filter", group: "dsp", widget: "dropdown", lane: "http", field: "oversampling", optionsFrom: "config", wide: true, narrow: "nx", desc: "filter" },
  sdm_modulator: { label: "Sigma-delta modulator", group: "dsp", widget: "dropdown", lane: "http", field: "modulator", optionsFrom: "config", wide: true, rateGray: "sdm", desc: "modulator" },

  // --- DSP: generic processing ---
  channels: { label: "Channels", group: "dsp", widget: "number", lane: "http", field: "channels" },
  fft_size: { label: "FFT filter length", group: "dsp", widget: "dropdown", lane: "http", field: "fft_size", optionsFrom: "config" },
  pipelines: { label: "DSP pipelines", group: "dsp", widget: "dropdown", lane: "http", field: "pipelines", optionsFrom: "config" },

  // --- DSP: DSD source decoding (SDM input processing) ---
  direct_sdm: { label: "Direct SDM", group: "dsp", widget: "checkbox", lane: "http", field: "direct_sdm" },
  dsd_gain_6db: { label: "Gain +6 dB", group: "dsp", widget: "checkbox", lane: "http", field: "dsd_6db" },
  sdm_integrator: { label: "Integrator", group: "dsp", widget: "dropdown", lane: "http", field: "integrator", optionsFrom: "config", wide: true },
  sdm_conversion: { label: "SDM → SDM", group: "dsp", widget: "dropdown", lane: "http", field: "sdm_conversion", optionsFrom: "config", wide: true },
  noise_filter: { label: "Noise filter", group: "dsp", widget: "dropdown", lane: "http", field: "noise_filter", optionsFrom: "config", wide: true },
  pcm_conversion: { label: "SDM → PCM", group: "dsp", widget: "dropdown", lane: "http", field: "pcm_conversion", optionsFrom: "config", wide: true },

  // --- DSP: post-processing (crossfeed + DAC correction). endpoint:"matrix"
  // marks these as /matrix form-read fields (their baseline/options come from
  // GET /matrix). On apply they ride the same snapshot-XML restore lane as every
  // other persistent field — the manager edits their <post_process><plugin> nodes
  // (presetconf.PLUGIN_MAP), so a stray crossfeed can't survive a preset re-assert.
  crossfeed_enabled: { label: "Enable", group: "dsp", widget: "checkbox", lane: "http", endpoint: "matrix", field: "post_bauer_enabled" },
  crossfeed_preset: { label: "Preset", group: "dsp", widget: "dropdown", lane: "http", endpoint: "matrix", field: "post_bauer_preset", optionsFrom: "matrix", wide: true, grayWhen: crossfeedOff },
  crossfeed_frequency: { label: "Frequency", group: "dsp", widget: "knob", slider: true, lane: "http", endpoint: "matrix", field: "post_bauer_frequency", unit: "Hz", def: 700, grayWhen: crossfeedOff },
  crossfeed_level: { label: "Level", group: "dsp", widget: "knob", slider: true, lane: "http", endpoint: "matrix", field: "post_bauer_level", unit: "dB", def: 4.5, grayWhen: crossfeedOff },
  dac_correction_enabled: { label: "Enable", group: "dsp", widget: "checkbox", lane: "http", endpoint: "matrix", field: "post_correction_enabled" },
  dac_correction_profile: { label: "Profile", group: "dsp", widget: "dropdown", lane: "http", endpoint: "matrix", field: "post_correction_dac0", optionsFrom: "matrix", wide: true },
  // Loudness plugin (bass/treble shelf-or-peak + loudness range). Fields read
  // from GET /matrix; on apply they ride the restore/XML lane via presetconf's
  // PLUGIN_MAP into <post_process><plugin type="loudness">. Number bounds/steps
  // come from the form itself (cfgConstraint), so they track the daemon.
  loudness_enabled: { label: "Enable", group: "dsp", widget: "checkbox", lane: "http", endpoint: "matrix", field: "post_loudness_enabled" },
  loudness_low_level: { label: "Level", group: "dsp", widget: "knob", slider: true, lane: "http", endpoint: "matrix", field: "post_loudness_lowlevel", unit: "dB", def: 20, grayWhen: loudnessOff },
  loudness_low_freq: { label: "Frequency", group: "dsp", widget: "number", lane: "http", endpoint: "matrix", field: "post_loudness_lowfreq", unit: "Hz", grayWhen: loudnessOff },
  loudness_low_steep: { label: "Steepness / Q", group: "dsp", widget: "number", lane: "http", endpoint: "matrix", field: "post_loudness_lowsteep", grayWhen: loudnessOff },
  loudness_low_type: { label: "Type", group: "dsp", widget: "dropdown", lane: "http", endpoint: "matrix", field: "post_loudness_lowtype", optionsFrom: "matrix", grayWhen: loudnessOff },
  loudness_high_level: { label: "Level", group: "dsp", widget: "knob", slider: true, lane: "http", endpoint: "matrix", field: "post_loudness_highlevel", unit: "dB", def: 10, grayWhen: loudnessOff },
  loudness_high_freq: { label: "Frequency", group: "dsp", widget: "number", lane: "http", endpoint: "matrix", field: "post_loudness_highfreq", unit: "Hz", grayWhen: loudnessOff },
  loudness_high_steep: { label: "Steepness / Q", group: "dsp", widget: "number", lane: "http", endpoint: "matrix", field: "post_loudness_highsteep", grayWhen: loudnessOff },
  loudness_high_type: { label: "Type", group: "dsp", widget: "dropdown", lane: "http", endpoint: "matrix", field: "post_loudness_hightype", optionsFrom: "matrix", grayWhen: loudnessOff },
  loudness_range_low: { label: "Lower bound", group: "dsp", widget: "number", lane: "http", endpoint: "matrix", field: "post_loudness_rangelow", unit: "dB", grayWhen: loudnessOff },
  loudness_range_high: { label: "Upper bound", group: "dsp", widget: "number", lane: "http", endpoint: "matrix", field: "post_loudness_rangehigh", unit: "dB", grayWhen: loudnessOff },

  // --- Volume ---
  // Field names per the live /config form + readme: volume_fixed is "Optimal ISO"
  // (inter-sample-overs-optimized fixed volume, readme §1.9), fixed_volume is the
  // dBFS level (readme §1.13 <fixed><volume>), fixed_volume_enabled gates both.
  // Only adaptive_volume is live (SetAdaptiveVolume); the rest are http/restart.
  fixed_volume_enabled: { label: "Fixed volume", group: "volume", widget: "checkbox", lane: "http", field: "fixed_volume_enabled" },
  fixed_volume: { label: "Fixed volume level", group: "volume", widget: "number", lane: "http", field: "fixed_volume", unit: "dBFS", grayWhen: levelGray },
  optimal_iso: { label: "Optimal ISO", group: "volume", widget: "checkbox", lane: "http", field: "volume_fixed", grayWhen: fixedOff },
  volume_max: { label: "Max volume", group: "volume", widget: "number", lane: "http", field: "volume_max", unit: "dBFS" },
  volume_min: { label: "Min volume", group: "volume", widget: "number", lane: "http", field: "volume_min", unit: "dBFS" },
  startup_volume: { label: "Startup volume", group: "volume", widget: "number", lane: "http", field: "defaults_volume", unit: "dBFS" },
  gain_comp: { label: "PCM gain compensation", group: "volume", widget: "slidernum", lane: "http", field: "gain_comp", unit: "dB", ticks: [0, -6] },
  adaptive_volume: { label: "Adaptive volume", group: "volume", widget: "checkbox", lane: "live", stateField: "adaptive", liveKey: "adaptive_volume" },
  playlist_album_gain: { label: "Playlist album gain", group: "volume", widget: "checkbox", lane: "http", field: "playlist_album_gain" },

  // --- System ---
  log_enabled: { label: "Enable logging", group: "system", widget: "checkbox", lane: "http", field: "log_enabled" },
  log_file: { label: "Log file", group: "system", widget: "text", lane: "http", field: "log_file", grayWhen: logOff, wide: true },
};
