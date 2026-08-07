// Behavioral suite for the Volume Range card's axis furniture: the weighted
// gridlines, the labels that anchor to the ends of the track, and the loudness
// lane the card lays over the same axis when the daemon's /matrix form has
// volume-adaptive loudness compensation switched on.
//
// Policy (docs/testing.md): public API only, one assertion per test. Every case
// renders the exported `VolumeRangeBar` — which takes no props — driven by the
// exported store signals: `config` carries the daemon's /config form (Min,
// Startup, Max), `matrixConfig` carries the /matrix form that owns the loudness
// range fields. Nothing is stubbed; the wire is a staging fake on the real REST
// paths.
//
// Positions are read as numbers, not as rendered strings: the contract is that
// a mark sits at `(d + 120) / 132 * 100` percent of the track, not that the
// component prints that number to any particular precision. Class names are
// matched as whole words for the same reason `vr-tick` alone would also match
// `vr-tick-label` and `vr-loud` alone would also match `vr-loud-low`.
//
// State reset is total on every call: module-level signals outlive a test, so a
// partial reset makes cases pass alone and fail in sequence.
//
// NOT REACHABLE from a policy-compliant test, and deliberately left uncovered:
// staging a bound "through the ordinary edit path" — dragging a bound handle.
// The handles stage from `onInput`, which server-side rendering never fires, so
// every staging case here reaches the same staged state through the exported
// `edit()` instead. The same gap is documented for the Min / Startup / Max
// handles in tests/js/components/volumerangebar.test.js, and the clamp policy
// those handlers apply is exercised directly in tests/js/lib/volume.test.js.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/volumerangebar-axis.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { VolumeRangeBar } from "../../../hqptuner/static/components/VolumeRangeBar.js";
import { config, matrixConfig, enums, engineState } from "../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { stagingWire } from "../support/wire.js";

// The daemon's /config form: Min and Startup inside the volume range, Max at
// unity. The axis itself is fixed (-120..+12), so these are scenery for every
// gridline case and only the loudness cases vary anything.
/** @type {Record<string, string>} */
const FORM = { volume_min: "-60", volume_max: "0", defaults_volume: "-20" };
/** @param {Record<string, string>} spec */
const formFields = (spec) => Object.entries(spec).map(([name, value]) => ({ name, value }));

// The daemon's /matrix form. `loud()` builds the loudness fields the card reads;
// omitting a bound omits the field entirely, which is how a form that never
// carried it looks on the wire.
// The daemon's own bounds for both range fields, as captured in
// tests/support/fixtures/matrix-6.0.4.html line 81. The card lays its handles
// over the whole -120..+12 axis rather than over the field's declared window, so
// every case that pins a handle's own min/max overrides one half of this pair
// with a different number — a bound assertion that echoed the fixture's own
// string back would pass on a card that simply forwarded the daemon's window.
/**
 * One field of the /matrix form as this suite puts it on the wire: the name and
 * the value every field carries, plus the declared window the two range fields
 * ship with and the flags do not.
 *
 * @typedef {{ name: string, value: string | boolean, min?: string, max?: string }} MatrixField
 */

/** @type {{ min: string, max: string }} */
const BOUND = { min: "-120", max: "0" };

// The matrix engine's own enable flag rides the same form (`enabled`,
// hqplayerd-readme.txt §1.11, tests/support/fixtures/matrix-6.0.4.html line 21).
// Loudness compensation is a plugin inside the matrix chain (§1.11.2:
// <post_process> nests inside <matrix>), so a bypassed engine gates it and every
// other post-process control ahead of the feature's own reason. It is engaged by
// default here so that "loudness enabled" means an actually live control.
// `null` for either flag omits that field entirely, which is how a form that
// never carried the switch looks on the wire; `bound` overrides the declared
// window the two range fields ship with.
/**
 * @param {{
 *   enabled?: boolean | null,
 *   engine?: boolean | null,
 *   low?: string,
 *   high?: string,
 *   bound?: { min?: string, max?: string },
 * }} [spec]
 * @returns {MatrixField[]}
 */
