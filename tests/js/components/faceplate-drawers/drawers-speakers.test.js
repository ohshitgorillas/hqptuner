// Rendered suite for hqptuner/static/components/faceplate/drawers/Speakers.js: the Speakers drawer's block. The draft,
// the set and the dead levels are store/faceplate/drawers/speakers.js's, pinned in
// tests/js/store/faceplate/drawers-speakers.test.js; this suite pins what the block draws from them: one row of two
// boxes per channel of the picked set, holding the draft's values and writing back to it, the room plan with a speaker
// per shown channel at its drafted distance, none for a channel with no distance or level drafted, the level boxes disabled with the Direct SDM line under the rows while the
// running Direct SDM is on, every control disabled while an apply is in flight, and no restart mark on the set's head,
// since the set is a browser preference that never stages.
//
// The wire is the seam: each case writes the daemon's /speakers form into `speakers` and the running direct_sdm into
// `config`. A box's change handler is reached through preact's own `options.vnode` hook
// (tests/js/support/vnodeseam.js). A channel row is found by its `sprow` class, the set's head as the smallest element
// enclosing the set select, which is found by its option values, the set ids; the restart mark by its test handle, its
// `data-testid`.
//
// Not reachable here: the form's first read, which runs in an effect that server rendering never fires. A browser run
// closes it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-speakers.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { SpeakersBody } from "../../../../hqptuner/static/components/faceplate/drawers/Speakers.js";
import { SPEAKERS_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/speakers-drawer.js";
import { config } from "../../../../hqptuner/static/store/signals.js";
import { loadSpeakers } from "../../../../hqptuner/static/store/matrix/speakers.js";
import {
  SETS,
  applyDraft,
  discardDraft,
  pickSpeakerSet,
  setChannelDistance,
  setChannelLevel,
  speakerDraft,
} from "../../../../hqptuner/static/store/faceplate/drawers/speakers.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, classes, elements, hasAttr } from "../../support/markup.js";
import { ok, stagingWire } from "../../support/wire/wire.js";

/** @typedef {import("../../support/wheel.js").VNode} VNode */
/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

const LABELS = ["Left", "Right", "Center", "LFE", "Left rear", "Right rear", "Left side", "Right side"];
const DISTANCES = [287, 301, 280, 330, 240, 241, 210, 211];
//: HQPlayer's stock distance, meaning not set.
const UNSET_CM = 0;
//: A level someone entered.
const SET_DB = -3;

/**
 * The daemon's /speakers form with these distances and every level at HQPlayer's stock 0.
 *
 * @param {number[]} distances
 */
const formAt = (distances) => ({
  enabled: true,
  channels: LABELS.map((label, index) => ({
    index,
    label,
    level: 0,
    distance: distances[index],
    level_min: -60,
    level_max: 0,
    level_step: 0.1,
    distance_min: 0,
    distance_max: 5000,
  })),
});

const FORM = formAt(DISTANCES);
const UNSET_FORM = formAt(LABELS.map(() => UNSET_CM));

const FIRST = SETS[0];
const LAST = SETS[SETS.length - 1];
//: The drawer schema the block sits in; its own form is what the restart mark derives from.
const SCHEMA = SPEAKERS_DRAWER;

/** The restart mark's test handle, shared by every surface that carries it. */
const MARK = "restart-mark";

/** @param {MarkupElement} e  whether the element is a restart mark */
const isMark = (e) => attr(e, "data-testid") === MARK;

/** @param {{ direct?: boolean, form?: ReturnType<typeof formAt> }} [s] */
async function reset({ direct = false, form = FORM } = {}) {
  stagingWire({ routes: (path) => (path === "/api/speakers" ? ok({ data: form }) : undefined) });
  await loadSpeakers();
  config.value = { fields: [{ name: "direct_sdm", value: direct }], file: {} };
  discardDraft();
  pickSpeakerSet(FIRST.id);
}

const draw = () => renderTree(html`<${SpeakersBody} schema=${SCHEMA} />`);
const all = () => elements(draw().out);

/**
 * The elements of a render carrying a class.
 *
 * @param {string} cls
 */
const withClass = (cls) => all().filter((e) => classes(e).includes(cls));

/**
 * Each shown row's number boxes.
 *
 * @returns {MarkupElement[][]}
 */
const rowBoxes = () =>
  withClass("sprow").map((row) => elements(row.html).filter((e) => e.name === "input" && attr(e, "type") === "number"));

/** Each speaker group on the plan, as its placed glyph's transform. */
const spots = () =>
  withClass("spk").map((g) =>
    attr(elements(g.html).find((e) => e.name === "g" && hasAttr(e, "transform")) ?? g, "transform"),
  );

// --- the rows ----------------------------------------------------------------------------------------------------

/**
 * Call a vnode prop when it is a handler.
 *
 * @param {unknown} fn
 * @param {...unknown} args
 */
const call = (fn, ...args) => (typeof fn === "function" ? fn(...args) : undefined);

test("test_one_row_is_drawn_per_channel_of_the_first_set", async () => {
  await reset();
  const first = withClass("sprow").length;
  assert.equal(first, FIRST.channels.length);
});

test("test_one_row_is_drawn_per_channel_of_the_last_set", async () => {
  await reset();
  pickSpeakerSet(LAST.id);
  assert.equal(withClass("sprow").length, LAST.channels.length);
});

test("test_a_rows_distance_box_holds_the_drafted_distance", async () => {
  await reset();
  setChannelDistance(1, "350");
  const values = rowBoxes().map((row) => row.map((box) => attr(box, "value")));
  assert.deepEqual(values[1], ["0", "350"]);
});

test("test_a_change_in_a_distance_box_drafts_that_channels_distance", async () => {
  await reset();
  const boxes = draw().seen.filter((v) => v.type === "input" && v.props.type === "number");
  call(boxes[3]?.props.onChange, { currentTarget: { value: "333" } });
  assert.equal(speakerDraft().channels[1]?.distance, 333);
});

test("test_the_set_select_holds_the_picked_set", async () => {
  await reset();
  pickSpeakerSet(LAST.id);
  const picked = all().filter((e) => e.name === "option" && hasAttr(e, "selected"));
  assert.deepEqual(
    picked.map((o) => attr(o, "value")),
    [LAST.id],
  );
});

// --- Direct SDM --------------------------------------------------------------------------------------------------

test("test_under_direct_sdm_each_level_box_is_disabled_and_each_distance_box_is_not", async () => {
  await reset({ direct: true });
  assert.deepEqual(
    rowBoxes().map((row) => row.map((box) => hasAttr(box, "disabled"))),
    FIRST.channels.map(() => [true, false]),
  );
});

test("test_the_direct_sdm_line_shows_while_the_levels_are_dead", async () => {
  await reset({ direct: true });
  assert.equal(withClass("spsdm").length, 1);
});

test("test_the_rows_column_carries_sdm_while_the_levels_are_dead", async () => {
  await reset({ direct: true });
  const on = withClass("spleft").map((e) => classes(e).includes("sdm"));
  assert.deepEqual(on, [true]);
});

test("test_an_apply_in_flight_disables_every_control", async () => {
  await reset();
  /** @type {(response: ReturnType<typeof ok>) => void} */
  let finish = () => {};
  const response = new Promise(
    /** @param {(response: ReturnType<typeof ok>) => void} resolve */ (resolve) => {
      finish = resolve;
    },
  );
  stagingWire({
    routes: (path, opts) => {
      if (path !== "/api/speakers") return undefined;
      return opts.method === "POST" ? response : ok({ data: FORM });
    },
  });
  setChannelDistance(1, "333");
  const applying = applyDraft();
  const busy = all().filter((e) => ["input", "select"].includes(e.name) && hasAttr(e, "disabled")).length;
  finish(ok({ report: { applied: true, speakers: FORM } }));
  await applying;
  assert.equal(busy, FIRST.channels.length * 2 + 1);
});

// --- the restart mark -------------------------------------------------------------------------------------------

/**
 * Whether `inner` lies inside `outer`.
 *
 * @param {MarkupElement} inner
 * @param {MarkupElement} outer
 */
const within = (inner, outer) =>
  inner.start >= outer.start && inner.start + inner.html.length <= outer.start + outer.html.length;

/** @param {MarkupElement} el  whether the element's markup holds the restart mark */
const holdsMark = (el) => elements(el.html).some(isMark);

/**
 * Whether the head around the set select carries the restart mark, or null when no set select is drawn.
 *
 * @returns {boolean | null}
 */
function setHeadMarked() {
  const drawn = all();
  const select = drawn.find(
    (e) => e.name === "select" && elements(e.html).some((o) => o.name === "option" && attr(o, "value") === FIRST.id),
  );
  if (!select) return null;
  const head = drawn
    .filter((e) => within(select, e) && e.html.length > select.html.length)
    .sort((a, b) => a.html.length - b.html.length)[0];
  return head ? holdsMark(head) : null;
}

test("test_the_set_head_carries_no_restart_mark", async () => {
  await reset();
  assert.equal(setHeadMarked(), false);
});

// --- the room plan -----------------------------------------------------------------------------------------------

test("test_the_plan_draws_one_speaker_per_channel_of_the_first_set", async () => {
  await reset();
  const first = spots().length;
  assert.equal(first, FIRST.channels.length);
});

test("test_the_plan_draws_one_speaker_per_channel_of_the_last_set", async () => {
  await reset();
  pickSpeakerSet(LAST.id);
  assert.equal(spots().length, LAST.channels.length);
});

test("test_the_plan_draws_no_speaker_while_the_daemon_reports_none_set", async () => {
  await reset({ form: UNSET_FORM });
  assert.equal(spots().length, 0);
});

test("test_a_drafted_level_puts_its_speaker_on_the_plan", async () => {
  await reset({ form: UNSET_FORM });
  setChannelLevel(1, SET_DB);
  assert.equal(spots().length, 1);
});
