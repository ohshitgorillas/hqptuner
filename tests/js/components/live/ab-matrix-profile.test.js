// Behavioral suite for the matrix profile row of the Setting Switcher — the
// fourth row the LIVE A/B card offers (store/live/ab.js, components/live/AB.js),
// which switches the running matrix profile rather than a live form field.
//
// The matrix engine can be bypassed, and a profile switch while it is bypassed
// changes nothing a listener hears, so whether the row is offered at all is read
// off the /api/matrix form's `enabled` value. What the row can switch BETWEEN is
// narrower than what the configuration carries: `live_profiles` are the names
// the daemon read at startup and the only ones a live switch can reach, while
// `file_profiles` also carries names the daemon never loaded (docs/matrix-spec.md,
// and tests/js/components/matrix/matrixprofile.test.js for the two lanes). The
// unnamed profile is its own case on both carriers: it is the empty name on the
// wire and the daemon reports it as `[Default]`.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire — the exported `engineState` / `enums` / `config` / `matrixConfig` /
// `descriptions` signals carry the shapes /api/state, /api/enumerations,
// /api/config, /api/matrix and /api/descriptions serve, and every element is
// addressed by the machine identity it carries (`data-v`, a state-bearing class)
// and never by a word the card prints (rule 9). The one text compared verbatim
// is the stand-in note this file's own fixture put on the descriptions wire.
//
// ORDER MATTERS IN THIS FILE, unavoidably. An unpicked slot is null and the
// store exposes no writer that can put a null back, so the case about the
// dropdown an EMPTY side offers reads the state seeded into localStorage before
// the store module loads, and runs before the cases that fill side A.
//
// READINGS TAKEN, where the spec named an outcome without naming a shape:
//   - `abRows` is read as the list of the rows' field values, accepting either a
//     bare field name or a row object carrying `field`; the list asserted is the
//     same under both.
//   - a render option is `{ value, label }`, the shape every other option in
//     this app travels in, and `profileTips` is read for its `text`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/live/ab-matrix-profile.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { staticWire } from "../../support/wire.js";
import { useStorage } from "../../support/storage.js";
import { elements, attr, classes, hasAttr } from "../../support/markup.js";
import { rows as ddRows } from "../../support/comborows.js";
import { PCM_FILTERS, PCM_SHAPERS, JUNK, formField, FORM, LISTS } from "../../support/chainenums.js";

// The profile side B is seeded holding: a name the daemon loaded, so the side is
// filled with something a switch could actually reach.
const HALL = { id: "Hall", name: "Hall" };

// Seeded BEFORE the store module is loaded, so the file opens on a matrix row
// whose side A has never been picked. The dynamic imports below are what make
// that ordering real: static imports would be hoisted above this line.
const storage = useStorage();
storage.map.set("hqptuner.abSlots", JSON.stringify({ matrix_profile: { a: null, b: HALL } }));

const { html } = await import("../../../../hqptuner/static/lib/dom.js");
const { AbCard } = await import("../../../../hqptuner/static/components/live/AB.js");
const { abRows, abLit, abSlots, setAbSlot, setAbTarget } = await import("../../../../hqptuner/static/store/live/ab.js");
const { engineState, enums, config, matrixConfig } = await import("../../../../hqptuner/static/store/signals.js");
const { liveErrors, liveBusy } = await import("../../../../hqptuner/static/store/live/state.js");
const { descriptions } = await import("../../../../hqptuner/static/store/matrix/descriptions.js");
const { profileTips } = await import("../../../../hqptuner/static/components/matrix/ProfileCard.js");

const RATES = [
  { index: "0", rate: "0" },
  { index: "1", rate: "96000" },
];

// The PCM chain loaded, so the three live rows are the PCM fields.
const STATE = () => ({
  mode: "0",
  filter1x: "1",
  filterNx: "2",
  shaper: "1",
  rate: "1",
  filter_junk: "0",
  adaptive: "0",
  volume: "-10.0",
  active_chain: "pcm",
});

const ENUMS = () => ({
  rates: RATES,
  junk_filters: JUNK,
  filters: PCM_FILTERS,
  shapers: PCM_SHAPERS,
  mode: { name: "[source]" },
});

const FIELDS = () => Object.entries(FORM).map(([name, value]) => formField(name, value, LISTS[name]));

