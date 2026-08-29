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
// It lives in `hqptuner/data/easy-presets.json`, keyed by preset id and knob id,
// so that owner-approved copy is edited in one place and never here.

/**
 * @typedef {object} Knob
 *   One tile's adjustment. Presets carry zero, one or two.
 * @property {string} id
 * @property {string} default position used when the caller names none
 * @property {string[]} options
 *
 * @typedef {object} Preset
 * @property {string} id
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

// Emphasis is two positions everywhere it appears. It was three on the two
// flagship presets, whose third position took a `-short` filter; those are
// half-apodizing (data/filters.json) and every position left is full, which is
// why the tiles that carried them no longer warn about error correction.
/** @type {Knob} */
const EMPHASIS = { id: "emphasis", default: "space", options: ["space", "transients"] };

// Lossy material is a knob rather than a tile of its own: the lossy filters are
// the same presets aimed at material damaged by its encoder rather than by its
// mastering, and the tile someone already trusts is where they go looking for
// them. Lossless rests, because most material is.
//
// On the two flagship presets the knob picks how the two fields are filled.
// Lossless puts the standard filter on the 1x field and the hi-res filter on Nx,
// so the engine takes whichever suits the track it is playing. Lossy puts the
// hi-res filter on both, because lossy material reads as low rate and wants the
// hi-res filter anyway, which is a choice no rate can make for you.
/** @type {Knob} */
const MATERIAL = { id: "material", default: "lossless", options: ["lossless", "lossy"] };

/**
 * Every curated preset, in the order `docs/plans/filters-for-fuckwits.md` lists them.
 *
 * Reached through `presetsFor`, which is what the grid enumerates: the table
 * itself stays private so a caller cannot hold the frozen array and reorder it.
 *
 * @type {readonly Preset[]}
 */
const PRESETS = Object.freeze([
  { id: "perfect-ten", emoji: "🥇", knobs: [EMPHASIS, MATERIAL] },
  { id: "lifelike", emoji: "🎻", knobs: [EMPHASIS, MATERIAL] },
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
  { id: "damage-control", emoji: "🚑", knobs: [EMPHASIS, MATERIAL] },
]);

// Filter names per knob combination. A combination key is the preset's knob
// positions in knob order, joined by "/" (the empty string for a knob-less
// preset). A name given as {pcm, sdm} differs by chain: the daemon enumerates
// two-stage `-2s` variants on the SDM chain only, so those presets take the
// plain name on PCM and the `-2s` name on SDM.

/**
 * A preset writes one name to both the 1x and the Nx field of a chain, or the
 * pair it names when the two fields differ.
 *
 * @type {Record<string, Record<string, ChainName | Pair>>}
 */
const FILTERS = {
  // A crossed preset's key names its positions in the order the preset declares
  // its knobs, because that is the order `comboKey` joins them in. Reordering
  // the knobs on a tile therefore means reordering these keys with them: here
  // that is emphasis first, material second.
  // The lossless rows are pairs: the standard filter on the 1x field, the hi-res
  // one on Nx, so the engine takes whichever suits the track. The lossy rows put
  // the hi-res filter on both fields, because lossy material arrives at whatever
  // rate its encoder left it at and wants that filter regardless.
  "perfect-ten": {
    "space/lossless": { x1: "poly-sinc-gauss-long", nx: "poly-sinc-gauss-hires-lp" },
    "transients/lossless": { x1: "poly-sinc-gauss-medium", nx: "poly-sinc-gauss-hires-mp" },
    "space/lossy": "poly-sinc-gauss-hires-lp",
    "transients/lossy": "poly-sinc-gauss-hires-mp",
  },
  lifelike: {
    "space/lossless": { x1: "poly-sinc-ext2-long", nx: "poly-sinc-ext2-hires-lp" },
    "transients/lossless": { x1: "poly-sinc-ext2-medium", nx: "poly-sinc-ext2-hires-mp" },
    "space/lossy": "poly-sinc-ext2-hires-lp",
    "transients/lossy": "poly-sinc-ext2-hires-mp",
  },
  "old-school": {
    space: { pcm: "poly-sinc-short-lp", sdm: "poly-sinc-short-lp-2s" },
    transients: { pcm: "poly-sinc-short-mp", sdm: "poly-sinc-short-mp-2s" },
  },
  purist: {
    space: "poly-sinc-gauss-halfband",
    transients: "poly-sinc-gauss-halfband-s",
  },
  // The lossy rows put one name on both fields, unlike their lossless
  // neighbours. The family has no separate base-rate member for the 1x field:
  // these are hi-res filters whose own recommendation starts at 4x, and lossy
  // material is what they are for whatever rate it arrives at.
  "damage-control": {
    "space/lossless": { pcm: "poly-sinc-xtr-short-lp", sdm: "poly-sinc-xtr-short-lp-2s" },
    "transients/lossless": { pcm: "poly-sinc-xtr-short-mp", sdm: "poly-sinc-xtr-short-mp-2s" },
    "space/lossy": "poly-sinc-mqa/mp3-lp",
    "transients/lossy": "poly-sinc-mqa/mp3-mp",
  },
  "concert-hall": {
    "perfect-ten/on": "poly-sinc-gauss-xla",
    "perfect-ten/off": "poly-sinc-gauss-xl",
    "lifelike/on": "poly-sinc-ext2-xla",
    "lifelike/off": "poly-sinc-ext2-xl",
  },
};

