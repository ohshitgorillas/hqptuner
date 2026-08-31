// The harness for Easy Mode's preset tiles: the daemon form and engine
// enumeration the two lanes are driven with, the wire both lanes are watched
// over, the readers a rendering is asked questions through, and the click seam
// a cell is pressed by. The cases themselves are
// tests/js/components/easytiles.test.js.
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// It is imported DYNAMICALLY by that suite, after its `useStorage()` call, and
// must stay that way — `store/easyview.js` reads localStorage at import, so a
// static import here would load it before the fake storage is installed.
//
// WHERE THE FILTER NAMES COME FROM. Not typed out: the curated table is
// `writeSet`'s and `presetsFor`'s, both of which ship, so this module asks THEM
// which presets exist, which knob positions each defines and which filter each
// combination names, then builds a form and an enumeration offering exactly
// those filters. A name stated by hand would be a second copy of the table,
// drifting the first time the owner curates it.
//
// The two chains are enumerated DIFFERENTLY, as the daemon enumerates them: the
// `-2s` two-stage variants exist on the SDM chain only, and the PCM chain never
// lists one. A lane that wrote a `-2s` name to a PCM field therefore has
// nothing to resolve it against.
//
// IDS VERSUS NAMES. Both lanes VALUE a filter field by its enum id and LABEL it
// by the engine's filter name (docs/architecture.md §2), so every filter here
// gets an id differing from its position in every list it appears in: a lane
// writing the name, the index or the label instead of the id fails loudly
// rather than coinciding with the right answer.

