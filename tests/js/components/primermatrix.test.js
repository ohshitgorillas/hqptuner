// Behavioral suite for the filter primer's graph (components/primer/Graph.js)
// swept over its whole state matrix, written blind from a spec block: no primer
// source was read. The store (store/primergraph.js) is driven through its
// exported signals and its own enumeration — `RATES`, `outputFactors`,
// `LENGTH_CHIPS`, `ROLLOFF_CHIPS`, `TRANSIENT_CHIPS` — so the matrix is whatever
// the store currently offers rather than a list frozen here.
//
// Policy (docs/testing.md): public API only, one assertion per test, nothing of
// HQPTuner's stubbed. Rule 9: every reading is a number pulled out of SVG
// geometry or an identifier the markup carries (`data-pane`, the plot classes),
// never a word the component prints.
//
// WHAT A SWEEP IS AND IS NOT. These two tests sweep predicates that the existing
// primer point tests — primerfrequency, primerimpulse, primerrates, primerlabels
// and the store's own primergraph suite — pin one state at a time. Those point
// tests stay. A sweep says every state satisfies a shape; it says nothing
// whatever about whether any single state draws the right curve. Only a point
// test does that, so the two kinds are complements and neither replaces the
// other.
//
// Each behavior is a predicate over states, and each test asserts that NO state
// fails it, as a MAP KEYED BY PANE NAME — the failing state names per pane —
// compared against the empty map. Keyed by pane rather than a bare set of names
// on purpose: the keys come from what the render actually carried, so a
// component that renders no panes produces an empty map and fails on the key
// set alone, with no "for each pane" quantifier left to be vacuous over, and a
// failure names the pane it happened in.
//
// These tests assert the invariant, not the current behavior. Where the code
// breaks one, the test is red until the code is fixed; a list of known-failing
// states is not an expected value and does not belong in an assertion.
//
// The sweep is cached at module scope by the fixture, so the store is restored
// once, in a single `after` hook, rather than per test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/primermatrix.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { failingByPane, restore } from "../support/primermatrix.js";

test.after(() => {
  restore();
});

/** The three panes, each drawing nothing that fails the predicate. */
const NONE = { delay: [], frequency: [], impulse: [] };

// --- the cases ------------------------------------------------------------------

// 1. Nothing is drawn outside the plot. In every state, every pane draws every
// vertex of every trace and every fill inside its own plot rectangle: x 30..364
// and y 24..220 in the impulse and delay panes, x 30..764 and y 39..220 in the
// frequency pane, whose top 15 units are the legend band.

test("test_no_pane_draws_a_vertex_outside_its_plot_rectangle", () => {
  assert.deepEqual(
    failingByPane((p) => p.outside > 0),
    NONE,
  );
});

// 2. A filter-derived trace is drawn edge to edge. In every state, a pane that
// draws an `applied` trace draws it reaching both edges of its plot rectangle,
// within the edge tolerance the fixture allows that pane. The impulse pane is
// excluded where the chain resamples nothing: what it draws there is the
// source's own samples rather than a filter output, so covering only the pulse
// is correct. That exclusion is fixed — a state that starts failing is a defect
// in the code, never a second condition appended here.

test("test_an_applied_trace_reaches_both_edges_of_its_plot", () => {
  assert.deepEqual(
    failingByPane((p, s, pane) => p.applied > 0 && p.short > 0 && !(pane === "impulse" && s.outHz === null)),
    NONE,
  );
});
