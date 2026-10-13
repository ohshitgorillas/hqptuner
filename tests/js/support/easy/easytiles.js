// The harness for Easy Mode's preset tiles: the daemon form and engine
// enumeration the two lanes are driven with, the wire both lanes are watched
// over, and the click seam
// a cell is pressed by. The cases themselves are
// tests/js/store/faceplate-page/presets.test.js and
// tests/js/components/faceplate-page/presets.test.js.
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// It is imported DYNAMICALLY by those suites, after each one's `useStorage()` call, and
// must stay that way — `store/easy/easyview.js` reads localStorage at import, so a
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
// by the engine's filter name, so every filter here
// gets an id differing from its position in every list it appears in: a lane
// writing the name, the index or the label instead of the id fails loudly
// rather than coinciding with the right answer.

import { writeSet } from "../../../../hqptuner/static/store/easy/easy.js";
import { easyKnobs } from "../../../../hqptuner/static/store/easy/easyview.js";
import * as signals from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import * as narrow from "../../../../hqptuner/static/store/narrow/state.js";
import { everyWrite } from "./easytable.js";
import { stagingWire, ok } from "../wire/wire.js";
import { engineRows, configPayload, enumerations, loaded } from "./easyrate.js";

/** @typedef {import("../wheel.js").VNode} VNode */
/** @typedef {import("../markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../wire/wire.js").StagingWire} StagingWire */
/** @typedef {import("./easyrate.js").Engine} Engine */
/** @typedef {{ id: string, default: string, options: string[], when?: Record<string, string>, whenHires?: boolean, card?: boolean }} Knob */
/** @typedef {{ id: string, emoji: string, knobs: Knob[] }} Preset */

// --- the four filter fields -------------------------------------------------------
//
// Schema keys (store/schema.js).

const PCM_1X = "pcm_filter_1x";
const PCM_NX = "pcm_filter_nx";
const SDM_1X = "sdm_filter_1x";
const SDM_NX = "sdm_filter_nx";

// --- the filter names the curated table can write ------------------------------------
//
// The sweep of the table itself is tests/js/support/easy/easytable.js, shared with
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

/** @param {string} name */
const idOf = (name) => String(ID.get(name));

// --- what the shipped table names ----------------------------------------------------
//
// A knob option id is NOT unique across the card — `emphasis` carries the same
// two option ids on five tiles and `material` the same two on three — so
// `pressKnob` takes the preset whose tile it is pressing and refuses on an
// ambiguous match within it, rather than pressing whichever tile came first in
// the vnode stream.

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
// (tests/js/support/easy/easyrate.js): every name the curated table can write, the id
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

// --- the wire ----------------------------------------------------------------------
//
// One staging server for both lanes, so a case can ask what reached the tabs
// lane's path AND what reached the LIVE lane's in the same run: stage requests
// land in the buffer `stagingWire` holds, live writes land in `w.posts`. The
// read endpoints answer what the signals already hold, so a write that
// re-mirrors afterwards puts back what it found.

/**
 * @param {string} path
 * @param {import("../wire/wire.js").FakeRequest} opts
 * @param {StagingWire} w
 */
const routes = (path, opts, w) => {
  if (path === "/api/config/live") {
    w.posts.push(JSON.parse(String(opts.body)));
    return ok({ report: { live: [] } });
  }
  if (path === "/api/state") return ok({ stale: false, loaded_at: 1, data: signals.engineState.value });
  if (path === "/api/enumerations") return ok({ data: signals.enums.value });
  if (path === "/api/config") return ok({ data: signals.config.value });
  return undefined;
};

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
 * id (`easy.<presetId>`). Every
 * case that does not name it gets the bare notice the fixture has always
 * carried, so a tile shows no prose at all; a case reading what a description
 * RENDERS seeds its own stand-in text here and never meets what ships.
 *
 * @param {boolean} keepKnobs
 * @param {Record<string, object>} copy
 */
function common(keepKnobs, copy) {
  if (!keepKnobs) easyKnobs.value = {};
  signals.metadata.value = { ...META, easy: { ...META.easy, ...copy } };
  signals.matrixConfig.value = { fields: [] };
  // The preview a click in the presets pane leaves behind is module-level like
  // the rest and outlives a case, so it is put back on every reset whether or
  // not the case that follows seeds one.
  signals.previewConfig.value = null;
  signals.pendingPreset.value = null;
  signals.health.value = { reachable: true, info: {} };
  narrow.resetNarrowing();
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
 * fixture made once and reported as a defect in the implementation. Of the live
 * chain controls, only the chain the engine reports LOADED reads its option list from the
 * enumerations; the DORMANT chain reads its options from /api/config
 * (store/live/chains.js:86-107). A dormant chain seeded from an empty form has
 * no options at all, so no filter name can resolve to an id against it and a
 * write to that chain silently posts nothing — which looks exactly like a lane
 * that refused to write.
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
  // No copy: the LIVE lane's cases are about the wire.
  common(keepKnobs, {});
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
  await discardAll();
  return w;
}

// --- the click seam --------------------------------------------------------------------
//
// preact-render-to-string never fires a handler and there is no DOM here, so a
// cell is pressed by invoking the onClick its vnode carries, collected through
// preact's own `options.vnode` creation hook — the renderer's public seam,
// third-party surface. Nothing of HQPTuner's is stubbed.