// A stored profile as `file_profiles` carries one: its rows and its own
// post-process chain. No case reads either, only the names they are filed under.
const PROF = () => ({ rows: [], post: {} });

// The names the daemon read at startup, and the names the configuration carries.
// `Study` is filed and was never loaded, so no live switch can reach it; `Hall`
// is loaded and not filed. They overlap on `Room`, which is the production-normal
// case for a saved profile.
const LOADED = ["Hall", "Room"];
const SAVED = () => ({ Room: PROF(), Study: PROF() });

/**
 * @typedef {{
 *   enabled?: string,
 *   loaded?: string[],
 *   saved?: Record<string, { rows: unknown[], post: Record<string, unknown> }>,
 *   liveActive?: string,
 *   active?: string,
 * }} MatrixState
 */

// Total reset: every one of these signals outlives a test. The slots are left
// alone here, since the file's first cases are about a side that was never
// picked and nothing can put that back.
/** @param {MatrixState} [matrix] */
function reset({
  enabled = "1",
  loaded = LOADED,
  saved = SAVED(),
  liveActive = "[Default]",
  active = "[Default]",
} = {}) {
  staticWire({ live: {}, http: {} });
  engineState.value = STATE();
  enums.value = ENUMS();
  config.value = { fields: FIELDS(), file: { mode: "auto", ...FORM }, active: "", profiles: null };
  matrixConfig.value = {
    fields: [{ name: "enabled", value: enabled }],
    rows: [],
    live_profiles: loaded,
    file_profiles: saved,
    live_active: liveActive,
    active,
  };
  liveErrors.value = {};
  liveBusy.value = "";
  setAbTarget("matrix_profile");
}

// The seeded empty side, read back through the store's own view of the slots. A
// seed that never reached the store would leave the dropdown cases asking about
// a card in a state no case describes, so the fixture refuses to run rather than
// answering about the wrong input (docs/testing.md rule 14).
function requireEmptyA() {
  const held = /** @type {{ a?: unknown }} */ (abSlots.value || {}).a;
  if (held !== null) throw new Error(`side A holds ${JSON.stringify(held)}, not the seeded empty slot`);
}

/**
 * One switcher row's field value, under either shape a row can travel in.
 *
 * @param {unknown} row
 * @returns {unknown}
 */
const fieldOf = (row) => (typeof row === "string" ? row : /** @type {{ field?: unknown }} */ (row || {}).field);

/** @returns {unknown[]} */
const rowFields = () => /** @type {unknown[]} */ (abRows.value || []).map(fieldOf);

/**
 * The elements of a render carrying a class token, in document order.
 *
 * @param {string} out
 * @param {string} token
 * @returns {import("../../support/markup.js").MarkupElement[]}
 */
const withClass = (out, token) =>
  elements(out)
    .filter((el) => classes(el).includes(token))
    .sort((a, b) => a.start - b.start);

// What the FIRST side's dropdown offers, as the wire values of its option rows
// in document order. A card that renders no dropdown offers nothing, which is a
// list to compare rather than a fixture failure: it is one of the ways the row
// can be wrong.
/** @returns {(string | undefined)[]} */
function firstSlotOffers() {
  const slots = withClass(render(html`<${AbCard} />`), "ab-slot");
  return slots.length === 0 ? [] : ddRows(slots[0].html).map((el) => attr(el, "data-v"));
}

// The switch's two sides, as (side, is it refused) pairs in document order: the
// side named by `data-v`, and whether that button carries `disabled`.
/** @returns {(string | boolean | undefined)[][]} */
function switchSides() {
  const box = withClass(render(html`<${AbCard} />`), "ab-switch");
  if (box.length === 0) return [];
  return elements(box[0].html)
    .filter((el) => el.name === "button" && attr(el, "data-v") !== undefined)
    .sort((a, b) => a.start - b.start)
    .map((el) => [attr(el, "data-v"), hasAttr(el, "disabled")]);
}

// --- what a side's dropdown offers (side A never picked) -----------------------
// FIRST IN THE FILE on purpose: side A is empty here and nothing the store
// exports can put that back once a later case writes it.
//
// `Study` is filed in the configuration and was never loaded, so no press could
// switch to it; the name the OTHER side already holds is not on offer either,
// which is what the two rows below exchange. The unnamed profile is offered as
// the empty value on both.