function loud({ enabled = true, engine = true, low, high, bound = {} } = {}) {
  const window = { ...BOUND, ...bound };
  /** @type {MatrixField[]} */
  const fields = [];
  if (engine !== null) fields.push({ name: "enabled", value: engine });
  if (enabled !== null) fields.push({ name: "post_loudness_enabled", value: enabled });
  if (low !== undefined) fields.push({ name: "post_loudness_rangelow", value: low, ...window });
  if (high !== undefined) fields.push({ name: "post_loudness_rangehigh", value: high, ...window });
  return fields;
}

/**
 * @param {MatrixField[]} [matrixFields]
 * @param {Record<string, string>} [form]
 * @returns {Promise<void>}
 */
async function reset(matrixFields = [], form = FORM) {
  stagingWire();
  engineState.value = {};
  enums.value = null;
  matrixConfig.value = { fields: matrixFields };
  config.value = { fields: formFields(form), file: {}, active: "", profiles: null };
  await discardAll();
}

const bar = () => render(html`<${VolumeRangeBar} />`);

// --- reading the rendered track ---------------------------------------------------

// Track position of a level in dBFS, as a percentage of the -120..+12 axis.
/** @param {number} db */
const pos = (db) => ((db + 120) / 132) * 100;

// Marks are placed by percentage; a mark is "at" a level when it lands within
// half a percent of it. The closest pair of gridlines the axis draws (0 and -3
// dBFS) are 2.3% apart, so this cannot confuse one mark for another, and it
// holds however many decimals the component chooses to print.
/**
 * @param {number | undefined} a
 * @param {number} b
 */
const near = (a, b) => a !== undefined && Math.abs(a - b) < 0.5;

/**
 * @param {string} attrs
 * @param {string} name
 */
const attrOf = (attrs, name) => (new RegExp(`\\s${name}="([^"]*)"`).exec(attrs) || [])[1];
/**
 * @param {string} attrs
 * @param {string} prop
 * @returns {number | undefined}
 */
