// Easy Mode's preset data. Pure: no signals, no DOM, no network — the tiles
// that render this arrive in a later phase and drive themselves entirely from
// `writeSet` (what to stage when a tile is clicked) and `matchPreset` (which
// tile the current field values light up).
//
// Values here are filter NAMES, never enum ids: the running engine is the sole
// authority for ids and ordering, and static data joins by name (architecture
// §2). The caller resolves a name to that field's id for the field it stages.
//
// Prose — titles, descriptions, notes, knob labels — is deliberately absent.
// It lives in `hqptuner/data/easy-presets.json`, keyed by grid, preset id and
// knob id, so that owner-approved copy is edited in one place and never here.

/**
 * @typedef {object} Knob
 *   One tile's adjustment. Presets carry zero, one or two.
 * @property {string} id
 * @property {string} default position used when the caller names none
 * @property {string[]} options
 *
 * @typedef {object} Preset
 * @property {string} id unique within its grid
 * @property {string} emoji
 * @property {Knob[]} knobs
 *
 * @typedef {string | {pcm: string, sdm: string}} ChainName
 *   One filter name, or the two a preset takes when the chains differ.
 *
 * @typedef {{x1: ChainName, nx: ChainName}} Pair
 *   What one chain's two fields receive.
 */

/**
 * The four filter fields, by schema key, per chain.
 *
 * @type {Record<string, {x1: string, nx: string}>}
 */
const KEYS = {
  pcm: { x1: "pcm_filter_1x", nx: "pcm_filter_nx" },
  sdm: { x1: "sdm_filter_1x", nx: "sdm_filter_nx" },
};

/** @type {("album"|"playlist")[]} */
const GRIDS = ["album", "playlist"];

// Emphasis is two positions everywhere it appears. It was three on the two
// flagship presets, whose third position took a `-short` filter; those are
// half-apodizing (data/filters.json) and every position left is full, which is
// why the tiles that carried them no longer warn about error correction.
/** @type {Knob} */
const EMPHASIS = { id: "emphasis", default: "space", options: ["space", "transients"] };

// The two flagship presets carry a second knob instead of a second tile: the
// hi-res filters are the same preset aimed at 88.2 kHz and up, not a different
// idea, and as a knob they cross with Emphasis to fill all four combinations.
/** @type {Knob} */
const SOURCE = { id: "source", default: "standard", options: ["standard", "hires"] };

/**
 * Every curated preset, in the order `docs/plans/filters-for-fuckwits.md` lists them.
 *
 * Reached through `presetsFor`, which is what the grid enumerates: the table
 * itself stays private so a caller cannot hold the frozen object and index it
 * with a grid name this module has never heard of.
 *
 * @type {Record<string, Preset[]>}
 */
const PRESETS = Object.freeze({
  playlist: [
    { id: "perfect-ten", emoji: "🥇", knobs: [] },
    { id: "lifelike", emoji: "🎻", knobs: [] },
  ],
  album: [
    { id: "perfect-ten", emoji: "🥇", knobs: [SOURCE, EMPHASIS] },
    { id: "lifelike", emoji: "🎻", knobs: [SOURCE, EMPHASIS] },
    {
      id: "concert-hall",
      emoji: "🏛️",
      knobs: [
        { id: "version", default: "perfect-ten", options: ["perfect-ten", "lifelike"] },
        { id: "correction", default: "on", options: ["on", "off"] },
      ],
    },
    { id: "purist", emoji: "💧", knobs: [EMPHASIS] },
    { id: "old-school", emoji: "📻", knobs: [{ ...EMPHASIS, default: "transients" }] },
    { id: "damage-control", emoji: "🚑", knobs: [EMPHASIS] },
  ],
});

// Filter names per knob combination. A combination key is the preset's knob
// positions in knob order, joined by "/" (the empty string for a knob-less
// preset). A name given as {pcm, sdm} differs by chain: the daemon enumerates
// two-stage `-2s` variants on the SDM chain only, so those presets take the
// plain name on PCM and the `-2s` name on SDM.

/**
 * Album Mode writes one name to both the 1x and the Nx field of a chain.
 *
 * @type {Record<string, Record<string, ChainName>>}
 */
const ALBUM = {
  "perfect-ten": {
    "standard/space": "poly-sinc-gauss-long",
    "standard/transients": "poly-sinc-gauss-medium",
    "hires/space": "poly-sinc-gauss-hires-lp",
    "hires/transients": "poly-sinc-gauss-hires-mp",
  },
  lifelike: {
    "standard/space": "poly-sinc-ext2-long",
    "standard/transients": "poly-sinc-ext2-medium",
    "hires/space": "poly-sinc-ext2-hires-lp",
    "hires/transients": "poly-sinc-ext2-hires-mp",
  },
  "old-school": {
    space: { pcm: "poly-sinc-short-lp", sdm: "poly-sinc-short-lp-2s" },
    transients: { pcm: "poly-sinc-short-mp", sdm: "poly-sinc-short-mp-2s" },
  },
  purist: {
    space: "poly-sinc-gauss-halfband",
    transients: "poly-sinc-gauss-halfband-s",
  },
  "damage-control": {
    space: { pcm: "poly-sinc-xtr-short-lp", sdm: "poly-sinc-xtr-short-lp-2s" },
    transients: { pcm: "poly-sinc-xtr-short-mp", sdm: "poly-sinc-xtr-short-mp-2s" },
  },
  "concert-hall": {
    "perfect-ten/on": "poly-sinc-gauss-xla",
    "perfect-ten/off": "poly-sinc-gauss-xl",
    "lifelike/on": "poly-sinc-ext2-xla",
    "lifelike/off": "poly-sinc-ext2-xl",
  },
};

