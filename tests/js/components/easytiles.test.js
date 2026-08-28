// Behavioral suite for Easy Mode's preset tiles (Phase 3): what the two grids
// lay out (components/easy/EasyCard.js), which tile reads as the one the engine
// is currently set to, and what a press on a tile or on a tile's knob writes on
// each of the two lanes (store/easylane.js).
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Every case drives the exported store signals with the shapes
// /api/config, /api/state and /api/enumerations actually serve, and every write
// leaves over a faked `globalThis.fetch` on the real REST paths — the tabs lane
// through POST /api/config/stage, the LIVE lane through POST /api/config/live.
// No store function of HQPTuner's is stubbed.
//
// NAMES, NOT WORDS (rule 9). A tile is found by its `data-preset`, the
// placeholder by `data-testid="easy-add"`, a knob by its `data-knob` and a knob
// position by the `data-v` its option button carries. Every title, description,
// note and label in the preset table is owner copy, asserted nowhere, and
// nothing here is selected on a sentence.
//
// WHERE THE FIXTURE'S FILTER NAMES COME FROM. Not typed out here: the curated
// table is `writeSet`'s and `presetsFor`'s, both of which already ship, so this
// file asks THEM which presets exist, which knob positions each defines and
// which filter each combination names, then builds a daemon form and an engine
// enumeration offering exactly those filters. A name stated by hand here would
// be a second copy of the table, drifting the first time the owner curates it.
//
// The two chains are enumerated DIFFERENTLY, as the daemon enumerates them: the
// `-2s` two-stage variants exist on the SDM chain only, and the PCM chain never
// lists one. A lane that wrote a `-2s` name to a PCM field therefore has nothing
// to resolve it against, which is the failure behavior 9 watches for.
//
// IDS VERSUS NAMES. Both lanes VALUE a filter field by its enum id and LABEL it
// by the engine's filter name (docs/architecture.md §2), so the fixture gives
// every filter an id that differs from its position in every list it appears in:
// a lane that wrote the name, the index or the label instead of the id fails
// loudly rather than coinciding with the right answer.
//
// HOOKS THIS SUITE REQUIRES the implementation to provide, all from the spec's
// rendered contract:
//   * `data-preset="<presetId>"` and `data-active="0"|"1"` on each tile BOX,
//     which carries no handler of its own
//   * one working `button` inside that box, which is what sets the preset
//   * `data-testid="easy-add"` on the placeholder cell, carrying no
//     `data-preset`, holding that same inner button disabled
//   * `data-knob="<knobId>"` on the element wrapping a tile's knob, a sibling of
//     that button, whose option buttons are the shared Segment's `.seg[data-v]`,
//     the selected one `.active`
// The `data-knob` element is read as a wrapper only; nothing here asserts what
// classes it carries.
//
// CLICKS. preact-render-to-string never fires a handler and there is no DOM
// here, so a cell is pressed the way tests/js/components/easymode.test.js
// presses the card's links: by invoking the onClick its vnode carries, collected
// through preact's own `options.vnode` creation hook — the renderer's public
// seam, third-party surface.
//
// The tile is two nodes, not one, and it has to be: the knob options are
// buttons, and a button inside a button is not markup a browser keeps. So the
// box carries the identity and a button inside it carries the press. `pressTile`
// finds the box by `data-preset` and then fires the one working button within it
// — enabled, and not one of the knob's `.seg` options, which are its siblings.
// It refuses to fire on anything but exactly one such button rather than
// guessing which node a pointer would have hit.
//
// A knob position is pressed by its `data-v`, which is not scoped to a tile in
// the vnode stream, so the one position this file presses is chosen at load as
// one occurring EXACTLY ONCE across the whole album grid; the press helper
// refuses to fire on an ambiguous match rather than pressing some other tile's
// knob. The reading side has no such limit — there the tile's own markup is
// scanned — so behavior 11 is read on whichever tile a case names.
//
// BATCHING IS NOT PINNED. `easyLane.write` takes one field at a time, so a tile
// press may leave as one request or as several; what a case asserts is the set
// of fields that arrived, merged across whatever requests carried them. Which
// request carried which field is not a behavior the spec states.
//
// NOT REACHABLE FROM SSR, and left untested rather than reached for: anything a
// tile syncs through `useEffect` or holds in a module-private signal written
// only from an event handler. No private signal is exported to reach one.
//
// A working fake localStorage stands for the whole file, installed EMPTY before
// any import: the Easy Mode view flags persist through it and this process has
// none at all. What happens when storage is missing is
// tests/js/store/easyview.test.js's.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/easytiles.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { options } from "preact";
import { render } from "preact-render-to-string";