const cssPct = (attrs, prop) => {
  const style = attrOf(attrs, "style") || "";
  const hit = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)%`).exec(style);
  return hit ? parseFloat(hit[1]) : undefined;
};
/** @param {string} s */
const decode = (s) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * One mark read off the rendered card: its class words, its two track positions
 * — each absent when the element carries no percentage for that edge — and its
 * flattened text.
 *
 * @typedef {{
 *   words: string[],
 *   left: number | undefined,
 *   right: number | undefined,
 *   text: string,
 * }} Mark
 */

// Every element of `tag` whose class list contains `word` as a whole word, with
// its position, its remaining class words, and its text.
/**
 * @param {string} out
 * @param {string} tag
 * @param {string} word
 * @returns {Mark[]}
 */
function elements(out, tag, word) {
  return out
    .split(`<${tag}`)
    .slice(1)
    .map((chunk) => {
      const cut = chunk.indexOf(">");
      const attrs = chunk.slice(0, cut);
      const inner = chunk.slice(cut + 1).split(`</${tag}>`)[0];
      const words = (attrOf(attrs, "class") || "").split(/\s+/).filter(Boolean);
      return {
        words,
        left: cssPct(attrs, "left"),
        right: cssPct(attrs, "right"),
        text: decode(
          inner
            .replace(/<!--.*?-->/g, "")
            .replace(/<[^<>]*>/g, "")
            .trim(),
        ),
      };
    })
    .filter((e) => e.words.includes(word));
}

/** @param {string} out */
const ticks = (out) => elements(out, "div", "vr-tick");
/** @param {string} out */
const labels = (out) => elements(out, "span", "vr-tick-label");

// Whole tags — of any element name — whose class list carries `word`. The
// loudness bound handles and the legend are addressed this way because what the
// card owes is the class word and the attributes, not any particular element
// name around them.
/** @param {string} tag */
const classWords = (tag) => (attrOf(tag, "class") || "").split(/\s+/).filter(Boolean);
/**
 * @param {string} out
 * @param {string} word
 */
const tagged = (out, word) =>
  [...out.matchAll(/<[a-zA-Z][^>]*>/g)].map((m) => m[0]).filter((t) => classWords(t).includes(word));

// The card's own class words. Missing card is an error rather than an empty
// list, so an absence assertion cannot pass by the card having vanished.
/**
 * @param {string} out
 * @returns {string[]}
 */
const cardWords = (out) => {
  const tag = tagged(out, "vr-card")[0];
  if (!tag) throw new Error("no element with class vr-card in the rendered card");
  return classWords(tag);
};

// The band is addressed by its class word alone: what the card owes is a lane
// spanning the two bounds, not any particular element name around it.
/** @param {string} out */
const lanes = (out) => tagged(out, "vr-loud").map((t) => ({ left: cssPct(t, "left"), right: cssPct(t, "right") }));

// A control is gated when it carries the `disabled` attribute itself — not when
// the word appears inside `aria-disabled`, a class name, or any other value.
/** @param {string} tag */
const isDisabled = (tag) => /\sdisabled(?:=|[\s/>])/.test(tag.replace(/="[^"]*"/g, "="));

// The card's own three volume handles, which ride the same track as the two
// loudness bounds and gray on their own reasons.
const VOLUME_HANDLES = ["vr-min", "vr-startup", "vr-max"];
/**
 * @param {string} out
 * @param {string} word
 */
const volumeHandle = (out, word) => tagged(out, word).filter((t) => attrOf(t, "type") === "range")[0] || "";
/** @param {string} out */
const volumeHandles = (out) => VOLUME_HANDLES.map((word) => volumeHandle(out, word)).filter(Boolean);

// The text of the first element carrying `word`, nested markup flattened.
/**
 * @param {string} out
 * @param {string} word
 * @returns {string | undefined}
 */
function innerText(out, word) {
  const open = tagged(out, word)[0];
  if (!open) return undefined;
  let at = out.indexOf(open) + open.length;
  let depth = 1;
  let text = "";
  const tags = /<!--.*?-->|<\/?[a-zA-Z][^>]*>/g;
  tags.lastIndex = at;
  let hit;
  while ((hit = tags.exec(out)) !== null) {
    text += out.slice(at, hit.index);
    at = tags.lastIndex;
    if (hit[0].startsWith("<!--")) continue;
    if (hit[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) break;
    } else if (!hit[0].endsWith("/>")) {
      depth += 1;
    }
  }
  return decode(text.replace(/\s+/g, " ").trim());
}

const LOW = "vr-loud-low";
const HIGH = "vr-loud-high";
/**
 * @param {string} out
 * @param {string} word
 */
const bound = (out, word) => tagged(out, word)[0] || "";
/** @param {string} out */
const bounds = (out) => [...tagged(out, LOW), ...tagged(out, HIGH)];
/** @param {string} out */
const numberBoxes = (out) =>
  [...out.matchAll(/<input[^>]*>/g)].map((m) => m[0]).filter((t) => attrOf(t, "type") === "number");

// The one extra class word a mark carries beside its own kind: a gridline's
// weight, a label's anchor.
/**
 * @param {Mark | undefined} el
 * @param {string} kind
 * @returns {string | undefined}
 */
const modifier = (el, kind) => (el ? el.words.filter((w) => w !== kind)[0] : undefined);

/**
 * @param {string} out
 * @param {number} db
 */
const tickAt = (out, db) => ticks(out).find((t) => near(t.left, pos(db)));
/**
 * @param {string} out
 * @param {number} db
 */
const labelAt = (out, db) => labels(out).find((l) => near(l.left, pos(db)));
/**
 * @param {string} out
 * @param {string} weight
 */
const weightCount = (out, weight) => ticks(out).filter((t) => modifier(t, "vr-tick") === weight).length;
/**
 * @param {string} out
 * @param {string} anchor
 */
const anchorCount = (out, anchor) => labels(out).filter((l) => modifier(l, "vr-tick-label") === anchor).length;

// --- gridlines ---------------------------------------------------------------------

// One line every 10 dB from -120 through 0 (13), plus the gain ceiling at +12
// and the resampling ceiling at -3: fifteen in all, and nothing above 0 other
// than +12. The count alone cannot see a line in the wrong place, so the
// decades are pinned by position as well.
test("test_the_axis_draws_fifteen_gridlines", async () => {
  await reset();
  assert.equal(ticks(bar()).length, 15);
});

for (let db = -110; db <= -10; db += 10) {
  test(`test_a_gridline_sits_at_${String(db).replace("-", "minus_")}_db`, async () => {
    await reset();
    assert.ok(tickAt(bar(), db) !== undefined);
  });
}

test("test_nothing_is_drawn_at_plus_10_db", async () => {
  // the only mark above the limiter threshold is the gain ceiling at +12; a
  // decade line at +10 would land 2px from it
  await reset();
  assert.equal(tickAt(bar(), 10), undefined);
});

test("test_the_limiter_threshold_at_0_db_is_a_strong_gridline", async () => {
  await reset();
  assert.equal(modifier(tickAt(bar(), 0), "vr-tick"), "strong");
});

test("test_the_resampling_ceiling_at_minus_3_db_is_a_strong_gridline", async () => {
  await reset();
  assert.equal(modifier(tickAt(bar(), -3), "vr-tick"), "strong");
});

test("test_only_the_two_reference_marks_are_strong_gridlines", async () => {
  await reset();
  assert.equal(weightCount(bar(), "strong"), 2);
});

test("test_five_gridlines_are_major", async () => {
  await reset();
  assert.equal(weightCount(bar(), "major"), 5);
});

test("test_eight_gridlines_are_minor", async () => {
  // the decades carrying neither a number nor a reference level: -110, -100,
  // -80, -70, -50, -40, -20, -10
  await reset();
  assert.equal(weightCount(bar(), "minor"), 8);
});

test("test_minus_60_db_is_a_major_gridline", async () => {
  await reset();
  assert.equal(modifier(tickAt(bar(), -60), "vr-tick"), "major");
});

// --- labels --------------------------------------------------------------------------

test("test_seven_gridlines_carry_a_label", async () => {
  await reset();
  assert.equal(labels(bar()).length, 7);
});

test("test_the_axis_floor_states_the_unit_once", async () => {
  // the first number read on the axis carries the dB unit; every other label is
  // a bare number
  await reset();
  assert.equal(labelAt(bar(), -120)?.text, "-120 dB");
});

test("test_the_gain_ceiling_is_labelled_plus_12", async () => {
  await reset();
  assert.equal(labelAt(bar(), 12)?.text, "+12");
});

test("test_the_limiter_threshold_is_labelled_0", async () => {
  await reset();
  assert.equal(labelAt(bar(), 0)?.text, "0");
});

test("test_minus_90_is_labelled_as_a_bare_number", async () => {
  await reset();
  assert.equal(labelAt(bar(), -90)?.text, "-90");
});

test("test_minus_60_is_labelled_as_a_bare_number", async () => {
  await reset();
  assert.equal(labelAt(bar(), -60)?.text, "-60");
});

test("test_minus_30_is_labelled_as_a_bare_number", async () => {
  await reset();
  assert.equal(labelAt(bar(), -30)?.text, "-30");
});

test("test_the_resampling_ceiling_is_labelled_minus_3", async () => {
  await reset();
  assert.equal(labelAt(bar(), -3)?.text, "-3");
});

test("test_the_resampling_ceilings_label_stays_centred", async () => {
  // -3 sits 2.3% from 0 on the track and still takes the ordinary interior
  // anchor: no special crowding rule applies to it
  await reset();
  assert.equal(modifier(labelAt(bar(), -3), "vr-tick-label"), "edge-mid");
});

test("test_minus_110_carries_no_label", async () => {
  await reset();
  assert.equal(labelAt(bar(), -110), undefined);
});

test("test_the_label_at_the_left_end_anchors_to_that_end", async () => {
  await reset();
  assert.equal(modifier(labelAt(bar(), -120), "vr-tick-label"), "edge-start");
});

test("test_the_label_at_the_right_end_anchors_to_that_end", async () => {
  await reset();
  assert.equal(modifier(labelAt(bar(), 12), "vr-tick-label"), "edge-end");
});

test("test_a_label_away_from_either_end_stays_centred", async () => {
  await reset();
  assert.equal(modifier(labelAt(bar(), -60), "vr-tick-label"), "edge-mid");
});

test("test_only_one_label_anchors_to_the_left_end", async () => {
  await reset();
  assert.equal(anchorCount(bar(), "edge-start"), 1);
});

test("test_only_one_label_anchors_to_the_right_end", async () => {
  await reset();
  assert.equal(anchorCount(bar(), "edge-end"), 1);
});

// --- the loudness band and its two bound handles -----------------------------------------
//
// Volume-adaptive loudness compensation (hqplayerd-readme.txt §1.11.2.1) applies
// its full bass/treble adjustment at or below the lower bound and none at or
// above the upper, so both bounds are levels on this same dBFS axis and ride the
// card as two further draggable handles.
//
// The bound pair below is -54 / -21 on purpose: the band's expected `left` (50%)
// and expected `right` (25%) are different numbers, so an implementation that
// swapped the two fails rather than passing both.
const PAIR = { low: "-54", high: "-21" };
const BAND_LEFT = pos(-54);
const BAND_RIGHT = 100 - pos(-21);

test("test_enabled_loudness_draws_one_lower_bound_handle", async () => {
  await reset(loud(PAIR));
  assert.equal(tagged(bar(), LOW).length, 1);
});

test("test_enabled_loudness_draws_one_upper_bound_handle", async () => {
  await reset(loud(PAIR));
  assert.equal(tagged(bar(), HIGH).length, 1);
});

test("test_the_lower_bound_handle_is_a_range_input", async () => {
  await reset(loud(PAIR));
  assert.equal(attrOf(bound(bar(), LOW), "type"), "range");
});

test("test_the_upper_bound_handle_is_a_range_input", async () => {
  await reset(loud(PAIR));
  assert.equal(attrOf(bound(bar(), HIGH), "type"), "range");
});

test("test_disabled_loudness_draws_no_bound_handle", async () => {
  await reset(loud({ enabled: false, ...PAIR }));
  assert.equal(bounds(bar()).length, 0);
});

test("test_a_form_without_the_loudness_switch_draws_no_bound_handle", async () => {
  // engine engaged and both range fields present: the missing switch is the one
  // thing that varies from the drawing case
  await reset(loud({ enabled: null, ...PAIR }));
  assert.equal(bounds(bar()).length, 0);
});

test("test_enabled_loudness_draws_a_band", async () => {
  await reset(loud(PAIR));
  assert.equal(lanes(bar()).length, 1);
});

test("test_disabled_loudness_draws_no_band", async () => {
  await reset(loud({ enabled: false, ...PAIR }));
  assert.equal(lanes(bar()).length, 0);
});

test("test_a_form_without_the_loudness_switch_draws_no_band", async () => {
  await reset(loud({ enabled: null, ...PAIR }));
  assert.equal(lanes(bar()).length, 0);
});

test("test_the_lower_bound_handle_shows_the_running_lower_bound", async () => {
  await reset(loud(PAIR));
  assert.equal(attrOf(bound(bar(), LOW), "value"), "-54");
});

test("test_the_upper_bound_handle_shows_the_running_upper_bound", async () => {
  await reset(loud(PAIR));
  assert.equal(attrOf(bound(bar(), HIGH), "value"), "-21");
});

test("test_a_staged_lower_bound_moves_its_handle", async () => {
  await reset(loud(PAIR));
  await edit("loudness_range_low", "-70");
  assert.equal(attrOf(bound(bar(), LOW), "value"), "-70");
});

test("test_a_staged_upper_bound_moves_its_handle", async () => {
  await reset(loud(PAIR));
  await edit("loudness_range_high", "-9");
  assert.equal(attrOf(bound(bar(), HIGH), "value"), "-9");
});

// A form that carries no answer for a bound leaves the bar on the level the
// loudness plot reads for it, so the two views never disagree: -60 for the
// lower bound, -20 for the upper.
test("test_a_missing_lower_bound_falls_back_to_minus_60", async () => {
  await reset(loud({ high: "-21" }));
  assert.equal(attrOf(bound(bar(), LOW), "value"), "-60");
});

test("test_a_missing_upper_bound_falls_back_to_minus_20", async () => {
  await reset(loud({ low: "-54" }));
  assert.equal(attrOf(bound(bar(), HIGH), "value"), "-20");
});

test("test_the_lower_bound_handle_reaches_the_axis_floor", async () => {
  // the form declares a floor of -96 here, so a handle that merely forwarded the
  // daemon's window would answer -96 rather than the axis floor
  await reset(loud({ ...PAIR, bound: { min: "-96" } }));
  assert.equal(attrOf(bound(bar(), LOW), "min"), "-120");
});

test("test_the_upper_bound_handle_reaches_the_axis_floor", async () => {
  await reset(loud({ ...PAIR, bound: { min: "-96" } }));
  assert.equal(attrOf(bound(bar(), HIGH), "min"), "-120");
});

test("test_the_lower_bound_handle_reaches_the_gain_ceiling", async () => {
  // a range input's thumb travels its own min..max across the element's width,
  // so a handle laid over this track must span the whole -120..+12 axis or every
  // bound lands right of the gridline it names. The daemon's 0 dBFS ceiling on
  // both bounds is the clamp's job, not this attribute's — see the loudness
  // cases in tests/js/lib/volume.test.js.
  await reset(loud(PAIR));
  assert.equal(attrOf(bound(bar(), LOW), "max"), "12");
});

test("test_the_upper_bound_handle_reaches_the_gain_ceiling", async () => {
  await reset(loud(PAIR));
  assert.equal(attrOf(bound(bar(), HIGH), "max"), "12");
});

// Every handle on the track spans the whole axis, not the window its own field
// declares: a range input's thumb travels its own min..max across the element's
// width, so a shorter span puts the handle beside the gridline it names. The
// number boxes deliberately differ — Min stops at 0 dBFS and Startup rides
// between its neighbours — and those are pinned in
// tests/js/components/volumerangebar.test.js.
for (const word of VOLUME_HANDLES) {
  test(`test_the_${word.replace("vr-", "")}_handle_spans_the_whole_axis`, async () => {
    await reset(loud(PAIR));
    const tag = volumeHandle(bar(), word);
    assert.deepEqual([attrOf(tag, "min"), attrOf(tag, "max")], ["-120", "12"]);
  });
}

test("test_the_lower_bound_handle_steps_by_a_whole_decibel", async () => {
  await reset(loud(PAIR));
  assert.equal(attrOf(bound(bar(), LOW), "step"), "1");
});

test("test_the_upper_bound_handle_steps_by_a_whole_decibel", async () => {
  await reset(loud(PAIR));
  assert.equal(attrOf(bound(bar(), HIGH), "step"), "1");
});

test("test_the_band_starts_at_the_lower_bounds_track_position", async () => {
  await reset(loud(PAIR));
  assert.ok(near(lanes(bar())[0]?.left, BAND_LEFT));
});

test("test_the_band_ends_at_the_upper_bounds_track_position", async () => {
  await reset(loud(PAIR));
  assert.ok(near(lanes(bar())[0]?.right, BAND_RIGHT));
});

test("test_the_lower_bound_handle_is_labelled_for_assistive_technology", async () => {
  await reset(loud(PAIR));
  assert.equal(decode(attrOf(bound(bar(), LOW), "aria-label")), "Loudness lower bound");
});

test("test_the_upper_bound_handle_is_labelled_for_assistive_technology", async () => {
  await reset(loud(PAIR));
  assert.equal(decode(attrOf(bound(bar(), HIGH), "aria-label")), "Loudness upper bound");
});

// --- the dirty highlight ------------------------------------------------------------------

test("test_a_staged_lower_bound_marks_the_card_dirty", async () => {
  await reset(loud(PAIR));
  await edit("loudness_range_low", "-70");
  assert.ok(cardWords(bar()).includes("dirty"));
});

test("test_a_staged_upper_bound_marks_the_card_dirty", async () => {
  await reset(loud(PAIR));
  await edit("loudness_range_high", "-9");
  assert.ok(cardWords(bar()).includes("dirty"));
});

test("test_a_staged_lower_bound_marks_the_lower_bound_handle_dirty", async () => {
  await reset(loud(PAIR));
  await edit("loudness_range_low", "-70");
  assert.ok(classWords(bound(bar(), LOW)).includes("dirty"));
});

test("test_a_staged_lower_bound_leaves_the_upper_bound_handle_clean", async () => {
  await reset(loud(PAIR));
  await edit("loudness_range_low", "-70");
  assert.equal(classWords(bound(bar(), HIGH)).includes("dirty"), false);
});

test("test_a_staged_lower_bound_leaves_a_loudness_free_card_clean", async () => {
  // nothing loudness-related is drawn while compensation is off, so there is
  // nothing on this card for the edit to light
  await reset(loud({ enabled: false, ...PAIR }));
  await edit("loudness_range_low", "-70");
  // parsed class words, not a literal attribute: a card whose class list gained
  // any further word would slip past a whole-attribute match
  assert.equal(cardWords(bar()).includes("dirty"), false);
});

test("test_a_staged_minimum_still_marks_the_card_dirty", async () => {
  await reset(loud(PAIR));
  await edit("volume_min", "-50");
  assert.ok(cardWords(bar()).includes("dirty"));
});

// --- gating ---------------------------------------------------------------------------------

// The marks ride the bar only while loudness is actually running: matrix engine
// engaged, volume path not bypassed, loudness switch on. Any one of the three
// missing takes both handles and the band off the bar entirely — there is no
// disabled state for them, so each case asserts absence of the class word rather
// than absence of liveness, and a card that merely grayed the marks fails.

test("test_direct_sdm_draws_no_bound_handle", async () => {
  // Direct SDM bypasses the whole volume path, so an adaptive bound has nothing
  // left to adapt to and the marks come off the bar. The fixture is ungated in
  // every other respect — matrix engine engaged, loudness on — so Direct SDM is
  // the sole cause and dropping it draws the handles again (see the neighbouring
  // drawing cases).
  await reset(loud(PAIR), { ...FORM, direct_sdm: "1" });
  assert.equal(bounds(bar()).length, 0);
});

test("test_direct_sdm_draws_no_band", async () => {
  await reset(loud(PAIR), { ...FORM, direct_sdm: "1" });
  assert.equal(lanes(bar()).length, 0);
});

test("test_a_bypassed_matrix_engine_draws_no_bound_handle", async () => {
  // loudness compensation is a plugin inside the matrix chain
  // (hqplayerd-readme.txt §1.11.2), so a matrix switched out of circuit stops it
  // running and the marks are absent. Loudness itself is on and the volume
  // control is live here, so the bypass is the sole cause.
  await reset(loud({ engine: false, ...PAIR }));
  assert.equal(bounds(bar()).length, 0);
});

test("test_a_bypassed_matrix_engine_draws_no_band", async () => {
  await reset(loud({ engine: false, ...PAIR }));
  assert.equal(lanes(bar()).length, 0);
});

test("test_an_ungated_card_leaves_both_bound_handles_live", async () => {
  // matrix engine engaged, loudness on, no volume bypass: nothing to gray
  await reset(loud(PAIR));
  assert.equal(bounds(bar()).filter(isDisabled).length, 0);
});

test("test_a_bypassed_matrix_engine_leaves_the_volume_handles_live", async () => {
  // gray is not shared: the bounds live inside the matrix chain and gray with
  // it, while Min, Startup and Max configure the volume control itself and are
  // untouched by a matrix switched out of circuit
  await reset(loud({ engine: false }));
  assert.equal(volumeHandles(bar()).filter((t) => !isDisabled(t)).length, 3);
});

// --- the legend ------------------------------------------------------------------------------

test("test_enabled_loudness_names_the_loudness_range_in_the_legend", async () => {
  await reset(loud(PAIR));
  assert.equal(tagged(bar(), "vr-loud-legend").length, 1);
});

test("test_the_loudness_legend_entry_reads_loudness_bounds", async () => {
  await reset(loud(PAIR));
  assert.equal(innerText(bar(), "vr-loud-legend"), "Loudness bounds");
});

test("test_disabled_loudness_draws_no_loudness_legend_entry", async () => {
  await reset(loud({ enabled: false, ...PAIR }));
  assert.equal(tagged(bar(), "vr-loud-legend").length, 0);
});

// --- the number boxes stay three ---------------------------------------------------------------

test("test_the_bound_handles_bring_no_number_box_of_their_own", async () => {
  // the two /matrix number fields stay on the Loudness card; this card still
  // shows Min, Startup and Max and nothing else
  await reset(loud(PAIR));
  assert.equal(numberBoxes(bar()).length, 3);
});
