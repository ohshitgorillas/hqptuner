// Rendered suite for hqptuner/static/components/faceplate/Volume.js: the engine row's − / readout / + cluster and the
// slider popover the readout opens. The level, range and pins themselves are store/faceplate/volume.js's, pinned in
// tests/js/store/faceplate/volume.test.js; this suite pins what the cluster does with them: a held − or + repeats on
// the clock it is handed, the controls gray while the level is pinned or at a bound, and the popover's slider, scale
// and loudness marks sit along the range.
//
// The hold runs on a fake Clock: time moves only when a case advances it, so nothing waits on the wall. The buttons'
// handlers are reached through preact's own `options.vnode` hook (tests/js/support/vnodeseam.js), and each write rides
// the real `POST /api/volume`, answered by a fake echoing the level it set.
//
// Not reachable here: the slider's own input, which `userEdit` honors only with a pointer or a keystroke on it that a
// document listener saw (server rendering has no document); the popover's parking and the slider's focus on opening,
// which run in a layout effect; and the popover closing when the level becomes pinned, which runs in an effect. A
// browser run closes these.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/volume.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Volume, VolumePopover } from "../../../../hqptuner/static/components/faceplate/Volume.js";
import { openPopover } from "../../../../hqptuner/static/store/faceplate/view.js";
import { config, matrixConfig, volume, volumeDrag, volumeRange } from "../../../../hqptuner/static/store/signals.js";
import { renderTree } from "../../support/vnodeseam.js";
import { propsOf } from "../../support/wheel.js";
import { elements, attr, classes, hasAttr, text } from "../../support/markup.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";
import { fakeClock } from "../../support/clock.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

/**
 * @typedef {object} Level
 * @property {string} [at]        the engine's reported level, dB
 * @property {string} [min]       the bottom of the range the engine reports, dB
 * @property {string} [max]       the top of it
 * @property {boolean} [direct]   running direct_sdm
 * @property {boolean} [loudness] running matrix engine and loudness both
 */

/** @param {Level} l */
function play({ at = "-12.5", min = "-60", max = "0", direct = false, loudness = false }) {
  volume.value = at;
  volumeDrag.value = null;
  volumeRange.value = { enabled: "1", min, max };
  config.value = { fields: [{ name: "direct_sdm", value: direct }], file: {} };
  matrixConfig.value = {
    fields: [
      { name: "enabled", value: loudness },
      { name: "post_loudness_enabled", value: loudness },
      { name: "post_loudness_rangelow", value: "-45" },
      { name: "post_loudness_rangehigh", value: "-15" },
    ],
  };
  openPopover.value = null;
}

/**
 * The levels written by one gesture on a ± button: pressed for `holdFor` ms then released (its trailing click
 * included), or with `holdFor` null a click alone, as a keyboard delivers one. The clock runs on well past the
 * release, so a repeat the release failed to stop shows up as extra writes.
 *
 * @param {string} id  the button's data-testid
 * @param {number | null} holdFor
 * @param {Level} [l]
 */
async function gesture(id, holdFor, l = {}) {
  play(l);
  const { clock, advance } = fakeClock();
  const { seen } = renderTree(html`<${Volume} clock=${clock} />`);
  const w = stagingWire({
    routes: (path, opts, x) => {
      if (path !== "/api/volume" || opts.method !== "POST") return undefined;
      const body = JSON.parse(String(opts.body));
      x.posts.push(body);
      return ok({ volume: body.level });
    },
  });
  const node = seen.find((v) => propsOf(v)["data-testid"] === id);
  const on = (/** @type {string} */ name) => {
    const fn = node ? propsOf(node)[name] : undefined;
    if (typeof fn === "function") fn({});
  };
  if (holdFor !== null) {
    on("onPointerDown");
    advance(holdFor);
    on("onPointerUp");
  }
  on("onClick");
  advance(2000);
  await quiesce(w);
  return w.posts.map((p) => /** @type {{ level: string }} */ (p).level);
}

/**
 * Every element of one render of the cluster and the popover.
 *
 * @param {Level} l
 */
function drawn(l) {
  play(l);
  return elements(render(html`<${Volume} /><${VolumePopover} />`));
}

/**
 * The first element carrying an attribute value, or one whose class list holds `cls`.
 *
 * @param {MarkupElement[]} all
 * @param {{ attr?: [string, string], cls?: string, not?: string }} by
 */
const find = (all, by) =>
  all.find(
    (e) =>
      (!by.attr || attr(e, by.attr[0]) === by.attr[1]) &&
      (!by.cls || classes(e).includes(by.cls)) &&
      (!by.not || e.name !== by.not),
  );

/** @param {MarkupElement | undefined} e @param {string} name */
const has = (e, name) => (e ? hasAttr(e, name) : undefined);

/** @param {MarkupElement[]} all @param {string} id */
const disabled = (all, id) => has(find(all, { attr: ["data-testid", id] }), "disabled");

