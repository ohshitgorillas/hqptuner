// Control catalog, Output group. Assembled into `schema` by store/schema.js.

import { isPcm, isSdm } from "./gray.js";
import { DISCOVERY, DSD_RATE_FAMILIES, DSD_RATES, DSD_TRANSPORT, MODES, PCM_RATES } from "./options.js";

// The six settings of a local output backend. ALSA on a Linux daemon, ASIO and
// WASAPI on a Windows one: the daemon's form carries the same six per backend,
// each named with the backend's own prefix.
/**
 * @param {string} prefix the backend's wire value, which its form fields carry
 * @returns {Record<string, SchemaField>}
 */
const localBackend = (prefix) => ({
  [`${prefix}_device`]: {
    label: "Output Device",
    group: "output",
    widget: "dropdown",
    lane: "http",
    field: `${prefix}_device`,
    optionsFrom: "config",
    wide: true,
    rescan: true,
    span: true,
  },
  [`${prefix}_offset`]: {
    label: "Channel offset",
    group: "output",
    note: "channel_offset",
    widget: "number",
    lane: "http",
    field: `${prefix}_offset`,
  },
  [`${prefix}_bits`]: {
    label: "DAC bits",
    sublabel: "Noise-shaping target depth",
    group: "output",
    note: "dac_bits",
    widget: "number",
    lane: "http",
    field: `${prefix}_bits`,
    // advisory, never grayed — see adviseWhen in the header: a PCM bit depth set
    // while the output is in SDM is a perfectly reasonable thing to stage.
    adviseWhen: isSdm,
  },
  [`${prefix}_period`]: {
    label: "Buffer time",
    group: "output",
    note: "buffer_time",
    widget: "number",
    lane: "http",
    field: `${prefix}_period`,
    unit: "ms",
  },
  ...localDsd(prefix),
});

// The two DSD transport switches of a local output backend.
/**
 * @param {string} prefix
 * @returns {Record<string, SchemaField>}
 */
function localDsd(prefix) {
  return {
    [`${prefix}_dop`]: {
      label: "DSD support",
      bool: true,
      group: "output",
      widget: "segment",
      options: DSD_TRANSPORT,
      note: "dop",
      lane: "http",
      field: `${prefix}_dop`,
      // NOT grayed in PCM, unlike its neighbors. On a device with no native DSD
      // path this switch is the only thing that makes SDM reachable at all, and
      // SDM grays until it is on (store/narrow/devicecaps.js) — graying it in PCM
      // too locks the user out of DSD entirely, with both controls pointing at
      // each other. Same reasoning as volume min/max under a bypassed volume:
      // never gray the one control that escapes the state.
    },
    [`${prefix}_anydsd`]: {
      label: "DSD rates",
      bool: true,
      group: "output",
      widget: "segment",
      options: DSD_RATE_FAMILIES,
      note: "dsd_48k",
      lane: "http",
      field: `${prefix}_anydsd`,
      adviseWhen: isPcm, // see the bits entry — staged in PCM, live once the mode is SDM
    },
  };
}

