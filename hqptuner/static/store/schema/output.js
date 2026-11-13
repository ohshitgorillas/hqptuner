import { isPcm, isSdm } from "./gray.js";
import { DISCOVERY, DSD_RATE_FAMILIES, DSD_RATES, DSD_TRANSPORT, MODES, PCM_RATES } from "./options.js";

/**
 * @param {string} prefix the backend's wire value, which its form fields carry
 * @returns {Record<string, SchemaField>}
 */
const localBackend = (prefix) => ({
  [`${prefix}_device`]: {
    label: "Output Device",
    group: "output",
    widget: "dropdown",
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
    field: `${prefix}_offset`,
  },
  [`${prefix}_bits`]: {
    label: "DAC bits",
    sublabel: "Noise-shaping target depth",
    group: "output",
    note: "dac_bits",
    widget: "number",
    field: `${prefix}_bits`,
    adviseWhen: isSdm,
  },
  [`${prefix}_period`]: {
    label: "Buffer time",
    group: "output",
    note: "buffer_time",
    widget: "number",
    field: `${prefix}_period`,
    unit: "ms",
  },
  ...localDsd(prefix),
});

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
      field: `${prefix}_dop`,
    },
    [`${prefix}_anydsd`]: {
      label: "DSD rates",
      bool: true,
      group: "output",
      widget: "segment",
      options: DSD_RATE_FAMILIES,
      note: "dsd_48k",
      field: `${prefix}_anydsd`,
      adviseWhen: isPcm,
    },
  };
}

/** @type {Record<string, SchemaField>} */
export const output = {
  output_mode: {
    label: "Mode",
    group: "output",
    widget: "segment",
    field: "mode",
    options: MODES,
    deviceGray: "mode",
    hoverNote: true,
  },
  backend: {
    label: "Backend",
    group: "output",
    widget: "segment",
    field: "backend",
    optionsFrom: "backends",
    desc: "config",
    hoverNote: true,
  },
  idle_time: {
    label: "Engine idle time",
    group: "output",
    widget: "dropdown",
    field: "idle_time",
    optionsFrom: "config",
    compact: "sm",
    unit: "seconds",
  },
  upnp_freewheel: {
    label: "UPnP freewheel",
    group: "output",
    widget: "checkbox",
    field: "upnp_freewheel",
  },
  quick_pause: { label: "Quick pause", group: "output", widget: "checkbox", field: "quick_pause" },
  short_buffer: {
    label: "Short buffer",
    group: "output",
    widget: "dropdown",
    field: "short_buffer",
    optionsFrom: "config",
    compact: "sm",
  },
  junk_filter: {
    label: "High-frequency filter",
    sublabel: "Playback filter",
    group: "output",
    widget: "dropdown",
    stateField: "filter_junk",
    liveKey: "junk_filter",
    optionsFrom: "enum",
    enumKey: "junk_filters",
    desc: "config",
    compact: "sm",
  },

  pcm_rate: {
    label: "PCM",
    group: "output",
    widget: "dropdown",
    field: "defaults_samplerate",
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
    field: "defaults_bitrate",
    options: DSD_RATES,
    deviceGray: "sdm",
    grayWhen: isPcm,
    quietGray: true,
    hoverNote: true,
  },

  ...localBackend("alsa"),
  ...localBackend("asio"),
  ...localBackend("wasapi"),

  net_device: {
    label: "Output Device",
    group: "output",
    widget: "dropdown",
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
    field: "net_bits",
    adviseWhen: isSdm,
  },
  net_period: {
    label: "Buffer time",
    group: "output",
    note: "buffer_time",
    widget: "number",
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
    field: "net_dop",
  },
  net_anydsd: {
    label: "DSD rates",
    bool: true,
    group: "output",
    widget: "segment",
    options: DSD_RATE_FAMILIES,
    note: "dsd_48k",
    field: "net_anydsd",
    adviseWhen: isPcm,
  },
  net_ipv6: {
    label: "Discovery",
    bool: true,
    group: "output",
    widget: "segment",
    options: DISCOVERY,
    note: "ipv6",
    field: "net_ipv6",
  },
};