/**
 * Playlist Mode writes a distinct 1x/Nx pair. Neither preset has a knob.
 *
 * @type {Record<string, Record<string, Pair>>}
 */
const PLAYLIST = {
  "perfect-ten": { "": { x1: "poly-sinc-gauss-long", nx: "poly-sinc-gauss-hires-lp" } },
  lifelike: { "": { x1: "poly-sinc-ext2-long", nx: "poly-sinc-ext2-hires-lp" } },
};

/**
 * The chain's name for a value that may differ by chain.
 *
 * @param {ChainName} value
 * @param {string} chain
 * @returns {string}
 */
function chainName(value, chain) {
  return typeof value === "string" ? value : value[chain === "sdm" ? "sdm" : "pcm"];
}

/**
 * The chains an output mode writes and matches.
 *
 * @param {string} outputMode
 * @returns {string[]}
 */
function chainsFor(outputMode) {
  return outputMode === "auto" ? ["pcm", "sdm"] : [outputMode];
}

/**
 * One grid's presets, in display order — empty for a grid this module does not carry.
 *
 * @param {string} grid "album" | "playlist"
 * @returns {Preset[]}
 */
export function presetsFor(grid) {
  return PRESETS[grid] || [];
}

/**
 * @param {string} grid
 * @param {string} presetId
 * @returns {Preset | undefined}
 */
function findPreset(grid, presetId) {
  return presetsFor(grid).find((p) => p.id === presetId);
}

/**
 * The combination key for a preset's knob positions, substituting the knob's
 * default for any position the preset does not define.
 *
 * @param {Preset} preset
 * @param {Record<string, string>} knobs
 * @returns {string}
 */
function comboKey(preset, knobs) {
  return preset.knobs.map((k) => (k.options.includes(knobs[k.id]) ? knobs[k.id] : k.default)).join("/");
}

/**
 * What one chain's two fields receive for a preset at one knob combination,
 * or undefined when the combination names nothing.
 *
 * @param {string} grid
 * @param {string} presetId
 * @param {string} combo
 * @returns {Pair | undefined}
 */
function pairFor(grid, presetId, combo) {
  if (grid !== "album") return (PLAYLIST[presetId] || {})[combo];
  const one = (ALBUM[presetId] || {})[combo];
  return one === undefined ? undefined : { x1: one, nx: one };
}

/**
 * The field/value pairs to stage for a preset.
 *
 * @param {string} grid "album" | "playlist"
 * @param {string} presetId
 * @param {string} outputMode "pcm" | "sdm" | "auto"
 * @param {Record<string, string>} [knobs] knob id -> option id
 * @returns {Record<string, string>} schema key -> filter name
 */
export function writeSet(grid, presetId, outputMode, knobs = {}) {
  const preset = findPreset(grid, presetId);
  const pair = preset && pairFor(grid, presetId, comboKey(preset, knobs));
  if (!pair) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const chain of chainsFor(outputMode)) {
    const keys = KEYS[chain];
    if (!keys) continue;
    out[keys.x1] = chainName(pair.x1, chain);
    out[keys.nx] = chainName(pair.nx, chain);
  }
  return out;
}

/**
 * Every knob position combination a preset offers, as knob-id maps.
 *
 * @param {Preset} preset
 * @returns {Record<string, string>[]}
 */
function combos(preset) {
  /** @type {Record<string, string>[]} */
  let acc = [{}];
  for (const k of preset.knobs) {
    acc = acc.flatMap((c) => k.options.map((o) => ({ ...c, [k.id]: o })));
  }
  return acc;
}

/**
 * Whether every pair in `want` is present and equal in `values`.
 *
 * @param {Record<string, string>} want
 * @param {Record<string, string>} values
 * @returns {boolean}
 */
function matches(want, values) {
  const pairs = Object.entries(want);
  return pairs.length > 0 && pairs.every(([key, name]) => values[key] === name);
}

/**
 * Which preset and knob positions the current filter field values correspond to.
 *
 * Selection is always derived, never stored: values that match nothing return
 * null, and under "auto" both chains must correspond to the same preset and
 * the same knob positions for it to count as a match.
 *
 * @param {Record<string, string>} values schema key -> filter name
 * @param {string} outputMode "pcm" | "sdm" | "auto"
 * @returns {{grid: string, presetId: string, knobs: Record<string, string>} | null}
 */
export function matchPreset(values, outputMode) {
  for (const grid of GRIDS) {
    for (const preset of presetsFor(grid)) {
      for (const knobs of combos(preset)) {
        if (matches(writeSet(grid, preset.id, outputMode, knobs), values)) {
          return { grid, presetId: preset.id, knobs };
        }
      }
    }
  }
  return null;
}