/** @type {Record<string, SchemaField>} */
export const output = {
  // --- Output: always-visible masters + independents ---
  output_mode: {
    label: "Mode",
    group: "output",
    widget: "segment",
    lane: "http",
    appliesLive: true,
    field: "mode",
    options: MODES,
    deviceGray: "mode",
    hoverNote: true,
  },
  backend: {
    label: "Backend",
    group: "output",
    widget: "segment",
    lane: "http",
    field: "backend",
    // the daemon's own list, under fixed labels (store/ui/backends.js)
    optionsFrom: "backends",
    hoverNote: true,
  },
  idle_time: {
    label: "Engine idle time",
    group: "output",
    widget: "dropdown",
    lane: "http",
    field: "idle_time",
    optionsFrom: "config",
    compact: "sm",
    unit: "seconds",
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
    compact: "sm",
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
    sublabel: "Playback filter",
    group: "output",
    widget: "dropdown",
    lane: "live",
    stateField: "filter_junk",
    liveKey: "junk_filter",
    optionsFrom: "enum",
    enumKey: "junk_filters",
    desc: "config",
    // every option is a short token ("none", "20k", "2x"), so the global select
    // width leaves most of the control empty
    compact: "sm",
  },

  // --- Output: per-family rate (both shown, inactive one grayed by mode) ---
  // Fixed friendly labels — NOT derived from the engine's rate list. HQPTuner
  // forces auto-family, so a per-family Nx/DSDx multiplier is the whole UX; each
  // maps to the 48k-base member of its tier (the higher of the 44.1/48 pair) so
  // a source of either family reaches its own Nx under the "equal or lower" cap.
  //
  // These write the LIMIT slot, `defaults_*`, and that is the only rate slot a
  // config write may touch. The daemon has a second one — `samplerate`/`bitrate`,
  // labeled "Sample rate"/"Bit rate" on its own form — which is an exact rate
  // that ignores both the limit and the source's base family. Verified live on
  // 6.0.4 against a 44.1 kHz source with the limit at DSD512:
  //
  //   request unset        -> 22579200   limit caps, and follows the source family
  //   request 12288000     -> 12288000   exact: a 44.1k source pinned to 48k base
  //   request 49152000     -> 49152000   exact: overrides the limit outright
  //
  // A config write has no source to take a family from, so writing that slot
  // would send 44.1k material out at a 48k base rate — which is the user's call
  // to make via alsa_anydsd/net_anydsd, never HQPTuner's. http.restore.FORCED_CONFIG
  // therefore pins it to 0 on every write and this menu never goes near it.
  // store/live/rates.js writes it live, where the playing source IS known and the tier
  // resolves to that source's own family member.
  //
  // quietGray: the PCM/SDM pair next to the Mode segment explains itself.
  pcm_rate: {
    label: "PCM",
    group: "output",
    widget: "dropdown",
    lane: "http",
    field: "defaults_samplerate",
    // Grounds on `file`, which is the config XML overlaid with the engine's live
    // settings (overrides.live_overrides) — the same treatment the filter/shaper
    // entries get below. A pinned rate (store/live/pin.js) is not among them: it
    // writes the fixed slot, not this limit, so this control never shows it.
    fileTruth: true,
    options: PCM_RATES,
    deviceGray: "pcm",
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
    fileTruth: true, // same as pcm_rate above
    options: DSD_RATES,
    deviceGray: "sdm",
    grayWhen: isPcm,
    quietGray: true,
    hoverNote: true,
  },

  // --- Output: local backend sections (that backend, or combo) ---
  ...localBackend("alsa"),
  ...localBackend("asio"),
  ...localBackend("wasapi"),

  // --- Output: Network Audio backend section (backend network|combo) ---
  net_device: {
    label: "Output Device",
    group: "output",
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
    sublabel: "Noise-shaping target depth",
    group: "output",
    note: "dac_bits",
    widget: "number",
    lane: "http",
    field: "net_bits",
    adviseWhen: isSdm, // see alsa_bits
  },
  net_period: {
    label: "Buffer time",
    group: "output",
    note: "buffer_time",
    widget: "number",
    lane: "http",
    field: "net_period",
    unit: "ms",
  },
  net_dop: {
    label: "DSD support",
    bool: true,
    group: "output",
    widget: "segment",
    options: DSD_TRANSPORT,
    note: "dop",
    lane: "http",
    field: "net_dop",
    // see alsa_dop — never grayed in PCM, it is the escape from it
  },
  net_anydsd: {
    label: "DSD rates",
    bool: true,
    group: "output",
    widget: "segment",
    options: DSD_RATE_FAMILIES,
    note: "dsd_48k",
    lane: "http",
    field: "net_anydsd",
    adviseWhen: isPcm, // see alsa_bits
  },
  net_ipv6: {
    label: "Discovery",
    bool: true,
    group: "output",
    widget: "segment",
    options: DISCOVERY,
    note: "ipv6",
    lane: "http",
    field: "net_ipv6",
  },
};
