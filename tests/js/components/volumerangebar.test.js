// Behavioral suite for components/volume/RangeBar.js — the Min / Startup / Max
// range card. Written BEFORE the complexity refactor of VolumeRangeBar (11) and
// the extraction of its clamp policy into lib/volume.js; not one case may change
// when either lands.
//
// Policy (docs/testing.md): public API only, one assertion per test. The
// component exports only itself, so every case here reads the rendered card —
// handle positions, the filled span, the gridlines, the gray/dirty state and the
// number-box bounds — never an internal.
//
// NOT REACHABLE from a policy-compliant test, and deliberately left uncovered:
//   * the module-private `active` signal and the `.vr-bubble` it renders. It is
//     written only by the handles' onInput/onPointer*/onMouse*/onBlur handlers,
//     which server-side rendering never fires. Exporting it purely to test it
//     would be reaching into an internal, so the bubble's rendered branch is
//     covered on its null side only.
//   * the clamping applied by those same handlers. That policy is pure and now
//     lives in lib/volume.js, where tests/js/volume.test.js exercises it
//     directly — see the note there.
//
// State reset is total on every call: module-level signals outlive a test.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/volumerangebar.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { VolumeRangeBar } from "../../../hqptuner/static/components/volume/RangeBar.js";
import { config, enums, engineState, matrixConfig } from "../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../hqptuner/static/store/actions.js";
import { ok, stagingWire } from "../support/wire.js";

// Fake wire (docs/testing.md rule 4): a real pending buffer over the real REST
// paths, so `edit()` stages exactly as it does against the backend.
function wire() {
  stagingWire({ fallback: (w) => ok(w.staged) });
}

// Keys are the daemon's own /config FORM field names (startup volume is
// defaults_volume); an omitted key is a field the form never sent.
/**
 * @param {Record<string, string>} [running]
 * @returns {Promise<void>}
 */
async function reset(running = {}) {
  wire();
  enums.value = null;
  engineState.value = {};
  matrixConfig.value = null;
  config.value = { fields: Object.entries(running).map(([name, value]) => ({ name, value })), file: {} };
  await discardAll();
}

const bar = () => render(html`<${VolumeRangeBar} />`);

/** @param {string} out */
const inputs = (out) => [...out.matchAll(/<input[^>]*>/g)].map((m) => m[0]);

// The one handle carrying `vr-<which>`. A missing handle is an error rather than
// nothing, so a case cannot read an attribute off an absent control and report
// that as the attribute's value.
/**
 * @param {string} out
 * @param {string} which
 * @returns {string}
 */
const handle = (out, which) => {
  const tag = inputs(out).find((t) => t.includes(`vr-${which} `));
  if (!tag) throw new Error(`no vr-${which} handle in the rendered card`);
  return tag;
};

/** @param {string} out */
const handles = (out) => inputs(out).filter((t) => t.includes("vr-handle"));
// Render order of the number boxes is Min, Startup, Max — the order the card
// presents them in, which is itself part of the contract.
/** @param {string} out */
const boxes = (out) => inputs(out).filter((t) => t.includes('type="number"'));
const MIN_BOX = 0;
const STARTUP_BOX = 1;
const MAX_BOX = 2;

/**
 * @param {string} tag
 * @param {string} name
 */
