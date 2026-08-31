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
 * @property {Record<string, string>} [when] sibling positions required for this knob to be offered
 * @property {boolean} [whenHires] offered only while the filter the tile names is a hi-res one
 * @property {boolean} [card] set once on the card rather than on each tile; its position reaches every tile that takes it
 *
 * @typedef {object} Preset
 * @property {string} id
 * @property {string} emoji
 * @property {Knob[]} knobs
 * @property {boolean} [hires] wears the hi-res badge
 * @property {boolean} [costText] cost row is a caption, not pips (prose key "cost")
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

// Emphasis is two positions everywhere it appears.
/** @type {Knob} */
const EMPHASIS = { id: "emphasis", default: "space", options: ["space", "transients"] };

// Emphasis is a PHASE lever and only that. The flagships move their hi-res
// filter alone, so `whenHires` offers the knob only while that is the filter the
// tile names — an engine question, applied in store/easyoffer.js.
/** @type {Knob} */
const EMPHASIS_HIRES = { ...EMPHASIS, whenHires: true };

// Lossy material is a knob rather than a tile of its own: the lossy filters are
// the same presets aimed at material damaged by its encoder rather than by its
// mastering. Lossless rests, because most material is lossless. A CARD knob: the
// source is a fact about what is playing, not about a preset, so it is set once
// on the card (store/easyview.js) and every tile that takes it follows.
//
// On the flagships the knob picks how the two fields are filled. Lossless puts
// the standard filter on 1x and the hi-res filter on Nx, so the engine takes
// whichever suits the track. Lossy puts the hi-res filter on both, because lossy
// material reads as low rate and wants that filter anyway.
/** @type {Knob} */
const MATERIAL = { id: "material", default: "lossless", options: ["lossless", "lossy"], card: true };

/**
 * Every curated preset, in the grid order the owner set.
 *
 * The order is display copy, not a fact about the presets: it is the owner's to
 * rearrange, and nothing derives from a preset's position here.
 *
 * Reached through `presetsFor`, which is what the grid enumerates: the table
 * itself stays private so a caller cannot hold the frozen array and reorder it.
 *
 * @type {readonly Preset[]}
 */
