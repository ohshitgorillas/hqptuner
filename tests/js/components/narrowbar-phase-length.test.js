// Behavioral suite for the narrow bar's PHASE and LENGTH facets
// (components/narrowbar/Facets.js for the popovers,
// components/narrowbar/labels.js for the button wording).
//
// Both facets are multi-select, the way genre and focus are: the popover offers
// its values as checkbox rows, the empty selection means "any", and there is no
// row inside the popover that clears the facet — unticking the last row is what
// clears it, and the button says so. The one difference from genre and focus is
// that neither carries an AND/OR combine switch: a filter has exactly one phase
// and exactly one length, so an AND across two picks would be empty by
// construction and the picks always union.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. State is driven by assigning the exported source signals
// the real payloads carry — the engine's own `<GetFilters/>` enumeration
// (protocol.md:226) — and by resetNarrowing(). Opening a facet and reading its
// rows, chips and button captions back off the emitted HTML lives in
// tests/js/support/genrepopover.js, which states what that route couples to.
//
// Which filters a picked phase or length then hides is the store suite's
// subject (tests/js/store/narrowing.test.js), not this file's.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/narrowbar-phase-length.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { nPhase, nLength } from "../../../hqptuner/static/store/narrow/state.js";
import { phaseLabel, lengthLabel } from "../../../hqptuner/static/components/narrowbar/labels.js";
import {
  resetNarrowBar,
  openFacet as open,
  popoverRows as rows,
  checkedRows,
  countChip,
  nxOf,
  buttonCaptions,
} from "../support/genrepopover.js";

/**
 * A fixture filter, ratio-agnostic so that nothing but the quality floor and
 * the name's own phase or length can trim it. The rating rides in the
 * description the way the engine spells it, `"<q>/5 [focus, ...] <glyph>
 * <ratio>"`, and defaults above the quality facet's own floor of 3.
 *
 * @param {string} name
 * @param {number} index
 * @param {number} [rating]
 */
const item = (name, index, rating = 4) => ({
  index: String(index),
  name,
  value: String(index),
  arg: 1,
  description: `${rating}/5 timbre ⥮ Any`,
  apodizing: true,
});

// One linear-phase filter, one minimum-phase, one carrying no phase token —
// and a fourth, linear too, rated BELOW the quality floor. That last one is
// what makes a count chip's reading mean something: it is out of every count
// the bar takes, so a chip answering the fixture's total is a chip that applied
// no narrowing at all.
const PHASES = ["gauss-lp", "gauss-mp", "gauss-plain", "gauss-faint-lp"].map((name, i) =>
  item(name, i, name === "gauss-faint-lp" ? 2 : 4),
);

// The same shape for length: one short, one the taxonomy does not reach, one
// long, and a fourth short one below the quality floor.
const LENGTHS = ["gauss-short", "gauss-plain", "gauss-long", "gauss-faint-short"].map((name, i) =>
  item(name, i, name === "gauss-faint-short" ? 2 : 4),
);

/**
 * Put the bar back to its defaults over one fixture set. A count chip counts a
 * DROPDOWN's options, so both PCM filter slots are handed the same options the
 * /config form would serve for these filters.
 *
 * @param {ReturnType<typeof item>[]} filters
 */
function reset(filters = PHASES) {
  const options = filters.map((f) => ({ value: f.value, label: f.name }));
  const fields = [
    { name: "filter1x", value: "0", options },
    { name: "filter", value: "0", options },
  ];
  return resetNarrowBar(filters, { fields });
}

/** @param {string} block */
const rowKinds = (block) => [...new Set(rows(block).map((r) => r.type))].sort();

/** @param {string} block */
const rowLabels = (block) => rows(block).map((r) => r.label);

// --- multi-select widgets ---------------------------------------------------

test("test_the_phase_facet_offers_its_values_as_checkbox_rows", async () => {
  await reset();
  assert.deepEqual(rowKinds(open("phase")), ["checkbox"]);
});

test("test_the_length_facet_offers_its_values_as_checkbox_rows", async () => {
  await reset();
  assert.deepEqual(rowKinds(open("length")), ["checkbox"]);
});

