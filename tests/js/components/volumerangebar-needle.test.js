// Behavioral suite for the Volume Range card's playback-volume needle: the mark
// the card lays on its -120..+12 dBFS axis at the level the engine is actually
// playing at, beside the Min / Startup / Max bounds the same card configures.
//
// Policy (docs/testing.md): public API only, one assertion per test. Every case
// renders the exported `VolumeRangeBar` — which takes no props — driven by the
// exported store signals. `volume` carries the engine-reported level (a dB
// string, null before the first report), `volumeDrag` the dB currently being
// dragged on the playback-volume knob — null when no drag is in flight, and the
// winner over `volume` while there is one — and `volumeRange` carries the daemon's
// `VolumeRange` reply, `{min, max, enabled, adaptive}` (docs/protocol.md §6:
// `<VolumeRange min="-60" max="0" enabled="1" adaptive="0"/>`, where enabled="0"
// means the volume control is bypassed). Nothing is stubbed; the wire is a
// staging fake on the real REST paths.
//
// The mark is addressed by its class word, `vr-needle`, the way the sibling
// suites address `vr-tick`, `vr-loud` and `vr-loud-legend`: in this card a mark's
// class IS the public surface, and counting the elements that carry it is an
// absolute question the rendered card answers on its own. A differential probe —
// diffing this render against the `volume === null` one — would be blind to a
// needle that was already on the track before any volume was reported, and blind
// again to one drawn at `left:NaN%`, which carries no position to diff but is
// still a needle in the markup.
//
// Positions are compared as numbers, not as rendered strings: the contract is
// that the mark sits at `(d + 120) / 132 * 100` percent of the track, not that
// the component prints that to any particular precision. The half-percent
// tolerance is the sibling axis suite's, and is far tighter than the thumb-inset
// correction the needle must NOT carry — an inset sized for a range thumb moves
// an end mark by well over a percent, so these cases separate the two mappings.
//
// State reset is total on every call: module-level signals outlive a test, so a
// partial reset makes cases pass alone and fail in sequence.
//
// NOT REACHABLE from a policy-compliant test, and deliberately left uncovered:
//   * that the needle refuses a drag. This app expresses draggability with range
//     inputs and pointer handlers, neither of which server-side rendering emits
//     or fires, so there is no server-side observable separating a draggable mark
//     from a fixed one. What IS observable — that the mark is not a control — is
//     pinned below as the absence of an `<input>` on it. A real pointer check
//     belongs to the playwright hand-back protocol.
//
// NOT COVERED, because the sibling suites own it: gridlines, labels, the filled
// span, the loudness lane, the gray and dirty states. See
// tests/js/components/volumerangebar.test.js and -axis.test.js. The one case here
// that touches them asserts only that the needle's arrival leaves them alone.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/volumerangebar-needle.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { VolumeRangeBar } from "../../../hqptuner/static/components/VolumeRangeBar.js";
import {
  volume,
  volumeDrag,
  volumeRange,
  config,
  enums,
  engineState,
  matrixConfig,
} from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { ok, stagingWire } from "../support/wire.js";

// The daemon's own /config form field names; startup volume is defaults_volume.
// Scenery for every case here — the needle rides the axis, not these bounds.
const FORM = { volume_min: "-60", volume_max: "0", defaults_volume: "-20" };

// The engine's VolumeRange reply. The window it reports is deliberately NARROWER
// than the axis (-60..0 against -120..+12) so that a needle placed against the
// reported window rather than against the axis lands somewhere else entirely.
const ON = { min: "-60", max: "0", enabled: "1", adaptive: "0" };
const OFF = { ...ON, enabled: "0" };

async function reset({ range = ON, level = null, drag = null, running = FORM } = {}) {
  // Fake wire (docs/testing.md rule 4): a real pending buffer over the real REST
  // paths, so the card's staged view is the one the backend would hand it.
  stagingWire({ fallback: (w) => ok(w.staged) });
  volume.value = level;
  volumeDrag.value = drag;
  volumeRange.value = range;
  enums.value = null;
  engineState.value = {};
  matrixConfig.value = null;
  config.value = { fields: Object.entries(running).map(([name, value]) => ({ name, value })), file: {} };
  await discardAll();
}

const bar = () => render(html`<${VolumeRangeBar} />`);

// Track position of a level in dBFS as a plain percentage of the -120..+12 axis
// (hqptuner/static/lib/volume.js AXIS_MIN / AXIS_MAX, span 132).
const pos = (db) => ((db + 120) / 132) * 100;
const near = (a, b) => a !== undefined && Math.abs(a - b) < 0.5;

