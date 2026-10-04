// Rendered suite for hqptuner/static/components/faceplate/page/Conversion.js and ChainPick.js: a Resampling or Shaping
// section's body, the open field's nameplate over the running option, every other field folded to a line naming what
// it runs, and the open field's copy beside it. A nameplate's tap opens the option list on its field, and a pick from
// that list is written live.
//
// The wire is the seam: /api/state into `engineState`, the enumerations into `enums`, the Status frame into
// `engineStatus`, the /config form into `config`, the overlay bundle into `metadata`, the window into `viewport`, and a
// pick goes out over a faked `globalThis.fetch` on POST /api/config/live. Nameplates are told apart by `data-key`, the
// catalog key the list request carries.
//
// Taps are reached through preact's own vnode creation hook (tests/js/support/vnodeseam.js), since server rendering
// fires no events. The copy's fit to the plate and its `see more` popover run in a layout effect against measured
// boxes, which server rendering never runs; a browser hand-back closes that gap.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/conversion.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Conversion } from "../../../../hqptuner/static/components/faceplate/page/Conversion.js";
import {
  config,
  engineState,
  engineStatus,
  enums,
  liveOverride,
  metadata,
  staged,
} from "../../../../hqptuner/static/store/signals.js";
import { plainNames } from "../../../../hqptuner/static/store/ui/prefs.js";
import { openList, viewport } from "../../../../hqptuner/static/store/faceplate/view.js";
import { elements, attr, classes, text } from "../../support/markup.js";
import { renderTree } from "../../support/vnodeseam.js";
import { ok } from "../../support/wire/wire.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/wheel.js").VNode} VNode */

/**
 * The globals the fake wire installs a `fetch` on, viewed as an optional member.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

/**
 * One enumeration item as the daemon sends it.
 *
 * @param {string} name
 * @param {number} i
 */
const item = (name, i) => ({ index: String(i), value: String(200 + i), name });

/**
 * Write one running engine onto the wire-side signals: a source at `rate` playing to a PCM rate, or stopped.
 *
 * @param {{ rate?: string, playing?: boolean }} [r]
 */
function play({ rate = "48000", playing = true } = {}) {
  engineState.value = { state: playing ? "2" : "0", active_chain: "pcm", filter1x: "0", filterNx: "1", shaper: "0" };
  enums.value = { filters: ["minphaseFIR", "sinc-L"].map(item), shapers: ["RPDF", "NS1"].map(item) };
  engineStatus.value = { status: { active_rate: "384000" }, metadata: { samplerate: rate } };
  config.value = { fields: [{ name: "direct_sdm", value: false }] };
  staged.value = { live: {}, http: {} };
  liveOverride.value = {};
  metadata.value = {
    filters: { filters: { minphaseFIR: { description: "fixture-copy" } }, aliases: {} },
    shapers: {},
    settings: {},
    plain_names: {
      filters: {
        entries: { minphaseFIR: { family: "fixture-fam", variant: null, leaf: "fixture-leaf", short: "s" } },
        families: {},
        variants: {},
      },
    },
  };
  plainNames.value = false;
  viewport.value = { w: 1080, h: 810 };
  openList.value = null;
}

// Each case starts from a playback of its own, so no field a case before it opened stays open.
beforeEach(() => {
  play({ playing: false });
  play();
});

/**
 * Every element of one section's rendered body, in document order.
 *
 * @param {"resampling" | "shaping"} section
 */
const bodyEls = (section) =>
  elements(render(html`<div><${Conversion} section=${section} /></div>`)).sort((a, b) => a.start - b.start);

/** The catalog keys of the nameplates one body shows. @param {"resampling" | "shaping"} section */
const plates = (section) =>
  bodyEls(section)
    .filter((e) => e.name === "button" && attr(e, "data-key"))
    .map((e) => attr(e, "data-key"));

/**
 * The text of the first element inside Resampling's body carrying a class, or a string naming the class when none does.
 *
 * @param {string} cls
 * @returns {string}
 */
function textOf(cls) {
  const found = bodyEls("resampling").find((e) => classes(e).includes(cls));
  return found ? text(found) : `no .${cls}`;
}

/**
 * Whether Resampling's open nameplate is dimmed, or a string saying there is none, so a missing nameplate never reads as
 * a lit one.
 *
 * @returns {boolean | string}
 */
const plateDim = () => {
  const found = bodyEls("resampling").find((e) => e.name === "button" && attr(e, "data-key"));
  return found ? classes(found).includes("dim") : "no nameplate";
};