// The empty selection is what "any" means, so the popover carries no clear row:
// the row list is exactly the domain, in the order the popover offers it. The
// phase domain's last member is the empty string — the filters the phase
// taxonomy does not reach — captioned "No phase". It is a pick like any other
// and is NOT a clear row: clearing is unticking everything. Length has no
// counterpart; its unclassified filters are reachable by no pick at all.

// The name states the order; the same assertion also carries the no-clear-row
// half, which is what the exactness of the list says.
test("test_the_phase_popover_offers_minimum_intermediate_linear_then_no_phase_in_that_order", async () => {
  await reset();
  assert.deepEqual(rowLabels(open("phase")), ["Minimum", "Intermediate", "Linear", "No phase"]);
});

// The empty string is a falsy value carrying a real meaning, so the row it
// stands for has to render ticked from the selection like any other: a
// membership test that guards on the value being truthy leaves the user
// clicking "No phase" and watching nothing happen while the store holds it.
test("test_the_no_phase_row_renders_checked_when_it_is_the_picked_phase", async () => {
  await reset();
  nPhase.value = [""];
  assert.deepEqual(checkedRows(open("phase")), ["No phase"]);
});

test("test_the_length_popover_offers_exactly_the_four_lengths_and_no_clear_row", async () => {
  await reset();
  assert.deepEqual(rowLabels(open("length")), ["Short", "Medium", "Long", "Extra long"]);
});

// --- no combine switch --------------------------------------------------------
// A filter carries exactly one phase and exactly one length, so an AND across
// two picks is empty by construction: the picks union and there is nothing to
// switch. The switch is the segmented AND/OR pair genre and focus close their
// popovers with, read here by its own user-facing wording.

const MODE_CAPTION = /^(and|or)$/i;

// The control on the two negatives below. They say a reader found no and/or
// caption; this says the same reader finds one on a facet that HAS a switch, so
// their empty answer is a fact about the popover rather than about the reader.
test("test_the_same_reader_finds_the_combine_switch_on_a_facet_that_carries_one", async () => {
  await reset();
  assert.ok(buttonCaptions(open("genre")).some((c) => MODE_CAPTION.test(c)));
});

test("test_the_phase_popover_carries_no_and_or_combine_switch", async () => {
  await reset();
  assert.deepEqual(
    buttonCaptions(open("phase")).filter((c) => MODE_CAPTION.test(c)),
    [],
  );
});

test("test_the_length_popover_carries_no_and_or_combine_switch", async () => {
  await reset();
  assert.deepEqual(
    buttonCaptions(open("length")).filter((c) => MODE_CAPTION.test(c)),
    [],
  );
});

// --- the button summary ---------------------------------------------------------
// Owner-approved copy, verbatim: "Any phase" / "Any length" with nothing picked,
// the picked value's own label with exactly one, and "<N> phases" / "<N>
// lengths" past that. No combine-mode suffix, unlike genre and focus.
//
// Phase counts NAMED phases only. "No phase" never adds to the count; picking it
// appends the trailing clause " + no phase", lower-case as the owner wrote it.
// So there is no reading of "1 phase": one named phase shows its own label,
// clause or no clause.

test("test_the_phase_button_with_nothing_picked_reads_any_phase", async () => {
  await reset();
  assert.equal(phaseLabel(), "Any phase");
});

// Linear is not the first row, so this separates "the picked phase's own label"
// from "whatever label row zero carries".
test("test_the_phase_button_with_one_pick_reads_that_phases_own_label", async () => {
  await reset();
  nPhase.value = ["linear"];
  assert.equal(phaseLabel(), "Linear");
});

test("test_the_phase_button_with_two_named_picks_reads_the_count", async () => {
  await reset();
  nPhase.value = ["linear", "minimum"];
  assert.equal(phaseLabel(), "2 phases");
});

test("test_the_phase_button_with_three_named_picks_reads_the_count", async () => {
  await reset();
  nPhase.value = ["linear", "minimum", "intermediate"];
  assert.equal(phaseLabel(), "3 phases");
});