const PRESETS = Object.freeze([
  // `hires` is stated per preset rather than read off the filters, because the
  // two are not the same set. Detecting it from the filter would ask
  // `hiresFamily` (store/narrow/facets.js), which matches mqa and mp3 in a name
  // as well as hires — so Damage Control would wear the badge in its Lossy
  // positions, where the filter is aimed at a damaged encode rather than at a
  // high source rate. The badge names the second thing, and only these two.
  { id: "perfect-ten", emoji: "🥇", hires: true, knobs: [EMPHASIS_HIRES, MATERIAL] },
  { id: "lifelike", emoji: "🎻", hires: true, knobs: [EMPHASIS_HIRES, MATERIAL] },
  { id: "damage-control", emoji: "🚑", knobs: [EMPHASIS, MATERIAL] },
  { id: "old-school", emoji: "📻", knobs: [{ ...EMPHASIS, default: "transients" }] },
  { id: "purist", emoji: "💧", knobs: [] },
  {
    id: "concert-hall",
    emoji: "🏛️",
    knobs: [
      { id: "version", default: "perfect-ten", options: ["perfect-ten", "lifelike"] },
      { id: "correction", default: "on", options: ["on", "off"] },
    ],
  },
  // One second knob at a time: Version decides whether the tile offers Error
  // correction (gauss pair) or Emphasis (ext2 pair); the other is not counted.
  {
    id: "crucible",
    emoji: "🔥",
    costText: true,
    knobs: [
      { id: "version", default: "perfect-ten", options: ["perfect-ten", "lifelike"] },
      { id: "correction", default: "on", options: ["on", "off"], when: { version: "perfect-ten" } },
      { ...EMPHASIS, when: { version: "lifelike" } },
    ],
  },
  // The bottom-row pair. Full Analog has no cost row in store/easycost.js on
  // purpose: its cost is stated as a caption (costText), not ranked against
  // the card.
  { id: "full-analog", emoji: "🎛️", costText: true, knobs: [] },
  {
    id: "textbook",
    emoji: "📖",
    knobs: [{ id: "emphasis", default: "balanced", options: ["space", "balanced", "transients"] }],
  },
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
    "transients/lossless": { x1: "poly-sinc-gauss-long", nx: "poly-sinc-gauss-hires-mp" },
    "space/lossy": "poly-sinc-gauss-hires-lp",
    "transients/lossy": "poly-sinc-gauss-hires-mp",
  },
  lifelike: {
    "space/lossless": { x1: "poly-sinc-ext2", nx: "poly-sinc-ext2-hires-lp" },
    "transients/lossless": { x1: "poly-sinc-ext2", nx: "poly-sinc-ext2-hires-mp" },
    "space/lossy": "poly-sinc-ext2-hires-lp",
    "transients/lossy": "poly-sinc-ext2-hires-mp",
  },
  "old-school": {
    space: { pcm: "poly-sinc-short-lp", sdm: "poly-sinc-short-lp-2s" },
    transients: { pcm: "poly-sinc-short-mp", sdm: "poly-sinc-short-mp-2s" },
  },
  purist: { "": "poly-sinc-gauss-halfband" },
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
  // Keys name offered knobs only: Version plus the one knob it puts on the tile.
  // Pure sinc names enumerate identically on both chains, no `-2s`.
  crucible: {
    "perfect-ten/on": "sinc-MGa",
    "perfect-ten/off": "sinc-MG",
    "lifelike/space": "sinc-Mx",
    "lifelike/transients": "sinc-S",
  },
  // These names enumerate identically on both chains, with no `-2s` variants,
  // so one plain name serves every field (data/engine-enums.json).
  "full-analog": { "": "IIR2" },
  textbook: {
    space: "FIR",
    balanced: "asymFIR",
    transients: "minphaseFIR",
  },
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
 * Where one knob sits: the caller's position if the knob offers it, else its default.
 *
 * @param {Knob} knob
 * @param {Record<string, string>} knobs
 * @returns {string}
 */
function positionOf(knob, knobs) {
  return knob.options.includes(knobs[knob.id]) ? knobs[knob.id] : knob.default;
}

/**
 * The knobs a tile offers at these positions, in declared order. A knob is
 * offered when every sibling its `when` names sits where asked; one whose
 * `when` is unmet is neither shown nor counted in the write.
 *
 * @param {Preset} preset
 * @param {Record<string, string>} knobs
 * @returns {Knob[]}
 */
export function knobsShown(preset, knobs) {
  return preset.knobs.filter((knob) =>
    Object.entries(knob.when || {}).every(([id, at]) => {
      const sibling = preset.knobs.find((k) => k.id === id);
      return sibling !== undefined && positionOf(sibling, knobs) === at;
    }),
  );
}

/**
 * The combination key for a preset's knob positions: the offered knobs'
 * positions in declared order, a knob's default standing in for any position
 * the preset does not define.
 *
 * @param {Preset} preset
 * @param {Record<string, string>} knobs
 * @returns {string}
 */
function comboKey(preset, knobs) {
  return knobsShown(preset, knobs)
    .map((k) => positionOf(k, knobs))
    .join("/");
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

// Which filter a tile NAMES, as opposed to which four it writes. A tile shows
// one name, so two things have to be decided that `writeSet` never has to: which
// chain, and which of that chain's two fields.
//
// The chain follows the pips rather than the apodizing mark (Tile.js says why
// each does what it does): a name is one of the things that genuinely differs
// between the chains, because the daemon enumerates the `-2s` two-stage variants
// on SDM only. Auto names the PCM chain for the same reason auto quotes the PCM
// cost — nearly all material is PCM, and naming a filter the listener will never
// reach is naming the wrong one.
//
// The field is the caller's: 1x unless the playing source is an Nx rate
// (store/live/derive.js sourceIsNx). Only the two flagship presets hold
// different filters in the two fields at all; every other preset answers the
// same either way, and the lossy positions put the hi-res filter on both fields
// already, so lossy needs no rule of its own here.
/**
 * The filter name a preset's tile displays, "" when the combination names nothing.
 *
 * @param {string} presetId
 * @param {string} outputMode "pcm" | "sdm" | "auto"
 * @param {Record<string, string>} [knobs] knob id -> option id
 * @param {boolean} [nx] name the Nx field's filter rather than the 1x field's
 * @returns {string}
 */
export function filterFor(presetId, outputMode, knobs = {}, nx = false) {
  const chain = outputMode === "sdm" ? "sdm" : "pcm";
  const keys = KEYS[chain];
  return writeSet(presetId, chain, knobs)[nx ? keys.nx : keys.x1] || "";
}

/**
 * Every knob position combination a preset offers, as knob-id maps. A knob not
 * offered at a partial combination is absent from the maps grown from it. A
 * `when` may only name knobs declared before its own, the order the sweep fixes.
 *
 * @param {Preset} preset
 * @returns {Record<string, string>[]}
 */
export function combos(preset) {
  /** @type {Record<string, string>[]} */
  let acc = [{}];
  for (const k of preset.knobs) {
    acc = acc.flatMap((c) => (knobsShown(preset, c).includes(k) ? k.options.map((o) => ({ ...c, [k.id]: o })) : [c]));
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