import { useStorage } from "../support/storage.js";

useStorage();

const { html } = await import("../../../hqptuner/static/lib/dom.js");
const { EasyCard } = await import("../../../hqptuner/static/components/easy/EasyCard.js");
const { writeSet, presetsFor } = await import("../../../hqptuner/static/store/easy.js");
const { easyMode, easyGrid } = await import("../../../hqptuner/static/store/easyview.js");
const signals = await import("../../../hqptuner/static/store/signals.js");
const { discardAll } = await import("../../../hqptuner/static/store/actions.js");
const { liveMode, showDescriptions, keepOptionDescriptions } = await import("../../../hqptuner/static/store/prefs.js");
const { liveErrors, liveBusy } = await import("../../../hqptuner/static/store/live/state.js");
const narrow = await import("../../../hqptuner/static/store/narrow/state.js");
const { stagingWire, quiesce, ok } = await import("../support/wire.js");
const { elements, classes, attr } = await import("../support/markup.js");
const { formFields } = await import("../support/tabform.js");

/** @typedef {import("../support/wheel.js").VNode} VNode */
/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../support/wire.js").StagingWire} StagingWire */
/** @typedef {{ id: string, default: string, options: string[] }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[] }} Preset */
/** @typedef {{ preset: string, knob: string, option: string, fallback: string }} Position */

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

const PCM_FIELDS = [FIELD[PCM_1X], FIELD[PCM_NX]].sort();
const SDM_FIELDS = [FIELD[SDM_1X], FIELD[SDM_NX]].sort();
const ALL_FIELDS = [...PCM_FIELDS, ...SDM_FIELDS].sort();

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

/** Every write set the table can produce: both grids, every knob position. */
const everyWrite = () =>
  GRIDS.flatMap((grid) =>
    presetsFor(grid).flatMap((/** @type {Preset} */ preset) =>
      combos(preset.knobs).map((knobs) => writeSet(grid, preset.id, "auto", knobs)),
    ),
  );

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

// The card's own prose comes off /api/metadata. This file's stand-in, never
// compared against what ships — the tiles are what is under test here.
const META = {
  settings: {},
  filters: { filters: {}, aliases: {} },
  shapers: { pcm_dithers: {}, sdm_modulators: {} },
  easy: { notice: "A stand-in notice, seeded by the suite." },
};

// --- what the shipped table names ----------------------------------------------------
//
// The grids' first presets, and one knob position occurring exactly once across
// the whole album grid (see the header: `data-v` is not tile-scoped in the vnode
// stream). A NON-default position is preferred, so pressing it is a move rather
// than a re-statement of what the tile already shows.

const ALBUM = presetsFor("album");
const FIRST_ALBUM = String(ALBUM[0].id);
const FIRST_PLAYLIST = String(presetsFor("playlist")[0].id);

/** @type {Position[]} */
const POSITIONS = ALBUM.flatMap((/** @type {Preset} */ preset) =>
  preset.knobs.flatMap((knob) =>
    knob.options.map((option) => ({ preset: preset.id, knob: knob.id, option, fallback: knob.default })),
  ),
);
const OCCURS = POSITIONS.reduce((/** @type {Record<string, number>} */ acc, /** @type {Position} */ p) => {
  acc[p.option] = (acc[p.option] || 0) + 1;
  return acc;
}, {});
const UNIQUE = POSITIONS.find((/** @type {Position} */ p) => OCCURS[p.option] === 1 && p.option !== p.fallback);
if (!UNIQUE) throw new Error("no album knob position is unique enough to press through the vnode seam");

/**
 * The filter names a preset's write set parks the four fields on, by schema key
 * — what the daemon's form carries while that preset is the one in force.
 *
 * @param {string} presetId
 * @param {Record<string, string>} [knobs]
 * @returns {Record<string, string>}
 */
const inForce = (presetId, knobs = {}) => writeSet("album", presetId, "auto", knobs);

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
const expectedNames = (grid, presetId, mode, knobs = {}) =>
  Object.fromEntries(Object.entries(writeSet(grid, presetId, mode, knobs)).map(([key, name]) => [FIELD[key], name]));