// The empty-string pick is a value like any other where it stands alone, and
// "Any phase" stays the wording for the empty SELECTION, a different state.
// Beside named picks it stops being a value and becomes a clause: it is outside
// the count and trails the rest of the label.

test("test_the_phase_button_with_the_no_phase_pick_alone_reads_no_phase", async () => {
  await reset();
  nPhase.value = [""];
  assert.equal(phaseLabel(), "No phase");
});

test("test_the_phase_button_with_one_named_pick_and_no_phase_reads_that_label_and_the_clause", async () => {
  await reset();
  nPhase.value = ["", "linear"];
  assert.equal(phaseLabel(), "Linear + no phase");
});

test("test_the_phase_button_with_two_named_picks_and_no_phase_counts_only_the_named_two", async () => {
  await reset();
  nPhase.value = ["", "linear", "minimum"];
  assert.equal(phaseLabel(), "2 phases + no phase");
});

// Every row picked. The count still answers three, so a count taken over the
// whole selection reads "4 phases" here and fails.
test("test_the_phase_button_with_every_row_picked_counts_the_three_named_phases", async () => {
  await reset();
  nPhase.value = ["", "linear", "minimum", "intermediate"];
  assert.equal(phaseLabel(), "3 phases + no phase");
});

/**
 * The summary a facet's own toggle puts on screen: its caption, less the
 * disclosure triangle every dropdown button in the app carries (pinned as
 * shared chrome in tests/js/components/common.test.js). Removing a glyph cannot
 * turn one summary into another, so the reading stays exact.
 *
 * @param {string} block
 * @returns {string}
 */
const facetButtonSummary = (block) => buttonCaptions(block)[0].replace("▾", "").trim();

// The anchor under the table above. Every other label case reads the helper,
// which is only worth anything if the button the user reads is what the helper
// answers — a caption formatted inline in the component would leave the whole
// table green and the button wrong. The facet's own toggle is the first button
// in its block. The selection is every row, so the two readings differ: a count
// over the whole selection puts "4 phases" on screen.
test("test_the_rendered_phase_button_reads_the_summary_label", async () => {
  await reset();
  nPhase.value = ["", "linear", "minimum", "intermediate"];
  assert.equal(facetButtonSummary(open("phase")), "3 phases + no phase");
});

test("test_the_length_button_with_nothing_picked_reads_any_length", async () => {
  await reset();
  assert.equal(lengthLabel(), "Any length");
});

test("test_the_length_button_with_one_pick_reads_that_lengths_own_label", async () => {
  await reset();
  nLength.value = ["xlong"];
  assert.equal(lengthLabel(), "Extra long");
});

test("test_the_length_button_with_two_picks_reads_the_count", async () => {
  await reset();
  nLength.value = ["short", "long"];
  assert.equal(lengthLabel(), "2 lengths");
});

// --- a row's count previews the click it would perform ------------------------------
//
// The chip beside a row says what the dropdowns would offer if that row were
// clicked, so on a value already picked it must answer for the selection
// WITHOUT it — clicking a ticked row unticks it.
//
// TWO values are picked, so the previewed state is a real selection rather than
// the empty one, and four readings of this fixture are four different numbers:
// 4 is the total, which a chip narrowing by nothing answers; 3 is the facet
// dropped altogether, which a chip ignoring the phase selection answers; 2 is
// the live selection, which a chip ignoring the preview answers; 1 is the
// unpick, and nothing else in the fixture can produce it. The fourth filter,
// linear but rated below the quality floor, is what separates 4 from 3.

test("test_the_count_on_a_picked_phase_row_previews_unpicking_it", async () => {
  await reset();
  nPhase.value = ["linear", "minimum"];
  assert.equal(nxOf(countChip(open("phase"), "Linear")), 1);
});

test("test_the_count_on_a_picked_length_row_previews_unpicking_it", async () => {
  await reset(LENGTHS);
  nLength.value = ["short", "long"];
  assert.equal(nxOf(countChip(open("length"), "Short")), 1);
});