const attr = (tag, name) => (new RegExp(`\\b${name}="([^"]*)"`).exec(tag) || [])[1];
// A label carries its edge anchor as a second class word, so match the class as
// a prefix rather than as the whole attribute.
/** @param {string} out */
const labels = (out) => [...out.matchAll(/<span class="vr-tick-label[^"]*"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
/** @param {string} out */
const ariaLabels = (out) => handles(out).map((t) => attr(t, "aria-label"));
/**
 * @param {string} out
 * @param {string} needle
 */
const count = (out, needle) => out.split(needle).length - 1;

// Which handle a tag is, off the class it carries — the card's own machine
// identity for it, unlike the words in its assistive label.
/** @param {string} tag */
const which = (tag) => (/\bvr-(min|startup|max)\b/.exec(tag) || [])[1];

const DEFAULTS = { volume_min: "-60", volume_max: "0", defaults_volume: "-20" };

// --- what each handle reads --------------------------------------------------

test("test_the_min_handle_shows_the_configured_minimum", async () => {
  await reset({ ...DEFAULTS, volume_min: "-45" });
  assert.equal(attr(handle(bar(), "min"), "value"), "-45");
});

test("test_the_max_handle_shows_the_configured_maximum", async () => {
  await reset({ ...DEFAULTS, volume_max: "6" });
  assert.equal(attr(handle(bar(), "max"), "value"), "6");
});

test("test_the_startup_handle_shows_the_configured_startup", async () => {
  await reset({ ...DEFAULTS, defaults_volume: "-30" });
  assert.equal(attr(handle(bar(), "startup"), "value"), "-30");
});

test("test_a_missing_minimum_defaults_to_minus_sixty_dbfs", async () => {
  await reset({ volume_max: "0" });
  assert.equal(attr(handle(bar(), "min"), "value"), "-60");
});

test("test_a_missing_maximum_defaults_to_zero_dbfs", async () => {
  await reset({ volume_min: "-60" });
  assert.equal(attr(handle(bar(), "max"), "value"), "0");
});

test("test_a_missing_startup_falls_back_to_the_minimum", async () => {
  await reset({ volume_min: "-45", volume_max: "0" });
  assert.equal(attr(handle(bar(), "startup"), "value"), "-45");
});

test("test_a_blank_startup_falls_back_to_the_minimum", async () => {
  await reset({ ...DEFAULTS, volume_min: "-45", defaults_volume: "" });
  assert.equal(attr(handle(bar(), "startup"), "value"), "-45");
});

test("test_a_non_numeric_minimum_falls_back_to_the_default", async () => {
  await reset({ ...DEFAULTS, volume_min: "auto" });
  assert.equal(attr(handle(bar(), "min"), "value"), "-60");
});

test("test_a_staged_edit_moves_its_handle", async () => {
  await reset(DEFAULTS);
  await edit("volume_min", "-50");
  assert.equal(attr(handle(bar(), "min"), "value"), "-50");
});

// --- the filled span = the range reachable at runtime ------------------------

test("test_a_minimum_at_the_axis_floor_fills_from_the_left_edge", async () => {
  await reset({ ...DEFAULTS, volume_min: "-120" });
  assert.ok(bar().includes("left:0%"));
});

test("test_a_maximum_at_the_gain_ceiling_fills_to_the_right_edge", async () => {
  await reset({ ...DEFAULTS, volume_max: "12" });
  assert.ok(bar().includes("right:0%"));
});

test("test_a_minimum_at_the_axis_midpoint_fills_from_halfway", async () => {
  await reset({ ...DEFAULTS, volume_min: "-54" });
  assert.ok(bar().includes("left:50%"));
});

// --- the shared dBFS axis ----------------------------------------------------

test("test_every_gridline_is_drawn", async () => {
  // one every 10 dB from -120 through 0, plus +12 and -3; the positions are
  // pinned in tests/js/components/volumerangebar-axis.test.js
  await reset(DEFAULTS);
  assert.equal(count(bar(), 'class="vr-tick '), 15);
});

test("test_the_limiter_threshold_and_resampling_ceiling_are_drawn_strong", async () => {
  await reset(DEFAULTS);
  assert.equal(count(bar(), 'class="vr-tick strong"'), 2);
});

test("test_the_limiter_threshold_is_labeled", async () => {
  await reset(DEFAULTS);
  assert.ok(labels(bar()).includes("0"));
});

test("test_the_gain_ceiling_is_labeled", async () => {
  await reset(DEFAULTS);
  assert.ok(labels(bar()).includes("+12"));
});

// --- graying -----------------------------------------------------------------

// The reason the CARD itself carries, read off the section carrying the card's
// own id rather than off the render as a whole: any control inside that gained
// a tooltip of its own would otherwise answer for the card's. Undefined when the
// card offers none — SSR emits an empty reason as a bare `title`.
/** @param {string} out */
const reason = (out) => {
  const tag = /<section[^>]*\sdata-card="volume-range"[^>]*>/.exec(out);
  if (!tag) throw new Error("no volume-range card in the rendered output");
  return attr(tag[0], "title");
};

// WHICH sentence the tooltip carries is the owner's; that a grayed card carries
// one at all, and that the reason follows the state that grayed it, is the
// behavior (rule 9). The second half compares two renders against each other, so
// no wording is pinned: a card handing out one reason whatever the cause fails.
test("test_direct_sdm_carries_a_reason_on_the_card", async () => {
  await reset({ ...DEFAULTS, direct_sdm: "1" });
  const direct = reason(bar());
  await reset({ ...DEFAULTS, fixed_volume_enabled: "1" });
  const seen = { given: direct !== undefined && direct !== "", follows: direct !== reason(bar()) };
  assert.deepEqual(seen, { given: true, follows: true });
});

test("test_an_ungrayed_card_carries_no_reason", async () => {
  // an empty reason renders as a bare `title` — the card offers no tooltip text
  await reset(DEFAULTS);
  assert.equal(reason(bar()), undefined);
});

test("test_direct_sdm_marks_the_track_disabled", async () => {
  await reset({ ...DEFAULTS, direct_sdm: "1" });
  assert.ok(bar().includes('class="vr-track disabled"'));
});

test("test_direct_sdm_disables_every_handle", async () => {
  await reset({ ...DEFAULTS, direct_sdm: "1" });
  assert.equal(handles(bar()).filter((t) => t.includes("disabled")).length, 3);
});

test("test_an_ungrayed_card_leaves_every_handle_live", async () => {
  await reset(DEFAULTS);
  assert.equal(handles(bar()).filter((t) => t.includes("disabled")).length, 0);
});

test("test_direct_sdm_disables_every_number_box", async () => {
  await reset({ ...DEFAULTS, direct_sdm: "1" });
  assert.equal(boxes(bar()).filter((t) => t.includes("disabled")).length, 3);
});

// --- the dirty highlight -----------------------------------------------------

test("test_an_unstaged_card_is_not_dirty", async () => {
  await reset(DEFAULTS);
  assert.ok(bar().includes('class="card vr-card "'));
});

test("test_a_staged_minimum_marks_the_card_dirty", async () => {
  await reset(DEFAULTS);
  await edit("volume_min", "-50");
  assert.ok(bar().includes('class="card vr-card dirty"'));
});

test("test_a_staged_maximum_marks_the_card_dirty", async () => {
  await reset(DEFAULTS);
  await edit("volume_max", "-3");
  assert.ok(bar().includes('class="card vr-card dirty"'));
});

test("test_a_staged_startup_marks_the_card_dirty", async () => {
  await reset(DEFAULTS);
  await edit("startup_volume", "-30");
  assert.ok(bar().includes('class="card vr-card dirty"'));
});

test("test_a_staged_minimum_marks_the_min_handle_dirty", async () => {
  await reset(DEFAULTS);
  await edit("volume_min", "-50");
  assert.ok(handle(bar(), "min").includes("dirty"));
});

test("test_a_staged_minimum_leaves_the_max_handle_clean", async () => {
  await reset(DEFAULTS);
  await edit("volume_min", "-50");
  assert.equal(handle(bar(), "max").includes("dirty"), false);
});

test("test_a_staged_minimum_marks_its_own_number_box_dirty", async () => {
  await reset(DEFAULTS);
  await edit("volume_min", "-50");
  assert.equal(count(bar(), 'class="vr-box dirty"'), 1);
});

// --- the number boxes' own bounds --------------------------------------------

test("test_the_min_box_reaches_the_axis_floor", async () => {
  await reset(DEFAULTS);
  assert.equal(attr(boxes(bar())[MIN_BOX], "min"), "-120");
});

test("test_the_min_box_cannot_be_raised_above_zero_dbfs", async () => {
  await reset(DEFAULTS);
  assert.equal(attr(boxes(bar())[MIN_BOX], "max"), "0");
});

test("test_the_startup_box_is_bounded_below_by_the_minimum", async () => {
  await reset({ ...DEFAULTS, volume_min: "-45" });
  assert.equal(attr(boxes(bar())[STARTUP_BOX], "min"), "-45");
});

test("test_the_startup_box_is_bounded_above_by_the_maximum", async () => {
  await reset({ ...DEFAULTS, volume_max: "-6" });
  assert.equal(attr(boxes(bar())[STARTUP_BOX], "max"), "-6");
});

test("test_the_max_box_reaches_the_gain_ceiling", async () => {
  await reset(DEFAULTS);
  assert.equal(attr(boxes(bar())[MAX_BOX], "max"), "12");
});

// --- assistive labeling -----------------------------------------------------

// WHAT the labels say is the owner's wording; that every handle carries one,
// and that the three stand in axis order, is the contract (rule 9).

test("test_every_handle_carries_an_assistive_label", async () => {
  await reset(DEFAULTS);
  assert.equal(ariaLabels(bar()).filter((l) => l && l.length > 0).length, 3);
});

test("test_the_three_handles_stand_in_axis_order", async () => {
  await reset(DEFAULTS);
  assert.deepEqual(handles(bar()).map(which), ["min", "startup", "max"]);
});
