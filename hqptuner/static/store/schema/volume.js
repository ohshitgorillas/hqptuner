// Control catalog, Volume and System groups. Assembled into `schema` by
// store/schema.js.

import { directSdm, levelGray, logOff, volumeBypassed, volumeRangeGray } from "./gray.js";
import { ISO_LEVELS, ON_OFF } from "./options.js";

/** @type {Record<string, SchemaField>} */
export const volume = {
  // --- Volume ---
  // Field names per the live /config form + readme: volume_fixed is "Optimal ISO"
  // (inter-sample-overs-optimized fixed volume, readme §1.9), fixed_volume is the
  // dBFS level (readme §1.13 <fixed><volume>); fixed_volume_enabled gates the
  // dBFS level only. Optimal ISO (volume_fixed) is an independent mode (see below).
  // Only adaptive_volume is live (SetAdaptiveVolume); the rest are http/restart.
  fixed_volume_enabled: {
    label: "Fixed level",
    bool: true,
    group: "volume",
    widget: "segment",
    options: ON_OFF,
    hoverNote: true,
    lane: "http",
    field: "fixed_volume_enabled",
    grayWhen: directSdm,
  },
  // fileTruth: while fixed volume is OFF the daemon's form reports its OWN
  // remembered level, not the user's — so a level typed before switching the
  // feature off came back as the daemon's number and read as "reverted". The file
  // carries the user's, parked in a commented <fixed> line, so it is the authority.
  fixed_volume: {
    label: "",
    group: "volume",
    widget: "number",
    lane: "http",
    field: "fixed_volume",
    fileTruth: true,
    unit: "dBFS",
    grayWhen: levelGray,
    quietGray: true,
  },
  // volume_fixed's XML domain is wider than the daemon's own form: 0 = off /
  // 1 = −3 dB / 2 = −6 dB, but /config renders a bare checkbox that can only
  // express 0/1. HQPTuner writes it on the snapshot-XML restore lane (which
  // carries 2 — verified live on 6.0.4) and reads its true value from the config
  // file (fileTruth), since the form's bool cannot tell −3 from −6.
  optimal_iso: {
    label: "Auto headroom",
    sublabel: "Optimal ISO",
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
    anchor: "min",
  },
  adaptive_volume: {
    label: "Adaptive volume",
    group: "volume",
    widget: "checkbox",
    lane: "live",
    stateField: "adaptive",
    liveKey: "adaptive_volume",
    grayWhen: volumeBypassed,
    inlineGray: true,
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
  log_enabled: {
    label: "",
    bool: true,
    group: "system",
    widget: "segment",
    options: ON_OFF,
    hoverNote: true,
    lane: "http",
    field: "log_enabled",
  },
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