/**
 * Fire the tap of the first button in Resampling's body a predicate picks.
 *
 * @param {(v: VNode) => boolean} pick
 */
function tap(pick) {
  const { seen } = renderTree(html`<${Conversion} section="resampling" />`);
  const hit = seen.find((/** @type {VNode} */ v) => v.type === "button" && pick(v));
  const onClick = hit?.props.onClick;
  if (typeof onClick === "function") onClick();
}

/** Tap Resampling's open nameplate. */
const tapPlate = () => tap((v) => Boolean(v.props["data-key"]));

// --- the open field -------------------------------------------------------------------------

test("test_resampling_shows_one_nameplate_on_the_open_filter", () => {
  assert.deepEqual(plates("resampling"), ["pcm_filter_1x"]);
});

test("test_a_high_rate_source_shows_the_nameplate_on_the_nx_filter", () => {
  play({ rate: "192000" });
  assert.deepEqual(plates("resampling"), ["pcm_filter_nx"]);
});

test("test_a_plate_tall_enough_shows_both_filters_nameplates", () => {
  viewport.value = { w: 1366, h: 1024 };
  assert.deepEqual(plates("resampling"), ["pcm_filter_1x", "pcm_filter_nx"]);
});

test("test_shaping_shows_the_shapers_nameplate", () => {
  assert.deepEqual(plates("shaping"), ["pcm_dither"]);
});

test("test_the_nameplate_names_the_running_option_by_its_engine_name_under_standard", () => {
  assert.equal(textOf("cpl"), "minphaseFIR");
});

test("test_the_nameplate_names_the_running_option_by_its_plain_leaf_under_simplified", () => {
  plainNames.value = true;
  assert.equal(textOf("cpl"), "fixture-leaf");
});

test("test_the_nameplate_names_the_running_options_plain_family", () => {
  plainNames.value = true;
  assert.equal(textOf("cpfam"), "fixture-fam");
});

test("test_a_field_the_path_runs_has_a_lit_nameplate", () => {
  assert.equal(plateDim(), false);
});

test("test_the_nameplate_names_the_list_it_opens_for_the_panel_to_park_at", () => {
  const lists = bodyEls("resampling")
    .filter((e) => e.name === "button" && attr(e, "data-key"))
    .map((e) => attr(e, "data-list"));
  assert.deepEqual(lists, plates("resampling"));
});

test("test_a_field_the_path_does_not_run_has_a_dimmed_nameplate", () => {
  play({ playing: false });
  assert.equal(plateDim(), true);
});

// --- the copy and the folded line -----------------------------------------------------------

test("test_the_copy_names_the_running_option_by_its_engine_name", () => {
  assert.equal(textOf("man").split(/\s+/)[0], "minphaseFIR");
});

test("test_the_copy_carries_the_running_options_prose", () => {
  assert.match(textOf("man"), /fixture-copy/);
});

test("test_the_folded_filter_reads_the_engine_name_it_runs", () => {
  assert.equal(textOf("fn"), "sinc-L");
});

test("test_tapping_the_folded_filter_opens_it", () => {
  tap((v) => v.props["data-key"] === undefined && v.props.class === "fline");
  assert.deepEqual(plates("resampling"), ["pcm_filter_nx"]);
});

// --- the option list ---------------------------------------------------------------------

test("test_tapping_the_nameplate_opens_the_list_on_its_field", () => {
  tapPlate();
  assert.equal(openList.value?.key, "pcm_filter_1x");
});

test("test_the_list_opens_on_the_running_option", () => {
  tapPlate();
  assert.equal(openList.value?.value, "minphaseFIR");
});

test("test_the_nx_filters_list_narrows_on_the_nx_stage", () => {
  play({ rate: "192000" });
  tapPlate();
  assert.equal(openList.value?.stage, "nx");
});

test("test_a_pick_from_the_list_writes_its_enum_id_live", async () => {
  /** @type {unknown[]} */
  const posts = [];
  env.fetch = async (/** @type {string} */ path, /** @type {{ body?: string }} */ opts = {}) => {
    if (path === "/api/config/live") posts.push(JSON.parse(String(opts.body)));
    if (path === "/api/state") return ok({ data: { ...engineState.value } });
    if (path === "/api/enumerations") return ok({ data: { ...enums.value } });
    return ok({ report: { live: [], stored: {} } });
  };
  tapPlate();
  await openList.value?.pick("sinc-L");
  assert.deepEqual(posts, [{ fields: { filter1x: "201" } }]);
});