import { options } from "preact";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { EasyCard } from "../../../hqptuner/static/components/easy/EasyCard.js";
import { writeSet, presetsFor, knobsShown } from "../../../hqptuner/static/store/easy.js";
import { easyMode, easyKnobs } from "../../../hqptuner/static/store/easyview.js";
import * as signals from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { liveMode, showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { liveErrors, liveBusy } from "../../../hqptuner/static/store/live/state.js";
import * as narrow from "../../../hqptuner/static/store/narrow/state.js";
import { everyWrite } from "./easytable.js";
import { stagingWire, quiesce, ok } from "./wire.js";
import { elements, classes, attr } from "./markup.js";
import { engineRows, configPayload, enumerations, tabEnums, loaded } from "./easyrate.js";

/** @typedef {import("./wheel.js").VNode} VNode */
/** @typedef {import("./markup.js").MarkupElement} MarkupElement */
/** @typedef {import("./wire.js").StagingWire} StagingWire */
/** @typedef {import("./easyrate.js").Engine} Engine */
/** @typedef {{ id: string, default: string, options: string[], when?: Record<string, string>, whenHires?: boolean }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[] }} Preset */

// --- the four filter fields -------------------------------------------------------
//
// Schema keys on the left (store/schema.js), the daemon's own form-field names
// on the right — `filter1x` / `filter` for the PCM chain and `oversampling1x` /
// `oversampling` for the SDM chain, which is what the config form and the live
// form alike key them by (store/live/derive.js).

const PCM_1X = "pcm_filter_1x";
const PCM_NX = "pcm_filter_nx";
const SDM_1X = "sdm_filter_1x";
const SDM_NX = "sdm_filter_nx";

/** @type {Record<string, string>} */
const FIELD = {
  [PCM_1X]: "filter1x",
  [PCM_NX]: "filter",
  [SDM_1X]: "oversampling1x",
  [SDM_NX]: "oversampling",
};

export const PCM_FIELDS = [FIELD[PCM_1X], FIELD[PCM_NX]].sort();
export const SDM_FIELDS = [FIELD[SDM_1X], FIELD[SDM_NX]].sort();
export const ALL_FIELDS = [...PCM_FIELDS, ...SDM_FIELDS].sort();

// --- the filter names the curated table can write ------------------------------------
//
// The sweep of the table itself is tests/js/support/easytable.js, shared with
// the pure store suite; what this module does with it is build a daemon form
// and an engine enumeration offering exactly the filters that sweep names.

/**
 * The distinct filter names the table writes to a set of schema keys.
 *
 * @param {string[]} keys
 * @returns {string[]}
 */
const namesOn = (keys) => [
  ...new Set(
    everyWrite()
      .flatMap((/** @type {Record<string, string>} */ set) => keys.map((key) => set[key]))
      .filter(Boolean),
  ),
];

const PCM_NAMES = namesOn([PCM_1X, PCM_NX]);
const SDM_NAMES = namesOn([SDM_1X, SDM_NX]);
const ALL_NAMES = [...new Set([...PCM_NAMES, ...SDM_NAMES])];

// The engine's own ids. `i * 7 + 3` so no id coincides with a list index or with
// the "none" entry every list starts from.
const NONE = { value: "0", label: "none" };
/** @type {Map<string, string>} */
const ID = new Map(ALL_NAMES.map((name, i) => [name, String(i * 7 + 3)]));
/** @type {Map<string, string>} */
const NAME_OF = new Map([
  /** @type {[string, string]} */ ([NONE.value, NONE.label]),
  ...ALL_NAMES.map((name) => /** @type {[string, string]} */ ([String(ID.get(name)), name])),
]);

/** @param {string} name */
const idOf = (name) => String(ID.get(name));

// --- what the shipped table names ----------------------------------------------------
//
// A knob option id is NOT unique across the card — `emphasis` carries the same
// two option ids on five tiles and `material` the same two on three — so
// `pressKnob` takes the preset whose tile it is pressing and refuses on an
// ambiguous match within it, rather than pressing whichever tile came first in
// the vnode stream.

// The roster the active-marking map is read over, in display order.
// `presetsFor` is the public enumeration of which tiles the card has, and the
// composition cases pin how many that is. A case that needs "some tile" takes
// one by position (`ROSTER[0]`, `ROSTER[1]`), and a case that needs a tile with
// a property selects it off `presetsFor()`; no preset is named to stand for
// either.
export const ROSTER = presetsFor().map((/** @type {Preset} */ preset) => String(preset.id));

/**
 * The presets the public store names for the card, as a SORTED list of ids.
 *
 * Sorted on the way out, so that nothing reading it can pin the order the owner
 * lays the grid out in — a display order is owner-owned data, rearranged at
 * will (docs/testing.md rule 9). Which ids are in the list is the contract; the
 * sequence is not. A preset id is a wire identifier, so the ids themselves come
 * from `presetsFor` rather than being typed out, and a case comparing against
 * this asks the card and the store to agree instead of asking either to agree
 * with a literal.
 *
 * @returns {string[]}
 */
export const namedPresets = () => [...ROSTER].sort();

// --- the daemon's config form -----------------------------------------------------

const MODES = [
  { value: "pcm", label: "PCM" },
  { value: "sdm", label: "SDM" },
  { value: "auto", label: "Auto" },
];

/**
 * One filter dropdown: the ids and names the daemon offers for that chain, plus
 * the "none" a field is parked on when a case wants no preset matched.
 *
 * @param {string[]} names
 * @param {string} [chosen]
 */
const pick = (names, chosen) => ({
  value: chosen === undefined ? NONE.value : idOf(chosen),
  options: [NONE, ...names.map((name) => ({ value: idOf(name), label: name }))],
});

/**
 * The daemon's form as /api/config serves it: keyed by form-field name, each
 * filter field carrying its own chain's enumeration.
 *
 * @param {string} mode
 * @param {Record<string, string>} names filter names by SCHEMA key
 * @param {Engine} [engine]
 */
const FORM = (mode, names, engine = {}) => ({
  ...engineRows(engine),
  mode: { value: mode, options: MODES },
  filter1x: pick(PCM_NAMES, names[PCM_1X]),
  filter: pick(PCM_NAMES, names[PCM_NX]),
  oversampling1x: pick(SDM_NAMES, names[SDM_1X]),
  oversampling: pick(SDM_NAMES, names[SDM_NX]),
});

// --- the engine's own enumeration and state ----------------------------------------

// The enumerated vocabulary the engine's own lists are built out of
// (tests/js/support/easyrate.js): every name the curated table can write, the id
// each carries, and the "none" every list starts from.
const VOCAB = { names: ALL_NAMES, idOf, none: NONE };

// The card's own prose comes off /api/metadata. A stand-in, never compared
// against what ships — the tiles are what is under test.
const META = {
  settings: {},
  filters: { filters: {}, aliases: {} },
  shapers: { pcm_dithers: {}, sdm_modulators: {} },
  easy: { notice: "A stand-in notice, seeded by the suite." },
};

// --- what a preset means, read through the shipped table ------------------------------

/**
 * Whether a knob is one the tile offers whatever the source is. A knob carrying
 * `whenHires` is offered only while the filter its tile names is a hi-res one,
 * and these suites seed no hi-res source, so such a knob is not on the tile
 * here. Sweeps enumerating knobs out of `knobsShown()` filter by this: the
 * store's declaration stays the oracle, and a knob the source gates out of the
 * rendering generates no case.
 *
 * @param {Knob} knob
 * @returns {boolean}
 */
export const offeredAnySource = (knob) => !knob.whenHires;

/**
 * Whether the fields can carry a combination. A knob its `when` hides at a
 * combination writes nothing there, so a combination parking a hidden knob off
 * its default seeds the very same fields as the one parking it at default, and
 * a case built on it would restate that one. Only the representable ones seed.
 *
 * @param {Preset} preset
 * @param {Record<string, string>} knobs
 */
export const seedable = (preset, knobs) => {
  const shown = new Set(knobsShown(preset, knobs).map((knob) => String(knob.id)));
  return preset.knobs.every((knob) => shown.has(String(knob.id)) || knobs[String(knob.id)] === knob.default);
};

/**
 * The filter names a preset's write set parks the four fields on, by schema key
 * — what the daemon's form carries while that preset is the one in force.
 *
 * @param {string} presetId
 * @param {Record<string, string>} [knobs]
 * @returns {Record<string, string>}
 */
export const inForce = (presetId, knobs = {}) => writeSet(presetId, "auto", knobs);

/**
 * The two PCM filter names a preset leaves the engine running, for seeding the
 * LIVE lane's State. The knob positions default to the resting ones.
 *
 * @param {string} presetId
 * @param {Record<string, string>} [knobs]
 * @returns {{ oneX: string, nX: string }}
 */
export function running(presetId, knobs = {}) {
  const set = writeSet(presetId, "pcm", knobs);
  return { oneX: set[PCM_1X], nX: set[PCM_NX] };
}

/**
 * A DISTINCT pair on the two ends of the PCM chain, keyed by SCHEMA key — what a
 * chain-splitting preset's write set looks like, stated by name rather than
 * derived, for seeding `resetTab` from the owner's table instead of the
 * module's. The two ends carry different names.
 *
 * @param {string} oneX
 * @param {string} nX
 * @returns {Record<string, string>}
 */
export const seedPcmPair = (oneX, nX) => ({ [PCM_1X]: oneX, [PCM_NX]: nX });

/**
 * The write set a preset stands for, keyed by the daemon's form-field names.
 * `writeSet` is the authority; this only renames its keys.
 *
 * @param {string} presetId
 * @param {"pcm" | "sdm" | "auto"} mode
 * @param {Record<string, string>} [knobs]
 * @returns {Record<string, string>}
 */
export const expectedNames = (presetId, mode, knobs = {}) =>
  Object.fromEntries(Object.entries(writeSet(presetId, mode, knobs)).map(([key, name]) => [FIELD[key], name]));

/**
 * What the LIVE lane must post for a preset in PCM mode: the two PCM live
 * fields, each valued by the engine's enum id for the preset's filter. The knob
 * positions default to the resting ones.
 *
 * @param {string} presetId
 * @param {Record<string, string>} [knobs]
 * @returns {Record<string, string>}
 */
export function liveExpected(presetId, knobs = {}) {
  const set = writeSet(presetId, "pcm", knobs);
  return { [FIELD[PCM_1X]]: idOf(set[PCM_1X]), [FIELD[PCM_NX]]: idOf(set[PCM_NX]) };
}

/**
 * The card with one tile lit, or none when handed null. The roster comes from
 * `presetsFor`, the public enumeration of which tiles the card has.
 *
 * @param {string | null} presetId
 * @returns {Record<string, string>}
 */
export const oneLit = (presetId) => Object.fromEntries(ROSTER.map((id) => [id, id === presetId ? "1" : "0"]));

export const EMPTY = { live: {}, http: {} };

// --- the wire ----------------------------------------------------------------------
//
// One staging server for both lanes, so a case can ask what reached the tabs
// lane's path AND what reached the LIVE lane's in the same run: stage requests
// land in the buffer `stagingWire` holds, live writes land in `w.posts`. The
// read endpoints answer what the signals already hold, so a write that
// re-mirrors afterwards puts back what it found.

/**
 * @param {string} path
 * @param {import("./wire.js").FakeRequest} opts
 * @param {StagingWire} w
 */
const routes = (path, opts, w) => {
  if (path === "/api/config/live") {
    w.posts.push(JSON.parse(String(opts.body)));
    return ok({ live: [] });
  }
  if (path === "/api/state") return ok({ stale: false, loaded_at: 1, data: signals.engineState.value });
  if (path === "/api/enumerations") return ok({ data: signals.enums.value });
  if (path === "/api/config") return ok({ data: signals.config.value });
  return undefined;
};

/**
 * Every fetch this wire was handed, and every continuation waiting on one, run
 * to a standstill. Turns of the event loop, never a stopwatch (rule 7).
 *
 * @param {StagingWire} w
 */
export async function flush(w) {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
  await quiesce(w);
}

// --- resets ------------------------------------------------------------------------
//
// Module-level signals outlive a test, so every signal either lane reads is put
// back on every reset, not only the ones a case cares about.

/**
 * `easyKnobs` — the knob positions each tile was last written at — is a
 * module-level signal like the rest, and a press made by one case is still
 * recorded when the next one renders, so it is put back here with them. A case
 * that wants a record to SURVIVE a reset asks for `keepKnobs`, which is how the
 * two lanes are shown sharing one record: the reset is what switching lanes
 * looks like from the harness, and the record is meant to cross it.
 *
 * `copy` is the owner copy /api/metadata carries for the tiles, keyed by preset
 * id (`easy.<presetId>`, the shape tests/api/test_metadata_easy.py pins). Every
 * case that does not name it gets the bare notice the fixture has always
 * carried, so a tile shows no prose at all; a case reading what a description
 * RENDERS seeds its own stand-in text here and never meets what ships.
 *
 * @param {boolean} keepKnobs
 * @param {boolean} notes
 * @param {Record<string, object>} copy
 */
function common(keepKnobs, notes, copy) {
  if (!keepKnobs) easyKnobs.value = {};
  signals.metadata.value = { ...META, easy: { ...META.easy, ...copy } };
  signals.matrixConfig.value = { fields: [] };
  // The preview a click in the presets pane leaves behind is module-level like
  // the rest and outlives a case, so it is put back on every reset whether or
  // not the case that follows seeds one.
  signals.previewConfig.value = null;
  signals.pendingPreset.value = null;
  signals.health.value = { reachable: true, info: {} };
  showDescriptions.value = notes;
  keepOptionDescriptions.value = true;
  liveErrors.value = {};
  liveBusy.value = "";
  narrow.resetNarrowing();
  easyMode.value = true;
}

/**
 * The tabs lane: the daemon's form in one output mode, its four filter fields
 * parked on the names a case names and on "none" otherwise.
 *
 * @param {{
 *   mode?: string,
 *   names?: Record<string, string>,
 *   keepKnobs?: boolean,
 *   notes?: boolean,
 *   copy?: Record<string, object>,
 *   engine?: Engine,
 *   ratios?: Record<string, string> | null,
 * }} [seams]
 * @returns {Promise<StagingWire>}
 */
export async function resetTab({
  mode = "pcm",
  names = {},
  keepKnobs = false,
  notes = false,
  copy = {},
  engine = {},
  ratios = null,
} = {}) {
  const w = stagingWire({ routes });
  common(keepKnobs, notes, copy);
  liveMode.value = false;
  signals.engineState.value = {};
  signals.enums.value = tabEnums(VOCAB, mode, ratios);
  signals.config.value = configPayload(FORM(mode, names, engine), mode, engine);
  await discardAll();
  return w;
}

/**
 * The LIVE lane: the engine's enumeration, the chain it reports loaded, AND the
 * daemon's config form.
 *
 * `mode` is the engine's own reported mode NAME, not our word for it — the
 * frontend derives the output mode from that name, `[SOURCE]` meaning auto and
 * an `SDM`/`DSD` name meaning sdm (store/live/derive.js). `output` is that same
 * mode in our vocabulary, carried in the form so the two agree.
 *
 * THE CONFIG FORM IS NOT OPTIONAL HERE, and seeding it empty is a mistake this
 * fixture made once and reported as a defect in the implementation. On the LIVE
 * page only the chain the engine reports LOADED reads its option list from the
 * enumerations; the DORMANT chain reads its options from /api/config
 * (store/live/chains.js:86-107). A dormant chain seeded from an empty form has
 * no options at all, so no filter name can resolve to an id against it and a
 * write to that chain silently posts nothing — which looks exactly like a lane
 * that refused to write. It is also a state the app never occupies: the dormant
 * chain's card is built out of that form, so a LIVE page whose /api/config has
 * not loaded has no dropdowns to show and does not render.
 *
 * @param {{
 *   mode?: string,
 *   output?: string,
 *   chain?: string,
 *   oneX?: string,
 *   nX?: string,
 *   keepKnobs?: boolean,
 *   engine?: Engine,
 *   ratios?: Record<string, string>,
 * }} [seams]
 * @returns {Promise<StagingWire>}
 */
export async function resetLive({
  mode = "PCM",
  output = "pcm",
  chain = "pcm",
  oneX,
  nX,
  keepKnobs = false,
  engine = {},
  ratios = {},
} = {}) {
  const w = stagingWire({ routes });
  // No copy and no descriptions preference: the LIVE lane's cases are about the
  // wire, and what a description RENDERS is read on the tabs lane
  // (tests/js/components/easytiles-desc.test.js).
  common(keepKnobs, false, {});
  signals.enums.value = enumerations(VOCAB, mode, ratios);
  signals.engineState.value = {
    mode: "1",
    filter1x: loaded(VOCAB, oneX),
    filterNx: loaded(VOCAB, nX),
    shaper: "0",
    rate: "0",
    filter_junk: "0",
    adaptive: "0",
    active_chain: chain,
  };
  signals.config.value = configPayload(FORM(output, {}, engine), output, engine);
  liveMode.value = true;
  await discardAll();
  return w;
}

export const tabs = () => render(html`<${EasyCard} />`);
export const liveCard = () => render(html`<${EasyCard} lane="live" />`);

// --- readers -------------------------------------------------------------------------

/**
 * @param {MarkupElement[]} els
 * @returns {MarkupElement}
 */
const outermost = (els) => els.reduce((a, b) => (a.start <= b.start ? a : b));

/** Every element marked as a tile, nested duplicates included. */
const marked = (/** @type {string} */ out) => elements(out).filter((el) => attr(el, "data-preset") !== undefined);

/** The preset ids the card laid out, one per tile however it is nested. */
const tileIds = (/** @type {string} */ out) => [...new Set(marked(out).map((el) => String(attr(el, "data-preset"))))];

/**
 * One tile: the outermost element carrying that preset's marking.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {MarkupElement}
 */
function tile(out, presetId) {
  const hits = marked(out).filter((el) => attr(el, "data-preset") === presetId);
  if (hits.length === 0) throw new Error(`no tile for the preset "${presetId}"`);
  return outermost(hits);
}

/**
 * How many tiles the card laid out.
 *
 * @param {string} out
 * @returns {number}
 */
export const tiles = (out) => tileIds(out).length;

/**
 * The preset each tile stands for, in the order the card laid them out.
 *
 * @param {string} out
 * @returns {string[]}
 */
export const presetIds = (out) => tileIds(out);

/**
 * Every tile the grid laid out, against the `data-active` it carries. The whole
 * map rather than the marked ids alone, so the "0" half of the contract is
 * pinned too: a card that marked every tile, marked none, or left one carrying
 * no `data-active` at all fails by naming the tile rather than by an empty list
 * that reads the same as "nothing matched".
 *
 * @param {string} out
 * @returns {Record<string, string | undefined>}
 */
export const activeMap = (out) =>
  Object.fromEntries(tileIds(out).map((id) => [id, attr(tile(out, id), "data-active")]));

/**
 * The positions one tile's knob marks selected, by the `data-v` each option
 * button carries. A list, so "exactly one is marked" is part of the reading.
 *
 * @param {string} out
 * @param {string} presetId
 * @param {string} knobId
 * @returns {(string | undefined)[]}
 */
export function knobPositions(out, presetId, knobId) {
  const wrappers = elements(tile(out, presetId).html).filter((el) => attr(el, "data-knob") === knobId);
  if (wrappers.length === 0) throw new Error(`the "${presetId}" tile carries no "${knobId}" knob`);
  return elements(outermost(wrappers).html)
    .filter((el) => el.name === "button" && classes(el).includes("seg") && classes(el).includes("active"))
    .map((el) => attr(el, "data-v"));
}

/**
 * One tile's own rendered markup — what a reading of that tile is scoped to.
 * The description readers in tests/js/support/easydesc.js are handed this
 * rather than the card.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {string}
 */
export const tileHtml = (out, presetId) => tile(out, presetId).html;

/**
 * How many buttons each tile of a grid offers a pointer, tile by tile: every
 * `button` it renders that is not one of a knob's options. One apiece is what
 * `pressTile` rests on — a tile offering two has no single thing "pressing the
 * tile" could mean, and a tile offering none cannot be set at all.
 *
 * Read off the rendered markup rather than off the handlers the vnodes carry,
 * so that what it counts is what a pointer meets.
 *
 * @param {string} out
 * @returns {Record<string, number>}
 */
export const pressables = (out) =>
  Object.fromEntries(
    tileIds(out).map((id) => [
      id,
      elements(tile(out, id).html).filter((el) => el.name === "button" && !classes(el).includes("seg")).length,
    ]),
  );

/**
 * What the tabs lane staged, read back as filter NAMES: the buffer holds enum
 * ids, and the name is what the preset table speaks.
 *
 * @param {StagingWire} w
 * @returns {Record<string, string | undefined>}
 */
export const stagedNames = (w) =>
  Object.fromEntries(Object.entries(w.staged.http).map(([field, id]) => [field, NAME_OF.get(String(id))]));

/**
 * What reached the LIVE lane's path, merged across however many requests
 * carried it. `easyLane.write` takes one field at a time, so a press may leave
 * as one request or as several; which request carried which field is not a
 * behavior the spec states.
 *
 * @param {StagingWire} w
 * @returns {Record<string, unknown>}
 */
export const postedFields = (w) =>
  Object.assign({}, ...w.posts.map((post) => /** @type {{ fields?: unknown }} */ (post).fields || {}));

// --- the click seam --------------------------------------------------------------------
//
// preact-render-to-string never fires a handler and there is no DOM here, so a
// cell is pressed by invoking the onClick its vnode carries, collected through
// preact's own `options.vnode` creation hook — the renderer's public seam,
// third-party surface. Nothing of HQPTuner's is stubbed.

const PRESET = "data-preset";

/**
 * The markup each collected render laid out, kept beside the vnodes it was
 * built from. A press is aimed by what the card RENDERED — the tile marking, a
 * wire identifier — and reaches into the vnode stream only for the handler,
 * which is the one thing rendered markup does not carry.
 *
 * @type {WeakMap<VNode[], string>}
 */
const RENDERED = new WeakMap();

/**
 * One render, with every vnode preact built along the way. `options.vnode` is
 * restored even if the render throws.
 *
 * @param {unknown} node
 * @returns {VNode[]}
 */
function seenOf(node) {
  /** @type {VNode[]} */
  const seen = [];
  const previous = options.vnode;
  options.vnode = (/** @type {VNode} */ v) => {
    seen.push(v);
    if (previous) previous(v);
  };
  try {
    RENDERED.set(seen, render(/** @type {never} */ (node)));
    return seen;
  } finally {
    options.vnode = previous;
  }
}

/** One render of the card on a lane, with every vnode built along the way. */
export const seenTabs = () => seenOf(html`<${EasyCard} />`);
export const seenLive = () => seenOf(html`<${EasyCard} lane="live" />`);

/** @param {VNode} v */
const fire = (v) =>
  /** @type {(event: object) => void} */ (v.props.onClick)({ preventDefault() {}, stopPropagation() {} });

/**
 * Every vnode of a subtree, the node itself included.
 *
 * @param {unknown} node
 * @returns {VNode[]}
 */
function within(node) {
  if (node === false || node === null || node === undefined || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(within);
  const vnode = /** @type {VNode} */ (node);
  return [vnode, ...(vnode.props ? within(vnode.props.children) : [])];
}

/** Whether a vnode is one of a Segment's option buttons. */
const isSeg = (/** @type {VNode} */ v) =>
  String(v.props.class || v.props.className || "")
    .split(/\s+/)
    .includes("seg");

/**
 * A vnode subtree's own working buttons: clickable, and not one of a knob's
 * option buttons.
 *
 * @param {VNode[]} boxes
 * @returns {VNode[]}
 */
const pickable = (boxes) =>
  [...new Set(boxes.flatMap((box) => within(box.props.children)))].filter(
    (v) => v.type === "button" && typeof v.props.onClick === "function" && !isSeg(v),
  );

/**
 * One press on a preset tile. The tile BOX carries the identity and the press
 * is a button inside it: a knob's options are buttons too, and a button inside
 * a button is not markup a browser keeps, so the two cannot be the same node.
 * The knob buttons are its siblings and are excluded — pressing one is
 * `pressKnob`'s job.
 *
 * @param {VNode[]} seen
 * @param {string} presetId
 * @returns {void}
 */
export function pressTile(seen, presetId) {
  const boxes = seen.filter((v) => v && v.props && v.props[PRESET] === presetId);
  if (boxes.length === 0) throw new Error(`nothing carries ${PRESET}="${presetId}"`);
  const hits = pickable(boxes);
  if (hits.length !== 1) throw new Error(`expected one working button in the "${presetId}" tile, found ${hits.length}`);
  fire(hits[0]);
}

/**
 * Every knob option the card LAID OUT, in document order: the `seg` buttons of
 * the rendered markup, wherever on the card they stand.
 *
 * @param {string} out
 * @returns {MarkupElement[]}
 */
const laidOutOptions = (out) =>
  elements(out)
    .filter((el) => el.name === "button" && classes(el).includes("seg"))
    .sort((a, b) => a.start - b.start);

/** Every knob option the card BUILT, in the order preact built them. */
const builtOptions = (/** @type {VNode[]} */ seen) =>
  seen.filter((v) => v && v.props && v.type === "button" && isSeg(v));

/**
 * One press on a knob's option inside one tile, by the `data-v` that option
 * carries.
 *
 * The tile is named by the `data-preset` marking of the RENDERED markup, so the
 * scope of the press is the region of the card that tile actually encloses —
 * not a stretch of preact's creation stream, which relates an option to a tile
 * only by the order the two were built in and leaves the last tile of the
 * roster unbounded. `data-v` is shared across tiles (several presets carry an
 * `emphasis` knob and its two option ids), so an ambiguous match within the
 * tile still throws, and so does an option no tile encloses.
 *
 * The vnode stream is consulted for one thing only: the handler, which rendered
 * markup does not carry. Nth-built is nth-laid-out for these buttons — each is
 * built by the render of the Segment that lays it out — and the counts are
 * compared before the mapping is used, so a card that built options it never
 * laid out fails loudly rather than pressing its neighbour.
 *
 * @param {VNode[]} seen
 * @param {string} presetId
 * @param {string} optionId
 * @returns {void}
 */
export function pressKnob(seen, presetId, optionId) {
  const out = RENDERED.get(seen);
  if (out === undefined) throw new Error("pressKnob wants a render collected by seenTabs or seenLive");
  const laid = laidOutOptions(out);
  const box = tile(out, presetId);
  const mine = laid.filter(
    (el) => el.start >= box.start && el.start < box.start + box.html.length && attr(el, "data-v") === optionId,
  );
  if (mine.length !== 1) {
    throw new Error(`expected one data-v="${optionId}" option in the "${presetId}" tile, found ${mine.length}`);
  }
  const built = builtOptions(seen);
  if (built.length !== laid.length) {
    throw new Error(`the card built ${built.length} knob options and laid out ${laid.length}`);
  }
  const target = built[laid.indexOf(mine[0])];
  if (typeof target.props.onClick !== "function") {
    throw new Error(`the data-v="${optionId}" option in the "${presetId}" tile is not clickable`);
  }
  fire(target);
}

/**
 * Every tile the grid laid out, against the `data-selected` it carries — the
 * peer of `activeMap` for the other of the two markings. Read the same way and
 * for the same reason: the whole map, so that the "0" half of the contract is
 * pinned and a card marking every tile, marking none, or leaving one carrying
 * no `data-selected` at all fails by naming the tile.
 *
 * @param {string} out
 * @returns {Record<string, string | undefined>}
 */
export const selectedMap = (out) =>
  Object.fromEntries(tileIds(out).map((id) => [id, attr(tile(out, id), "data-selected")]));
