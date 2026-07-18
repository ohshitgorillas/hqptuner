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

const isSdm = (ctx) => String(ctx.effective("output_mode")) === "2";
const isPcm = (ctx) => String(ctx.effective("output_mode")) === "1";

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

export const schema = {
  // --- Output: always-visible masters + independents ---
  output_mode: { label: "Mode", group: "output", widget: "segment", lane: "live", stateField: "mode", liveKey: "mode", optionsFrom: "modes" },
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
  alsa_device: { label: "Device", group: "output", widget: "dropdown", lane: "http", field: "alsa_device", optionsFrom: "config", wide: true },
  alsa_offset: { label: "Channel offset", group: "output", widget: "number", lane: "http", field: "alsa_offset" },
  alsa_bits: { label: "DAC bits", group: "output", widget: "number", lane: "http", field: "alsa_bits" },
  alsa_period: { label: "Buffer time", group: "output", widget: "number", lane: "http", field: "alsa_period", unit: "ms" },
  alsa_dop: { label: "DoP", group: "output", widget: "checkbox", lane: "http", field: "alsa_dop" },
  alsa_anydsd: { label: "48k DSD", group: "output", widget: "checkbox", lane: "http", field: "alsa_anydsd" },

  // --- Output: Network Audio backend section (backend network|combo) ---
  net_device: { label: "Device", group: "output", widget: "dropdown", lane: "http", field: "net_device", optionsFrom: "config", wide: true },
  net_bits: { label: "DAC bits", group: "output", widget: "number", lane: "http", field: "net_bits" },
  net_period: { label: "Buffer time", group: "output", widget: "number", lane: "http", field: "net_period", unit: "ms" },
  net_dop: { label: "DoP", group: "output", widget: "checkbox", lane: "http", field: "net_dop" },
  net_anydsd: { label: "48k DSD", group: "output", widget: "checkbox", lane: "http", field: "net_anydsd" },
  net_ipv6: { label: "IPv6", group: "output", widget: "checkbox", lane: "http", field: "net_ipv6" },

  // --- DSP (step-1 subset; full set next) ---
  filter_nx: { group: "dsp", widget: "dropdown", lane: "live", stateField: "filterNx", liveKey: "filter", arg: "value", optionsFrom: "filters" },
  shaper: { group: "dsp", widget: "dropdown", lane: "live", stateField: "shaper", liveKey: "shaper", optionsFrom: "shapers" },
  channels: { group: "dsp", widget: "number", lane: "http", field: "channels" },

  // --- Volume (step-1 subset; full set next) ---
  fixed_volume: { group: "volume", widget: "number", lane: "http", field: "fixed_volume" },
  adaptive_volume: { group: "volume", widget: "checkbox", lane: "live", stateField: "adaptive", liveKey: "adaptive_volume" },
};