for (const [other, offered] of /** @type {[{ id: string, name: string }, string[]][]} */ ([
  [HALL, ["", "Room"]],
  [{ id: "Room", name: "Room" }, ["", "Hall"]],
])) {
  test(`test_a_sides_matrix_dropdown_offers_the_loaded_profiles_while_the_other_side_holds_${other.id.toLowerCase()}`, () => {
    reset();
    requireEmptyA();
    setAbSlot("b", other.id, other.name);
    assert.deepEqual(firstSlotOffers(), offered);
  });
}

// --- the row is offered only while the matrix engine is engaged -----------------
// The three PCM rows are there either way, so a card that listed the matrix row
// unconditionally answers the same four names in both states.

for (const [enabled, fields, engine] of /** @type {[string, string[], string][]} */ ([
  ["1", ["filter1x", "filter", "dither", "matrix_profile"], "engaged"],
  ["0", ["filter1x", "filter", "dither"], "bypassed"],
])) {
  test(`test_the_switcher_rows_while_the_matrix_engine_is_${engine}`, () => {
    reset({ enabled });
    assert.deepEqual(rowFields(), fields);
  });
}

// --- which side the running profile lights --------------------------------------
// Side A holds a named profile and side B holds the unnamed one, which is the
// empty name on the wire and `[Default]` on screen. A card comparing the slot's
// id against the reported name literally lights neither side while the default
// is running, and a card lighting whichever side was pressed last answers the
// same letter for all three.

for (const [liveActive, lit, running] of /** @type {[string, string, string][]} */ ([
  ["Room", "a", "the_profile_side_a_holds"],
  ["", "b", "the_default_profile"],
  ["Hall", "", "a_third_profile"],
])) {
  test(`test_the_engine_running_${running}_lights_${lit || "neither_side"}`, () => {
    reset({ liveActive });
    setAbSlot("a", "Room", "Room");
    setAbSlot("b", "", "[Default]");
    assert.equal(abLit.value, lit);
  });
}

// --- which sides can be pressed ---------------------------------------------------
// Side B holds the unnamed profile throughout, which carries no name on the
// daemon's loaded list and is reachable all the same; side A holds a loaded
// profile in the first row and a filed-but-never-loaded one in the second, which
// no press can reach.

for (const [held, sides, holding] of /** @type {[{ id: string, name: string }, (string | boolean)[][], string][]} */ ([
  [
    { id: "Room", name: "Room" },
    [
      ["a", false],
      ["b", false],
    ],
    "a_loaded_profile",
  ],
  [
    { id: "Study", name: "Study" },
    [
      ["a", true],
      ["b", false],
    ],
    "a_profile_the_daemon_never_loaded",
  ],
])) {
  test(`test_the_switch_sides_while_side_a_holds_${holding}`, () => {
    reset();
    setAbSlot("a", held.id, held.name);
    setAbSlot("b", "", "[Default]");
    assert.deepEqual(switchSides(), sides);
  });
}

// --- the note a profile carries ----------------------------------------------------
// The note is the user's own prose, stored against the profile NAME on the
// descriptions wire. Both options below carry a LABEL that is a different
// profile with a different note, so a builder keying the note on the label
// answers the other profile's prose in both rows, and one answering the
// profile's own name fails the first.

const ROOM_NOTE = "Wide stereo, gentle tilt below 200 Hz.";
const STUDY_NOTE = "Near field, no tilt.";
const STAMP = "2026-02-03T04:05:06+00:00";

for (const [option, note, held] of /** @type {[{ value: string, label: string }, string, string][]} */ ([
  [{ value: "Room", label: "Study" }, ROOM_NOTE, "a_stored_note"],
  [{ value: "Hall", label: "Room" }, "", "no_stored_note"],
])) {
  test(`test_an_options_tip_reads_the_profiles_own_note_where_it_has_${held}`, () => {
    reset({ saved: { Room: PROF(), Study: PROF(), Hall: PROF() } });
    descriptions.value = {
      Room: { text: `  ${ROOM_NOTE}  `, updated: STAMP },
      Study: { text: STUDY_NOTE, updated: STAMP },
    };
    assert.equal((profileTips(option) || {}).text, note);
  });
}