/** The readout: the button that opens the popover. @param {MarkupElement[]} all */
const readout = (all) => find(all, { attr: ["data-pop", "volume"], not: "div" });

/** The popover panel. @param {MarkupElement[]} all */
const panel = (all) => all.find((e) => e.name === "div" && attr(e, "data-pop") === "volume");

/** The range slider. @param {MarkupElement[]} all */
const slider = (all) => all.find((e) => e.name === "input" && attr(e, "type") === "range");

/**
 * The scale marks' places along the slider, percent.
 *
 * @param {Level} l
 */
function marks(l) {
  const scale = find(drawn(l), { cls: "scale" });
  const spans = scale ? elements(scale.html).filter((e) => e.name === "span") : [];
  return spans.map((e) => Number((/left:\s*(-?[\d.]+)%/.exec(attr(e, "style") || "") || [])[1]));
}

/**
 * The loudness marks' box, whether it is hidden, and its strip's place and width along the slider.
 *
 * @param {Level} l
 */
function loudMarks(l) {
  const all = drawn(l);
  const box = find(all, { cls: "lmk" });
  const band = find(all, { cls: "lband" });
  const style = (band && attr(band, "style")) || "";
  const pct = (/** @type {string} */ k) => Number((new RegExp(`${k}:\\s*(-?[\\d.]+)%`).exec(style) || [])[1]);
  return { hidden: has(box, "hidden"), band: [pct("left"), pct("width")] };
}

const LOUD = { loudness: true };

// --- the hold ----------------------------------------------------------------------------------------------------

test("test_a_held_minus_steps_down_each_repeat_after_the_delay_and_stops_on_release", async () => {
  assert.deepEqual(await gesture("volume-down", 610), ["-13", "-13.5", "-14"]);
});

test("test_a_press_released_before_the_delay_steps_once", async () => {
  assert.deepEqual(await gesture("volume-down", 399), ["-13"]);
});

test("test_a_click_with_no_press_steps_up_once", async () => {
  assert.deepEqual(await gesture("volume-up", null), ["-12"]);
});

// --- the cluster -------------------------------------------------------------------------------------------------

test("test_a_pinned_level_disables_the_step_down", () => {
  assert.equal(disabled(drawn({ direct: true }), "volume-down"), true);
});

test("test_a_pinned_level_disables_the_step_up", () => {
  assert.equal(disabled(drawn({ direct: true }), "volume-up"), true);
});

test("test_the_bottom_of_the_range_disables_the_step_down", () => {
  const all = drawn({ at: "-60" });
  assert.equal(disabled(all, "volume-down"), true);
});

test("test_a_pinned_level_disables_the_readout", () => {
  assert.equal(has(readout(drawn({ direct: true })), "disabled"), true);
});

test("test_the_readout_prints_the_level", () => {
  const r = readout(drawn({ at: "-27.5" }));
  assert.match(r ? text(r) : "", /27\.5/);
});

/** The readout's aria-expanded with `open` as the open popover. @param {string | null} open */
const expanded = (open) => {
  play({});
  openPopover.value = open;
  const r = readout(elements(render(html`<${Volume} />`)));
  return r ? attr(r, "aria-expanded") : undefined;
};

test("test_the_readout_reports_the_popover_closed", () => {
  assert.equal(expanded(null), "false");
});

test("test_the_readout_reports_the_popover_open", () => {
  assert.equal(expanded("volume"), "true");
});

// --- the popover -------------------------------------------------------------------------------------------------

/** Whether the popover panel is hidden with `open` as the open popover. @param {string | null} open */
const hidden = (open) => {
  play({});
  openPopover.value = open;
  return has(panel(elements(render(html`<${VolumePopover} />`))), "hidden");
};

test("test_the_popover_hides_while_closed", () => {
  assert.equal(hidden(null), true);
});

test("test_the_slider_spans_the_range_the_engine_reports", () => {
  const s = slider(drawn({ min: "-40", max: "-3" }));
  assert.deepEqual(s ? [attr(s, "min"), attr(s, "max")] : [], ["-40", "-3"]);
});

test("test_the_slider_sits_at_the_level", () => {
  const s = slider(drawn({ at: "-27.5" }));
  assert.equal(s ? attr(s, "value") : undefined, "-27.5");
});

test("test_a_pinned_level_disables_the_slider", () => {
  assert.equal(has(slider(drawn({ direct: true })), "disabled"), true);
});

test("test_the_scale_ends_at_the_top_of_a_full_range", () => {
  const at = marks({});
  assert.equal(at[at.length - 1], 100);
});

test("test_the_loudness_strip_spans_its_bounds_along_the_range", () => {
  assert.deepEqual(loudMarks(LOUD).band, [25, 50]);
});

test("test_loudness_off_hides_its_marks", () => {
  assert.equal(loudMarks({}).hidden, true);
});

test("test_a_pinned_level_hides_the_loudness_marks", () => {
  assert.equal(loudMarks({ ...LOUD, direct: true }).hidden, true);
});