const attrOf = (tag, name) => (new RegExp(`\\s${name}="([^"]*)"`).exec(tag) || [])[1];
const classWords = (tag) => (attrOf(tag, "class") || "").split(/\s+/).filter(Boolean);

// Whole open tags — of any element name — whose class list carries `word`. Class
// words are matched whole: a bare substring match on `vr-needle` would also hit
// a `vr-needle-legend`, exactly as `vr-tick` hits `vr-tick-label`.
const tagged = (out, word) =>
  [...out.matchAll(/<[a-zA-Z][^>]*>/g)].map((m) => m[0]).filter((t) => classWords(t).includes(word));

const NEEDLE = "vr-needle";
const needles = (out) => tagged(out, NEEDLE);

// The needle's track position, as a percentage. `undefined` when the mark is
// absent, and equally when it is present carrying a position that is not a
// number — `left:NaN%` matches no percentage, so a case expecting a position
// fails on it rather than reading past it.
const cssPct = (tag, prop) => {
  const style = attrOf(tag, "style") || "";
  const hit = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)%`).exec(style);
  return hit ? parseFloat(hit[1]) : undefined;
};
const needleLeft = (out) => cssPct(needles(out)[0] || "", "left");

const LEGEND = "Playback volume";
const legendPresent = (out) => out.includes(LEGEND);
const lefts = (out) => [...out.matchAll(/left\s*:\s*(-?[\d.]+)%/g)].map((m) => parseFloat(m[1]));
const inputs = (out) => [...out.matchAll(/<input[^>]*>/g)].map((m) => m[0]);

// --- the mark exists ---------------------------------------------------------

test("test_a_reported_volume_draws_one_needle", async () => {
  await reset({ level: "-54" });
  assert.equal(needles(bar()).length, 1);
});

// --- where the needle lands --------------------------------------------------

test("test_the_needle_sits_at_the_reported_volumes_axis_position", async () => {
  // -54 dBFS is the midpoint of the -120..+12 axis. Against the engine's own
  // reported -60..0 window it would instead be 10%, so this case separates the
  // axis mapping from the window mapping.
  await reset({ level: "-54" });
  assert.ok(near(needleLeft(bar()), pos(-54)));
});

test("test_a_needle_at_the_axis_floor_sits_at_the_left_edge", async () => {
  // Plain percentage, exactly as the filled span uses: a thumb-inset correction
  // — right for a range input, wrong for a mark that is not one — would push
  // this off zero by more than the tolerance.
  await reset({ level: "-120" });
  assert.ok(near(needleLeft(bar()), 0));
});

test("test_a_needle_at_the_gain_ceiling_sits_at_the_right_edge", async () => {
  await reset({ level: "12" });
  assert.ok(near(needleLeft(bar()), 100));
});

test("test_a_needle_a_quarter_up_the_axis_sits_at_a_quarter", async () => {
  // -87 dBFS: a third reference point, so a mapping that happened to fit both
  // ends still has to fit the middle.
  await reset({ level: "-87" });
  assert.ok(near(needleLeft(bar()), pos(-87)));
});

test("test_a_fractional_volume_lands_between_the_gridlines", async () => {
  // the engine reports dB as a string and need not report a whole one
  await reset({ level: "-54.5" });
  assert.ok(near(needleLeft(bar()), pos(-54.5)));
});

// --- a level off the ends of the axis ----------------------------------------

test("test_a_volume_below_the_axis_floor_lands_on_the_left_edge", async () => {
  await reset({ level: "-200" });
  assert.ok(near(needleLeft(bar()), 0));
});

test("test_a_volume_above_the_gain_ceiling_lands_on_the_right_edge", async () => {
  await reset({ level: "20" });
  assert.ok(near(needleLeft(bar()), 100));
});

// --- a drag on the playback knob, in flight ----------------------------------
// While the user is dragging the playback-volume knob, `volumeDrag` carries the
// dB being dragged and the needle follows the KNOB, not the level the last poll
// reported: the needle is what tells the user where the drag has got to. The
// engine level in these cases is -12, whose position is nowhere near any of the
// dragged ones, so a needle still reading the poll lands far outside tolerance.

test("test_a_drag_in_progress_puts_the_needle_at_the_dragged_value", async () => {
  await reset({ level: "-12", drag: -54 });
  assert.ok(near(needleLeft(bar()), pos(-54)));
});

test("test_a_drag_to_zero_decibels_puts_the_needle_at_the_zero_position", async () => {
  // 0 dB is the trap: falsy, so a needle picking its source with `||` shows the
  // engine's -12 instead of the top of the knob's travel
  await reset({ level: "-12", drag: 0 });
  assert.ok(near(needleLeft(bar()), pos(0)));
});

test("test_a_drag_before_the_first_engine_report_draws_a_needle", async () => {
  await reset({ level: null, drag: -54 });
  assert.equal(needles(bar()).length, 1);
});

test("test_a_released_drag_returns_the_needle_to_the_engine_report", async () => {
  await reset({ level: "-12", drag: -54 });
  volumeDrag.value = null;
  assert.ok(near(needleLeft(bar()), pos(-12)));
});

// --- when there is no needle at all ------------------------------------------

test("test_no_volume_reported_yet_draws_no_needle", async () => {
  await reset({ level: null });
  assert.equal(needles(bar()).length, 0);
});

test("test_a_disabled_volume_control_draws_no_needle", async () => {
  await reset({ level: "-54", range: OFF });
  assert.equal(needles(bar()).length, 0);
});

// `volume` arrives off the wire as a string and the store does not validate it,
// so a report carrying no usable number is the same condition to this card as no
// report at all. The empty string is the trap worth naming: `Number("")` is 0,
// which would park a needle at the limiter threshold rather than draw none — and
// an unguarded `parseFloat` puts one at `left:NaN%`, which is still a needle on
// the track and still fails this count.
for (const [name, level] of [
  ["an_empty_string", ""],
  ["a_non_numeric_string", "mute"],
]) {
  test(`test_${name}_volume_draws_no_needle`, async () => {
    await reset({ level });
    assert.equal(needles(bar()).length, 0);
  });
}

// The enabled flag reaches the frontend in three truthy wire forms and several
// false ones; anything that is not 1, "1" or true means the control is bypassed
// (fixed volume, Direct SDM, or no active stream) and there is no playing level
// to mark.
for (const [name, enabled] of [
  ["a_string_zero", "0"],
  ["a_numeric_zero", 0],
  ["a_boolean_false", false],
  ["a_missing_flag", undefined],
]) {
  test(`test_${name}_on_the_volume_range_draws_no_needle`, async () => {
    await reset({ level: "-54", range: { ...ON, enabled } });
    assert.equal(needles(bar()).length, 0);
  });
}

test("test_no_volume_range_reported_yet_draws_no_needle", async () => {
  await reset({ level: "-54", range: null });
  assert.equal(needles(bar()).length, 0);
});

for (const [name, enabled] of [
  ["a_string_one", "1"],
  ["a_numeric_one", 1],
  ["a_boolean_true", true],
]) {
  test(`test_${name}_on_the_volume_range_draws_the_needle`, async () => {
    await reset({ level: "-54", range: { ...ON, enabled } });
    assert.equal(needles(bar()).length, 1);
  });
}

// --- the needle is a mark, not a control -------------------------------------

test("test_the_needles_mark_is_not_an_input", async () => {
  await reset({ level: "-54" });
  assert.equal(inputs(bar()).filter((t) => classWords(t).includes(NEEDLE)).length, 0);
});

test("test_the_needle_adds_no_control_to_the_card", async () => {
  // the card's controls are the three range handles pinned in
  // tests/js/components/volumerangebar-axis.test.js and the three number boxes
  // pinned in tests/js/components/volumerangebar.test.js; loudness is off here,
  // so its two bound handles are absent and a needle that arrived as a seventh
  // control moves this count
  await reset({ level: "-54" });
  assert.equal(inputs(bar()).length, 6);
});

// --- the needle disturbs nothing already on the track ------------------------

test("test_a_reported_volume_leaves_every_other_track_position_in_place", async () => {
  // No sibling suite ever assigns `volume`, so nothing anywhere else renders
  // this bar with a needle on it: the ticks, labels, brackets, fill and loudness
  // lane are only ever pinned on a needle-free card. The needle ADDS a mark and
  // removes none, so every position drawn without one survives its arrival.
  await reset({ level: null });
  const before = lefts(bar());
  await reset({ level: "-54" });
  const pool = lefts(bar());
  const lost = before.filter((value) => {
    const at = pool.indexOf(value);
    if (at === -1) return true;
    pool.splice(at, 1);
    return false;
  });
  assert.deepEqual(lost, []);
});

// --- the legend --------------------------------------------------------------

test("test_a_drawn_needle_names_the_playback_volume_in_the_legend", async () => {
  await reset({ level: "-54" });
  assert.equal(legendPresent(bar()), true);
});

test("test_a_disabled_volume_control_drops_the_playback_volume_legend", async () => {
  await reset({ level: "-54", range: OFF });
  assert.equal(legendPresent(bar()), false);
});

test("test_no_volume_reported_yet_drops_the_playback_volume_legend", async () => {
  await reset({ level: null });
  assert.equal(legendPresent(bar()), false);
});

test("test_an_unparseable_volume_drops_the_playback_volume_legend", async () => {
  await reset({ level: "" });
  assert.equal(legendPresent(bar()), false);
});
