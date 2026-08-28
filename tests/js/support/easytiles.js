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
import { writeSet, presetsFor } from "../../../hqptuner/static/store/easy.js";
import { easyMode, easyGrid } from "../../../hqptuner/static/store/easyview.js";
import * as signals from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { liveMode, showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { liveErrors, liveBusy } from "../../../hqptuner/static/store/live/state.js";
import * as narrow from "../../../hqptuner/static/store/narrow/state.js";
import { stagingWire, quiesce, ok } from "./wire.js";
import { elements, classes, attr, enclosing } from "./markup.js";
import { formFields } from "./tabform.js";

/** @typedef {import("./wheel.js").VNode} VNode */
/** @typedef {import("./markup.js").MarkupElement} MarkupElement */
/** @typedef {import("./wire.js").StagingWire} StagingWire */
/** @typedef {{ id: string, default: string, options: string[] }} Knob */
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

/** @type {("album" | "playlist")[]} */
const GRIDS = ["album", "playlist"];

/**
 * Every combination of knob positions a preset defines, defaults included.
 *
 * @param {Knob[]} knobs
 * @returns {Record<string, string>[]}
 */
const combos = (knobs) =>
  knobs.reduce(
    (/** @type {Record<string, string>[]} */ acc, knob) =>
      acc.flatMap((one) => knob.options.map((option) => ({ ...one, [knob.id]: option }))),
    [{}],
  );

/**
 * Every write set one grid's table can produce, every knob position included.
 *
 * @param {string} grid
 * @returns {Record<string, string>[]}
 */
const writesFor = (grid) =>
  presetsFor(grid).flatMap((/** @type {Preset} */ preset) =>
    combos(preset.knobs).map((knobs) => writeSet(grid, preset.id, "auto", knobs)),
  );

/** Every write set the table can produce: both grids, every knob position. */
const everyWrite = () => GRIDS.flatMap(writesFor);

/**
 * Every distinct filter name one grid's presets can write, across all four
 * schema keys and every knob combination — the whole vocabulary that grid can
 * put in front of the daemon.
 *
 * @param {string} grid
 * @returns {string[]}
 */
export const namesWritten = (grid) => [
  ...new Set(
    writesFor(grid)
      .flatMap((set) => Object.values(set))
      .filter(Boolean),
  ),
];

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
// Named outright, not searched for at import. A preset id, a knob id and a knob
// option id are wire identifiers, the same class of thing as a schema key or a
// filter name, so a case states which one it exercises and fails by name when
// the table moves under it. Only the FILTER NAMES are derived (above), because
// those are the curated half a second copy would drift from.
//
// `PICK` is the knob position the generic press cases move to: a position that
// differs from its knob's default, so that pressing it is a move rather than a
// re-statement of what the tile already shows. `concert-hall`'s `version` knob
// is one such. The per-preset cases name their own knob and option inline.
//
// A knob option id is NOT unique across the album grid — `emphasis` carries the
// same two option ids on five tiles and `source` carries the same two on two —
// so `pressKnob` takes the preset whose tile it is pressing and refuses on an
// ambiguous match within it, rather than pressing whichever tile came first in
// the vnode stream.

export const ALBUM_TILE = "perfect-ten";
export const PLAYLIST_TILE = "lifelike";
export const PICK = { preset: "concert-hall", knob: "version", option: "lifelike", fallback: "perfect-ten" };

// The roster the active-marking map is read over. `presetsFor` is the public
// enumeration of which tiles a grid has, and the composition cases pin how many
// that is.
const ALBUM_IDS = presetsFor("album").map((/** @type {Preset} */ preset) => String(preset.id));

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
 */
const FORM = (mode, names) => ({
  backend: "alsa",
  mode: { value: mode, options: MODES },
  filter1x: pick(PCM_NAMES, names[PCM_1X]),
  filter: pick(PCM_NAMES, names[PCM_NX]),
  oversampling1x: pick(SDM_NAMES, names[SDM_1X]),
  oversampling: pick(SDM_NAMES, names[SDM_NX]),
});

// --- the engine's own enumeration and state ----------------------------------------

const FILTERS = [
  { index: "0", value: NONE.value, name: NONE.label },
  ...ALL_NAMES.map((name, i) => ({ index: String(i + 1), value: idOf(name), name })),
];

/** State reports the LIST INDEX, never the id (docs/protocol.md §4). */
const indexOf = (/** @type {string} */ name) => String(ALL_NAMES.indexOf(name) + 1);

/** @param {string} modeName */
const ENUMS = (modeName) => ({
  filters: FILTERS,
  shapers: [{ index: "0", value: "0", name: "none" }],
  rates: [
    { index: "0", rate: "0" },
    { index: "1", rate: "96000" },
  ],
  junk_filters: [{ index: "0", value: "0", name: "none" }],
  mode: { name: modeName },
});

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
 * The filter names a preset's write set parks the four fields on, by schema key
 * — what the daemon's form carries while that preset is the one in force.
 *
 * @param {string} presetId
 * @param {Record<string, string>} [knobs]
 * @returns {Record<string, string>}
 */
export const inForce = (presetId, knobs = {}) => writeSet("album", presetId, "auto", knobs);

/**
 * One filter name on both ends of the PCM chain, keyed by SCHEMA key — what an
 * album preset's write set looks like, stated by name rather than derived, for
 * seeding `resetTab` from the owner's table instead of from the module's.
 *
 * @param {string} name
 * @returns {Record<string, string>}
 */
export const seedPcm = (name) => ({ [PCM_1X]: name, [PCM_NX]: name });

/**
 * The same pair keyed by the daemon's own FORM-FIELD names — what `stagedNames`
 * reads back after a press that wrote that filter to both ends of the PCM
 * chain.
 *
 * @param {string} name
 * @returns {Record<string, string>}
 */
export const stagedPcm = (name) => ({ [FIELD[PCM_1X]]: name, [FIELD[PCM_NX]]: name });

/**
 * The two PCM filter names an album preset leaves the engine running, for
 * seeding the LIVE lane's State.
 *
 * @param {string} presetId
 * @returns {{ oneX: string, nX: string }}
 */
export function running(presetId) {
  const set = writeSet("album", presetId, "pcm");
  return { oneX: set[PCM_1X], nX: set[PCM_NX] };
}

/**
 * The write set a preset stands for, keyed by the daemon's form-field names.
 * `writeSet` is the authority; this only renames its keys.
 *
 * @param {"album" | "playlist"} grid
 * @param {string} presetId
 * @param {"pcm" | "sdm" | "auto"} mode
 * @param {Record<string, string>} [knobs]
 * @returns {Record<string, string>}
 */
export const expectedNames = (grid, presetId, mode, knobs = {}) =>
  Object.fromEntries(Object.entries(writeSet(grid, presetId, mode, knobs)).map(([key, name]) => [FIELD[key], name]));

/**
 * What the LIVE lane must post for an album preset in PCM mode: the two PCM
 * live fields, each valued by the engine's enum id for the preset's filter.
 *
 * @param {string} presetId
 * @returns {Record<string, string>}
 */
export function liveExpected(presetId) {
  const set = writeSet("album", presetId, "pcm");
  return { [FIELD[PCM_1X]]: idOf(set[PCM_1X]), [FIELD[PCM_NX]]: idOf(set[PCM_NX]) };
}

/**
 * The album grid with one tile lit, or none when handed null.
 *
 * @param {string | null} presetId
 * @returns {Record<string, string>}
 */
export const oneLit = (presetId) => Object.fromEntries(ALBUM_IDS.map((id) => [id, id === presetId ? "1" : "0"]));

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

/** @param {string} grid */
function common(grid) {
  signals.metadata.value = { ...META };
  signals.matrixConfig.value = { fields: [] };
  signals.health.value = { reachable: true, info: {} };
  showDescriptions.value = false;
  keepOptionDescriptions.value = true;
  liveErrors.value = {};
  liveBusy.value = "";
  narrow.resetNarrowing();
  easyMode.value = true;
  easyGrid.value = grid;
}

/**
 * The tabs lane: the daemon's form in one output mode, its four filter fields
 * parked on the names a case names and on "none" otherwise.
 *
 * @param {{ grid?: string, mode?: string, names?: Record<string, string> }} [seams]
 * @returns {Promise<StagingWire>}
 */
export async function resetTab({ grid = "album", mode = "pcm", names = {} } = {}) {
  const w = stagingWire({ routes });
  common(grid);
  liveMode.value = false;
  signals.engineState.value = {};
  signals.enums.value = null;
  signals.config.value = { fields: formFields(FORM(mode, names)), file: { mode }, active: "", profiles: null };
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
 * @param {{ grid?: string, mode?: string, output?: string, chain?: string, oneX?: string, nX?: string }} [seams]
 * @returns {Promise<StagingWire>}
 */
export async function resetLive({ grid = "album", mode = "PCM", output = "pcm", chain = "pcm", oneX, nX } = {}) {
  const w = stagingWire({ routes });
  common(grid);
  signals.enums.value = ENUMS(mode);
  signals.engineState.value = {
    mode: "1",
    filter1x: oneX === undefined ? "0" : indexOf(oneX),
    filterNx: nX === undefined ? "0" : indexOf(nX),
    shaper: "0",
    rate: "0",
    filter_junk: "0",
    adaptive: "0",
    active_chain: chain,
  };
  signals.config.value = { fields: formFields(FORM(output, {})), file: { mode: output }, active: "", profiles: null };
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
 * The cells of a grid: the direct children of the `[data-grid]` container, in
 * the order it laid them out. Direct children because a grid container lays out
 * what its own children are — an element between the container and a tile would
 * not be a cell of it.
 *
 * @param {string} out
 * @returns {MarkupElement[]}
 */
function gridCells(out) {
  const grid = elements(out).find((el) => attr(el, "data-grid") !== undefined);
  if (grid === undefined) throw new Error("the card laid out no [data-grid] container");
  // Read within the container's own outer HTML, where the container itself is
  // the element at offset 0 and a direct child is one whose smallest encloser
  // is that element.
  return elements(grid.html).filter((el) => el.start !== 0 && enclosing(grid.html, el).start === 0);
}

/**
 * How many cells a grid laid out, whatever each one turns out to be.
 *
 * @param {string} out
 * @returns {number}
 */
export const cells = (out) => gridCells(out).length;

/**
 * The preset each cell of a grid stands for, in order. A cell carrying no
 * `data-preset` reads as `undefined` rather than being skipped, so "every cell
 * is a preset tile" is part of this reading and not a separate one.
 *
 * @param {string} out
 * @returns {(string | undefined)[]}
 */
export const presetIds = (out) => gridCells(out).map((el) => attr(el, "data-preset"));

/**
 * The knob ids one tile renders, deduplicated, in the order it renders them.
 * Order preserved rather than sorted: which knob comes first is contract, the
 * same way the preset roster's order is — one knob picks which pair of filters
 * is in play and the next picks between them, so a tile showing them the other
 * way round reads backwards.
 *
 * @param {string} out
 * @param {string} presetId
 * @returns {string[]}
 */
export const knobIds = (out, presetId) =>
  [...new Set(elements(tile(out, presetId).html).map((el) => attr(el, "data-knob")))]
    .filter((id) => id !== undefined)
    .map(String);

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
    render(/** @type {never} */ (node));
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
 * The stretch of the creation stream that belongs to one tile: its box, and
 * every vnode built after it until the next tile's box.
 *
 * A knob's option buttons are NOT reachable from the box's `props.children` —
 * they are built inside the shared Segment's own render, so they enter the
 * stream after the box rather than under it. What relates them to the tile is
 * the order preact builds them in, one tile at a time, which is why the window
 * is cut by the boxes on either side. A tile carrying none of its own knob
 * options leaves an empty window and the callers below throw.
 *
 * @param {VNode[]} seen
 * @param {string} presetId
 * @returns {VNode[]}
 */
function tileWindow(seen, presetId) {
  const built = seen.filter((v) => v && v.props);
  const start = built.findIndex((v) => v.props[PRESET] === presetId);
  if (start === -1) throw new Error(`nothing carries ${PRESET}="${presetId}"`);
  const rest = built.slice(start + 1);
  const end = rest.findIndex((v) => v.props[PRESET] !== undefined && v.props[PRESET] !== presetId);
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * One press on a knob's option inside one tile, by the `data-v` that option
 * carries. Scoped to the tile because `data-v` is shared across tiles — several
 * presets carry an `emphasis` knob and its two option ids — so an unscoped
 * search would press whichever tile's knob came first in the vnode stream. An
 * ambiguous match WITHIN the tile still throws.
 *
 * @param {VNode[]} seen
 * @param {string} presetId
 * @param {string} optionId
 * @returns {void}
 */
export function pressKnob(seen, presetId, optionId) {
  const hits = tileWindow(seen, presetId).filter(
    (v) => v.props["data-v"] === optionId && typeof v.props.onClick === "function",
  );
  if (hits.length !== 1) {
    throw new Error(`expected one clickable data-v="${optionId}" in the "${presetId}" tile, found ${hits.length}`);
  }
  fire(hits[0]);
}

/**
 * The presets whose tile BOX carries a click handler of its own — which is what
 * `pressTile` assumes there are none of, and what a browser cannot render once
 * the box holds buttons.
 *
 * @param {VNode[]} seen
 * @returns {string[]}
 */
export const clickableBoxes = (seen) =>
  seen
    .filter((v) => v && v.props && v.props[PRESET] !== undefined && typeof v.props.onClick === "function")
    .map((v) => String(v.props[PRESET]));