/**
 * What the LIVE lane must post for an album preset in PCM mode: the two PCM
 * live fields, each valued by the engine's enum id for the preset's filter.
 *
 * @param {string} presetId
 * @returns {Record<string, string>}
 */
function liveExpected(presetId) {
  const set = writeSet("album", presetId, "pcm");
  return { [FIELD[PCM_1X]]: idOf(set[PCM_1X]), [FIELD[PCM_NX]]: idOf(set[PCM_NX]) };
}

// --- the wire ----------------------------------------------------------------------
//
// One staging server for both lanes, so a case can ask what reached the tabs
// lane's path AND what reached the LIVE lane's in the same run: stage requests
// land in the buffer `stagingWire` holds, live writes land in `w.posts`. The
// read endpoints answer what the signals already hold, so a write that
// re-mirrors afterwards puts back what it found.

/**
 * @param {string} path
 * @param {import("../support/wire.js").FakeRequest} opts
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
async function flush(w) {
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
async function resetTab({ grid = "album", mode = "pcm", names = {} } = {}) {
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
 * The LIVE lane: the engine's enumeration, and the chain it reports loaded.
 *
 * @param {{ grid?: string, mode?: string, oneX?: string, nX?: string }} [seams]
 * @returns {Promise<StagingWire>}
 */
async function resetLive({ grid = "album", mode = "PCM", oneX = NONE.label, nX = NONE.label } = {}) {
  const w = stagingWire({ routes });
  common(grid);
  signals.enums.value = ENUMS(mode);
  signals.engineState.value = {
    mode: "1",
    filter1x: oneX === NONE.label ? "0" : indexOf(oneX),
    filterNx: nX === NONE.label ? "0" : indexOf(nX),
    shaper: "0",
    rate: "0",
    filter_junk: "0",
    adaptive: "0",
    active_chain: "pcm",
  };
  signals.config.value = { fields: [], file: {}, active: "", profiles: null };
  liveMode.value = true;
  await discardAll();
  return w;
}

const tabs = () => render(html`<${EasyCard} />`);

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

const placeholders = (/** @type {string} */ out) =>
  elements(out).filter((el) => attr(el, "data-testid") === "easy-add");

/**
 * The composition of a grid: how many tiles it laid out, and how many
 * placeholders stand beside them.
 *
 * @param {string} out
 */
const cells = (out) => ({ tiles: tileIds(out).length, placeholder: placeholders(out).length });

/** The preset ids the card marks as the one the engine is set to. */
const activeIds = (/** @type {string} */ out) =>
  tileIds(out).filter((id) => attr(tile(out, id), "data-active") === "1");

/**
 * The positions one tile's knob marks selected, by the `data-v` each option
 * button carries. A list, so "exactly one is marked" is part of the reading.
 *
 * @param {string} out
 * @param {string} presetId
 * @param {string} knobId
 * @returns {(string | undefined)[]}
 */