// What a preset costs the machine, in pips, per chain. Owner-supplied numbers:
// they are a relative ranking of the presets against each other, not a measured
// quantity and not a filter specification.
//
// Only Damage Control changes family when its material knob moves: its lossless
// positions take the xtr-short filters and its lossy ones the mqa/mp3 family, so
// it is the one preset with a second row. The flagships take the same family in
// both positions and cost the same in both.
/**
 * @type {Record<string, {sdm: number, pcm: number}>}
 */
const PIPS = {
  "perfect-ten": { sdm: 2, pcm: 1 },
  lifelike: { sdm: 2, pcm: 1 },
  "concert-hall": { sdm: 16, pcm: 8 },
  purist: { sdm: 2, pcm: 1 },
  "old-school": { sdm: 1, pcm: 1 },
  "damage-control": { sdm: 1, pcm: 3 },
};

/** @type {Record<string, {sdm: number, pcm: number}>} */
const LOSSY_PIPS = { "damage-control": { sdm: 2, pcm: 1 } };

// The presets whose Emphasis knob picks a filter LENGTH rather than a phase:
// Space takes the longer filter of the pair and costs a pip more for it. On the
// rest of the card the knob moves between `-lp` and `-mp`, which is the same
// filter run at a different phase and the same work either way, so their tiles
// read the same in both positions.
//
// The table above is therefore the Transients figure for these three, and the
// resting position, Space, is the one that adds to it.
const LENGTH_EMPHASIS = new Set(["perfect-ten", "lifelike", "purist"]);

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
 * The presets, in display order.
 *
 * @returns {Preset[]}
 */
export function presetsFor() {
  return [...PRESETS];
}

/**
 * @param {string} presetId
 * @returns {Preset | undefined}
 */
function findPreset(presetId) {
  return PRESETS.find((p) => p.id === presetId);
}

/**
 * How many pips a preset shows for an output mode — 0 for a preset this module
 * does not carry.
 *
 * Auto shows the PCM number rather than both or the larger: nearly all material
 * is PCM, and a tile that quoted the SDM cost to someone who will never reach
 * that chain would be quoting a number that never comes true for them.
 *
 * @param {string} presetId
 * @param {string} outputMode "pcm" | "sdm" | "auto"
 * @param {Record<string, string>} [knobs] knob id -> option id
 * @returns {number}
 */
export function pipsFor(presetId, outputMode, knobs = {}) {
  const row = (knobs.material === "lossy" && LOSSY_PIPS[presetId]) || PIPS[presetId];
  if (!row) return 0;
  let cost = outputMode === "sdm" ? row.sdm : row.pcm;
  if (knobs.emphasis === "space" && LENGTH_EMPHASIS.has(presetId)) cost += 1;
  // Error correction off costs one pip less, which is the same thing that knob's
  // own tip says in words. One pip rather than a proportion: the tiles carrying
  // the knob are the expensive ones, and a pip is the smallest thing this scale
  // can say.
  return knobs.correction === "off" ? Math.max(cost - 1, 1) : cost;
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
 * @param {string} presetId
 * @param {string} combo
 * @returns {Pair | undefined}
 */
function pairFor(presetId, combo) {
  const one = (FILTERS[presetId] || {})[combo];
  if (one === undefined) return undefined;
  // A row is a pair already or a single name to put on both fields. The two are
  // told apart by `x1` rather than by asking whether the row is an object,
  // because a single name is itself an object whenever the chains disagree
  // ({pcm, sdm}).
  return typeof one === "object" && "x1" in one ? one : { x1: one, nx: one };
}

/**
 * The field/value pairs to stage for a preset.
 *
 * @param {string} presetId
 * @param {string} outputMode "pcm" | "sdm" | "auto"
 * @param {Record<string, string>} [knobs] knob id -> option id
 * @returns {Record<string, string>} schema key -> filter name
 */
export function writeSet(presetId, outputMode, knobs = {}) {
  const preset = findPreset(presetId);
  const pair = preset && pairFor(presetId, comboKey(preset, knobs));
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
 * @returns {{presetId: string, knobs: Record<string, string>} | null}
 */
export function matchPreset(values, outputMode) {
  for (const preset of PRESETS) {
    for (const knobs of combos(preset)) {
      if (matches(writeSet(preset.id, outputMode, knobs), values)) {
        return { presetId: preset.id, knobs };
      }
    }
  }
  return null;
}
