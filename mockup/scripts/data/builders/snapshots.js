// Snapshot builder: what a snapshot can hold, in chain order, and the mock records.
//
// A snapshot is v1's live snapshot (presets/store/live.py), scoped under the active station: only settings the engine changes
// live, with no restart. v1 holds output mode, the running chain's 1x / Nx filter and dither or modulator, adaptive volume and
// HF auto-pilot; v2 adds the matrix profile (MatrixSetProfile is live). Not held (v1 ruling): the HF filter
// and the volume level follow the material, and a stored rate is ignored.
// A record need not carry every setting: an absent one is left where the engine has it on recall (v1).
// One chain per snapshot: the idle chain can't be set live, so the chain rows follow the snapshot's Output mode, and need it.
//
// Labels: the v2 page's field labels (data/conversion.js FIELDS), the drawers' row labels. Copy: v1 verbatim
// (components/live/Presets.js, components/Ask.js), `Live snapshot` → `Snapshot` (v2 naming, as the spec renamed `preset`).

import { CHAIN_LISTS, FIELDS } from "../stages/conversion.js";
import { STATION_PROFILES } from "./profiles.js";

const OFF_ON = [
  { v: "0", label: "Off" },
  { v: "1", label: "On" },
];

// Matrix profiles of the active station (mock; the profile select lists the station's profiles): data/profiles.js.
export const MATRIX_PROFILES = STATION_PROFILES("Speakers");

/**
 * Rows in chain order. `chain`: the row's list follows the snapshot's mode (one chain per snapshot); `gate`: the row the
 * chain rows need (mode). kind: seg | select | list (the option list sheet, page grammar).
 */
export const SNAP_ROWS = [
  { id: "autopilot", stage: "HF filter", label: "HF filter auto-pilot", kind: "seg", options: OFF_ON },
  { id: "adaptive", stage: "Volume", label: "Adaptive volume", kind: "seg", options: OFF_ON },
  {
    id: "profile",
    stage: "Matrix engine",
    label: "Matrix profile",
    kind: "select",
    options: MATRIX_PROFILES.map((v) => ({ v, label: v })),
  },
  {
    id: "1x",
    stage: "Resampling",
    label: FIELDS["1x"].label,
    kind: "list",
    chain: true,
    list: (ch) => CHAIN_LISTS[ch].filters,
  },
  { id: "nx", label: FIELDS.nx.label, kind: "list", chain: true, list: (ch) => CHAIN_LISTS[ch].filters },
  {
    id: "sh",
    stage: "Shaping",
    label: (ch) => FIELDS[ch + "sh"].label,
    kind: "list",
    chain: true,
    list: (ch) => CHAIN_LISTS[ch].shapers,
  },
  {
    id: "mode",
    stage: "Output",
    label: "Mode",
    kind: "seg",
    gate: true,
    options: [
      { v: "pcm", label: "PCM" },
      { v: "sdm", label: "SDM (DSD)" },
    ],
  }, // a snapshot holds one chain: no Auto
];

/** v1 copy (Presets.js / Ask.js), `Live snapshot` → `Snapshot`. */
export const SNAP_COPY = {
  select: "Select the settings to attach to the new snapshot.",
  lede: "Save the current settings to recall them in one click.",
  noName: "Enter a name first",
  overwrite: (n) => `Snapshot "${n}" already exists. Overwrite it?`,
  remove: (n) => `Delete snapshot "${n}"? This cannot be undone.`,
};

/**
 * Mock records per station (stations.js names). `fields` = what the snapshot holds (absent = left as is);
 * the chain rows are the mode's chain. Late night is what plays now.
 */
export const SNAPSHOTS = {
  Speakers: {
    "Late night": {
      mode: "sdm",
      "1x": "poly-sinc-ext2",
      nx: "poly-sinc-ext2-hires-mp",
      sh: "AMSDM7EC 512+fs",
      profile: "[Default]",
      adaptive: "0",
    },
    Daytime: {
      mode: "sdm",
      "1x": "poly-sinc-ext2",
      nx: "poly-sinc-ext2-hires-mp",
      sh: "ASDM7EC-fast 512+fs",
      profile: "Room EQ · sofa",
    },
    "Vinyl rips": {
      mode: "pcm",
      "1x": "poly-sinc-gauss-long",
      nx: "poly-sinc-gauss-hires-lp",
      sh: "NS9",
      adaptive: "1",
    },
  },
  Headphones: {
    Desk: {
      mode: "pcm",
      "1x": "poly-sinc-gauss-xla",
      nx: "poly-sinc-gauss-hires-mp",
      sh: "LNS15",
      profile: "[Default]",
    },
    Bed: {
      mode: "sdm",
      "1x": "poly-sinc-ext2",
      nx: "poly-sinc-ext2-hires-lp",
      sh: "ASDM5EC-light 512+fs",
      adaptive: "1",
    },
  },
  Office: {},
};

// `#many` mock (12 snapshots × 4 stations, no scroll): every station carries twelve.
const NAMES = [
  "Late night",
  "Daytime",
  "Vinyl rips",
  "Jazz",
  "Classical",
  "Live recordings",
  "Hi-res",
  "DSD archive",
  "Podcasts",
  "Party",
  "Reference",
  "Background",
];
const BASE = Object.values(SNAPSHOTS.Speakers);
export const MANY_STATIONS = [
  { name: "Speakers", active: true },
  { name: "Headphones" },
  { name: "Office" },
  { name: "Studio" },
];
export const MANY = Object.fromEntries(
  MANY_STATIONS.map((st) => [st.name, Object.fromEntries(NAMES.map((n, i) => [n, { ...BASE[i % BASE.length] }]))]),
);
// `#long` mock (1 station × 25 snapshots): Speakers carries twenty-five.
const MORE = [
  "Jazz trio",
  "Big band",
  "Opera",
  "Chamber",
  "Organ",
  "Choral",
  "Piano",
  "Guitar",
  "Folk",
  "Ambient",
  "Electronic",
  "Soundtracks",
  "Rock",
];
export const LONG = {
  ...SNAPSHOTS,
  Speakers: Object.fromEntries([...NAMES, ...MORE].map((n, i) => [n, { ...BASE[i % BASE.length] }])),
};