function knobPositions(out, presetId, knobId) {
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
const stagedNames = (w) =>
  Object.fromEntries(Object.entries(w.staged.http).map(([field, id]) => [field, NAME_OF.get(String(id))]));

/**
 * What reached the LIVE lane's path, merged across however many requests
 * carried it.
 *
 * @param {StagingWire} w
 * @returns {Record<string, unknown>}
 */
const postedFields = (w) =>
  Object.assign({}, ...w.posts.map((post) => /** @type {{ fields?: unknown }} */ (post).fields || {}));

// --- the click seam --------------------------------------------------------------------

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

/**
 * One press on the affordance an attribute names, as a pointer would land on
 * it. For a control carrying its own handler — a knob's option button, the
 * grid switcher's — the marked node IS the clickable one. Anything but a single
 * clickable match throws rather than pressing something else.
 *
 * @param {VNode[]} seen
 * @param {string} name
 * @param {string} value
 * @returns {void}
 */
function press(seen, name, value) {
  const hits = seen.filter((v) => v && v.props && v.props[name] === value && typeof v.props.onClick === "function");
  if (hits.length !== 1) throw new Error(`expected one clickable ${name}="${value}", found ${hits.length}`);
  fire(hits[0]);
}

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
 * A vnode subtree's own working buttons: clickable, enabled, and not one of a
 * knob's option buttons. A disabled button is skipped because a browser never
 * fires one, so firing it here would simulate something no pointer can do.
 *
 * @param {VNode[]} boxes
 * @returns {VNode[]}
 */
const pickable = (boxes) =>
  [...new Set(boxes.flatMap((box) => within(box.props.children)))].filter(
    (v) => v.type === "button" && typeof v.props.onClick === "function" && !isSeg(v) && v.props.disabled !== true,
  );

/**
 * Every element marked with an attribute, as vnodes.
 *
 * @param {VNode[]} seen
 * @param {string} name
 * @param {string} value
 * @returns {VNode[]}
 */
function cellsMarked(seen, name, value) {
  const hits = seen.filter((v) => v && v.props && v.props[name] === value);
  if (hits.length === 0) throw new Error(`nothing carries ${name}="${value}"`);
  return hits;
}

/**
 * One press on a preset tile. The tile BOX carries the identity and the press
 * is a button inside it: a knob's options are buttons too, and a button inside
 * a button is not markup a browser keeps, so the two cannot be the same node.
 * The knob buttons are its siblings and are excluded — pressing one is behavior
 * 10, and `press` above does that by `data-v`.
 *
 * @param {VNode[]} seen
 * @param {string} presetId
 * @returns {void}
 */
function pressTile(seen, presetId) {
  const hits = pickable(cellsMarked(seen, PRESET, presetId));
  if (hits.length !== 1) throw new Error(`expected one working button in the "${presetId}" tile, found ${hits.length}`);
  fire(hits[0]);
}

/**
 * A press on a cell whose button may be disabled — the placeholder, whose
 * behavior is to write nothing. The cell must EXIST; whether anything inside it
 * can be pressed at all is what the case is asking about, so an enabled button
 * found there IS fired and whatever it writes lands in the assertion.
 *
 * @param {VNode[]} seen
 * @param {string} name
 * @param {string} value
 * @returns {void}
 */
function pressWhatever(seen, name, value) {
  for (const hit of pickable(cellsMarked(seen, name, value))) fire(hit);
}

const PRESET = "data-preset";
const TESTID = "data-testid";
const VALUE = "data-v";
const ADD = "easy-add";
const EMPTY = { live: {}, http: {} };

// ============================================================================
// what each grid lays out
// ============================================================================
//
// Composition in one reading, so a grid that dropped a tile and a grid that
// dropped the placeholder fail differently and name which.

test("test_the_album_grid_lays_out_seven_preset_tiles_beside_one_placeholder", async () => {
  await resetTab({ grid: "album" });
  assert.deepEqual(cells(tabs()), { tiles: 7, placeholder: 1 });
});

test("test_the_playlist_grid_lays_out_two_preset_tiles_beside_one_placeholder", async () => {
  await resetTab({ grid: "playlist" });
  assert.deepEqual(cells(tabs()), { tiles: 2, placeholder: 1 });
});

test("test_the_placeholder_cell_stands_for_no_preset", async () => {
  await resetTab();
  assert.equal(attr(placeholders(tabs())[0], PRESET), undefined);
});

// ============================================================================
// which tile reads as the one in force
// ============================================================================

test("test_the_tile_whose_write_set_the_fields_carry_is_the_one_marked_active", async () => {
  await resetTab({ mode: "auto", names: inForce(FIRST_ALBUM) });
  assert.deepEqual(activeIds(tabs()), [FIRST_ALBUM]);
});

test("test_no_tile_is_marked_active_while_the_fields_carry_no_presets_write_set", async () => {
  await resetTab({ mode: "auto" });
  assert.deepEqual(activeIds(tabs()), []);
});

// ============================================================================
// which fields a press writes, by output mode
// ============================================================================
//
// Field NAMES only here — which filter lands in them is the next section's. A
// mode that reached across to the other chain fails by naming the field it
// should not have touched.

/** @type {[string, string[]][]} */
const MODE_FIELDS = [
  ["pcm", PCM_FIELDS],
  ["sdm", SDM_FIELDS],
  ["auto", ALL_FIELDS],
];

for (const [mode, fields] of MODE_FIELDS) {
  test(`test_a_tile_press_in_the_${mode}_output_mode_writes_only_that_modes_filter_fields`, async () => {
    const w = await resetTab({ mode });
    pressTile(seenOf(html`<${EasyCard} />`), FIRST_ALBUM);
    await flush(w);
    assert.deepEqual(Object.keys(w.staged.http).sort(), fields);
  });
}

// ============================================================================
// which filter a press writes
// ============================================================================

test("test_an_album_tile_writes_one_filter_to_both_ends_of_the_chain", async () => {
  const w = await resetTab({ grid: "album", mode: "pcm" });
  pressTile(seenOf(html`<${EasyCard} />`), FIRST_ALBUM);
  await flush(w);
  assert.deepEqual(stagedNames(w), expectedNames("album", FIRST_ALBUM, "pcm"));
});

test("test_a_playlist_tile_writes_a_different_filter_to_each_end_of_the_chain", async () => {
  const w = await resetTab({ grid: "playlist", mode: "pcm" });
  pressTile(seenOf(html`<${EasyCard} lane="config" />`), FIRST_PLAYLIST);
  await flush(w);
  assert.deepEqual(stagedNames(w), expectedNames("playlist", FIRST_PLAYLIST, "pcm"));
});

// The two presets whose album entry differs by chain: out of one press, the
// plain name goes to the PCM chain and the `-2s` two-stage variant to the SDM
// chain, which is the only chain the daemon enumerates one on.

for (const presetId of ["old-school", "damage-control"]) {
  test(`test_pressing_${presetId}_writes_the_plain_name_on_pcm_and_the_two_stage_name_on_sdm`, async () => {
    const w = await resetTab({ grid: "album", mode: "auto" });
    pressTile(seenOf(html`<${EasyCard} />`), presetId);
    await flush(w);
    assert.deepEqual(stagedNames(w), expectedNames("album", presetId, "auto"));
  });
}

// ============================================================================
// the knobs
// ============================================================================

test("test_moving_a_tiles_knob_writes_that_preset_at_the_new_position", async () => {
  const w = await resetTab({ grid: "album", mode: "pcm" });
  press(seenOf(html`<${EasyCard} />`), VALUE, UNIQUE.option);
  await flush(w);
  assert.deepEqual(stagedNames(w), expectedNames("album", UNIQUE.preset, "pcm", { [UNIQUE.knob]: UNIQUE.option }));
});

test("test_an_active_tiles_knob_shows_the_position_the_fields_match", async () => {
  await resetTab({ grid: "album", mode: "auto", names: inForce(UNIQUE.preset, { [UNIQUE.knob]: UNIQUE.option }) });
  assert.deepEqual(knobPositions(tabs(), UNIQUE.preset, UNIQUE.knob), [UNIQUE.option]);
});

test("test_an_inactive_tiles_knob_shows_its_default_position", async () => {
  await resetTab({ grid: "album", mode: "auto" });
  assert.deepEqual(knobPositions(tabs(), UNIQUE.preset, UNIQUE.knob), [UNIQUE.fallback]);
});

// ============================================================================
// the two lanes are two wires
// ============================================================================

test("test_a_tile_press_on_the_live_lane_writes_the_live_fields_by_enum_id", async () => {
  const w = await resetLive({ grid: "album" });
  pressTile(seenOf(html`<${EasyCard} lane="live" />`), FIRST_ALBUM);
  await flush(w);
  assert.deepEqual(postedFields(w), liveExpected(FIRST_ALBUM));
});

test("test_a_tile_press_on_the_live_lane_stages_nothing", async () => {
  const w = await resetLive({ grid: "album" });
  pressTile(seenOf(html`<${EasyCard} lane="live" />`), FIRST_ALBUM);
  await flush(w);
  assert.deepEqual(w.staged, EMPTY);
});

test("test_a_tile_press_on_the_tabs_lane_never_reaches_the_live_path", async () => {
  const w = await resetTab({ grid: "album", mode: "pcm" });
  pressTile(seenOf(html`<${EasyCard} />`), FIRST_ALBUM);
  await flush(w);
  assert.deepEqual(w.posts, []);
});

// ============================================================================
// the placeholder
// ============================================================================

test("test_pressing_the_placeholder_writes_nothing", async () => {
  const w = await resetTab({ grid: "album", mode: "pcm" });
  pressWhatever(seenOf(html`<${EasyCard} />`), TESTID, ADD);
  await flush(w);
  assert.deepEqual(w.staged, EMPTY);
});
