// Behavioral suite for the Setting Switcher's A/B buttons — what each side of
// the switch (components/live/AB.js) says it holds.
//
// The card keeps two picked settings for the live field it is aimed at and puts
// one of them on the engine when its side is pressed. The contract here is that
// the button carries the value ITS OWN side holds: the side named by `data-v`,
// not the button's position in the strip and not whatever the engine happens to
// be sitting on. The second case asks the same switch what an unfilled side
// carries, which is where a card that emits a name for every side, filled or
// not, is visible.
//
// A slot holds an enum ID with the display name it was picked with, and a
// filter's ID is an ID within its own chain's list (docs/protocol.md §4, §6),
// so every case drives the PCM chain loaded (`active_chain` on /api/state,
// docs/architecture.md:91) with the daemon's own PCM enumeration
// (support/chainenums.js), whose enum IDs differ from their list indices.
//
// The engine's running 1x filter is list index 1, enum 40, in every case: a
// card that named both buttons from the running value rather than from the
// slots answers poly-sinc-gauss-long on the side holding 25 and is red there.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire — the exported `engineState` / `enums` / `config` signals carry the
// shapes /api/state, /api/enumerations and /api/config actually serve, and the
// two names asserted are the ones this file's own fixture put in the slots
// (rule 9), never wording the card owns.
//
// ORDER MATTERS IN THIS FILE, unavoidably. An unpicked slot is null, and the
// store exposes no writer that can put a null back once a side has been
// written, so the empty-side case reads the state seeded into localStorage
// before the store module loads, and runs before the case that fills side B.
//
// READING TAKEN: the name a side carries is asserted as an element inside that
// side's button, since an empty name node under an unfilled letter is the exact
// difference the second case exists to see and no text-level reading can tell
// it from no node at all. A card that also wrapped its A/B letter in an element
// would turn this red without being wrong; that is a spec question, not a test
// to soften.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/live/liveab-switch.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { staticWire } from "../../support/wire.js";
import { useStorage } from "../../support/storage.js";
import { elements, attr, text, classes } from "../../support/markup.js";
import { PCM_FILTERS, PCM_SHAPERS, JUNK, formField, FORM, LISTS } from "../../support/chainenums.js";

// The two settings the user is switching between, as the card stores them: the
// enum ID that applies, with the display name it was picked with. Both are the
// engine's own, from the PCM enumeration above.
const A_PICK = { id: "25", name: "sinc-M" };
const B_PICK = { id: "40", name: "poly-sinc-gauss-long" };

// Seeded BEFORE the store module is loaded, so the file opens on a card whose
// side B has never been picked. Dynamic imports below are what make that
// ordering real: a static import would be hoisted above this line.
const storage = useStorage();
storage.map.set("hqptuner.abSlots", JSON.stringify({ filter1x: { a: A_PICK, b: null } }));

const { html } = await import("../../../../hqptuner/static/lib/dom.js");
const { AbCard } = await import("../../../../hqptuner/static/components/live/AB.js");
const { abField, abSlots, setAbSlot, setAbTarget } = await import("../../../../hqptuner/static/store/live/ab.js");
const { engineState, enums, config } = await import("../../../../hqptuner/static/store/signals.js");
const { liveErrors, liveBusy } = await import("../../../../hqptuner/static/store/live/state.js");

const RATES = [
  { index: "0", rate: "0" },
  { index: "1", rate: "96000" },
];

// The PCM chain loaded, its 1x filter sitting at list index 1 — enum 40.
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

// Drive the wire the card reads, and aim it at the 1x filter row. A fixture
// that failed to aim it would leave every case asking about a different field,
// so it refuses to run instead (docs/testing.md rule 14).
function aimAtOneXFilter() {
  staticWire({ live: {}, http: {} });
  engineState.value = STATE();
  enums.value = ENUMS();
  config.value = { fields: FIELDS(), file: { mode: "auto", ...FORM }, active: "", profiles: null };
  liveErrors.value = {};
  liveBusy.value = "";
  setAbTarget("filter1x");
  if (abField.value !== "filter1x") throw new Error(`the card is aimed at ${abField.value}, not filter1x`);
}

// The seeded state, read back through the store's own view of it: side A
// picked, side B never picked. A seed that never reached the store would leave
// the empty-side case asking about a card with nothing in it at all, so the
// fixture refuses to run rather than answering about the wrong input.
function requireSeededSlots() {
  const held = JSON.stringify(abSlots.value);
  const want = JSON.stringify({ a: A_PICK, b: null });
  if (held !== want) throw new Error(`the card holds ${held}, not the seeded ${want}`);
}

// The switch's two sides, in document order, located by the machine identity
// each carries (`data-v`) inside the switch region.
/** @param {string} out */
function sides(out) {
  const box = elements(out).filter((el) => classes(el).includes("ab-switch"));
  if (box.length !== 1) throw new Error(`the card renders ${box.length} switches, not one`);
  return elements(box[0].html).filter((el) => el.name === "button" && attr(el, "data-v") !== undefined);
}

/** @param {string} side */
function sideNamed(side) {
  const out = render(html`<${AbCard} />`);
  const found = sides(out).filter((el) => attr(el, "data-v") === side);
  if (found.length !== 1) throw new Error(`the switch carries ${found.length} sides named ${side}, not one`);
  return found[0];
}

// Which of the two picked names a side's button says, as a list so a button
// saying both, or neither, is visible rather than rounded to one of them.
/** @param {string} side */
const namesOn = (side) => [A_PICK.name, B_PICK.name].filter((n) => text(sideNamed(side)).includes(n));

// Every value name the switch carries, as (side, name text) pairs in document
// order: one entry per element nested inside a side's button, which is where a
// name is rendered and where an unfilled side's empty one would be.
function namePairs() {
  const out = render(html`<${AbCard} />`);
  return sides(out).flatMap((b) =>
    elements(b.html)
      .filter((el) => el.start > 0)
      .map((el) => [attr(b, "data-v"), text(el)]),
  );
}

// --- an unfilled side names nothing -------------------------------------------
// First in the file on purpose: side B has never been picked here, and nothing
// the store exports can put that back once a later case writes it.

test("test_an_unpicked_side_carries_no_value_name_while_the_picked_side_names_its_own", () => {
  aimAtOneXFilter();
  requireSeededSlots();
  assert.deepEqual(namePairs(), [["a", A_PICK.name]]);
});

// --- each side names the value it holds ---------------------------------------
// The same button under exchanged slot contents: a name printed per button
// position answers sinc-M in both rows, and a name taken from the running value
// (enum 40) answers poly-sinc-gauss-long in both.

for (const [a, b, holding] of /** @type {[typeof A_PICK, typeof A_PICK, string][]} */ ([
  [A_PICK, B_PICK, "sinc_m"],
  [B_PICK, A_PICK, "poly_sinc_gauss_long"],
])) {
  test(`test_side_a_names_the_value_it_holds_while_it_holds_${holding}`, () => {
    aimAtOneXFilter();
    setAbSlot("a", a.id, a.name);
    setAbSlot("b", b.id, b.name);
    assert.deepEqual(namesOn("a"), [a.name]);
  });
}
