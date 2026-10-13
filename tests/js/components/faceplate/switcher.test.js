// Rendered suite for hqptuner/static/components/faceplate/bottom/Switcher.js, the Setting Switcher bar at the foot of
// the plate. What each target shows, which slot runs and what a slot sends are store/faceplate/bottom/switcher.js's,
// pinned in tests/js/store/faceplate/switcher.test.js; this suite pins how the bar draws them: the target select over
// the targets, two radio slots each with its ▾, Output mode's fixed faces, Matrix profile's menu, and the volume bar
// that stands in for the slots under Volume.
//
// Driven at the wire, as the store suite is: the engine's enumerations, State and /config form come from
// tests/js/support/listsfixture.js (SDM chain loaded, Simplified names on), the /matrix form goes into `matrixConfig`,
// the level into the volume signals, and a fetch fake answers the real REST paths and records every request body. Taps
// and keys are fired through the renderer's vnode seam, since render-to-string fires no events. Every engine and
// profile name asserted is the fixture's own.
//
// Not reachable here: focus following the live pick when an arrow key moves it, which needs DOM nodes server rendering
// never builds. A browser run closes that gap.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate/switcher.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { useStorage } from "../../support/storage.js";
import { ok } from "../../support/wire/wire.js";
import { elements, attr, classes, hasAttr, text } from "../../support/markup.js";
import { renderTree } from "../../support/vnodeseam.js";
import { propsOf } from "../../support/wheel.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */

useStorage();

const { html } = await import("../../../../hqptuner/static/lib/dom.js");
const { config, engineState, engineStatus, enums, matrixConfig, volume, volumeDrag, volumeRange } =
  await import("../../../../hqptuner/static/store/signals.js");
const { setBottomBar, setPlainNames } = await import("../../../../hqptuner/static/store/ui/prefs.js");
const { openList } = await import("../../../../hqptuner/static/store/faceplate/view.js");
const { loadLists, resetLists } = await import("../../support/listsfixture.js");
const { setSwitcherTarget, switcherView, setSlot } =
  await import("../../../../hqptuner/static/store/faceplate/bottom/switcher.js");
const { Switcher } = await import("../../../../hqptuner/static/components/faceplate/bottom/Switcher.js");

const ALL = ["1x filter", "Nx filter", "Modulator", "Matrix profile", "Output mode", "Volume"];

/** @type {{ fetch?: unknown }} */
const env = globalThis;

/** @type {{ path: string, body: unknown }[]} */
let posts = [];

/** @type {Record<string, () => unknown>} */
const READS = {
  "/api/state": () => ok({ data: { ...engineState.value } }),
  "/api/enumerations": () => ok({ data: { ...enums.value } }),
  "/api/config": () => ok({ data: { ...config.value } }),
  "/api/matrix": () => ok({ data: { ...matrixConfig.value } }),
  "/api/config/pending": () => ok({ live: {}, http: {} }),
};

/**
 * The answer to one request, each body recorded first.
 *
 * @param {string} path
 * @param {{ body?: string }} [opts]
 */
async function answer(path, opts = {}) {
  if (opts.body) posts.push({ path, body: JSON.parse(opts.body) });
  if (path === "/api/config/live") return ok({ report: { live: [], stored: {} } });
  if (path === "/api/matrix/profile") return ok({ ok: true });
  if (path === "/api/volume") return ok({ volume: "-27.5" });
  return READS[path] ? READS[path]() : ok({});
}

/** The bodies posted to one path. @param {string} path */
const sent = (path) => posts.filter((p) => p.path === path).map((p) => p.body);

/** The wire's requests handed over and not yet answered. */
const wire = { inflight: new Set() };

/**
 * One request answered as `answer` answers it, kept in `wire.inflight` until it is.
 *
 * @param {string} path
 * @param {{ body?: string }} [opts]
 */
function tracked(path, opts) {
  const req = answer(path, opts);
  wire.inflight.add(req);
  req.then(
    () => wire.inflight.delete(req),
    () => wire.inflight.delete(req),
  );
  return req;
}

beforeEach(() => {
  useStorage();
  env.fetch = tracked;
  loadLists({ chain: "sdm", plain: true });
  resetLists();
  matrixConfig.value = { fields: [], rows: [], live_profiles: ["Desk", "Lounge"], live_active: "Lounge" };
  volume.value = "-27.5";
  volumeDrag.value = null;
  volumeRange.value = { enabled: "1", min: "-60", max: "0" };
  setBottomBar("switcher");
  for (const t of ALL) {
    setSwitcherTarget(t);
    setSlot(0, "");
    setSlot(1, "");
  }
  setSwitcherTarget("Modulator");
  setSlot(0, "ASDM7EC 512+fs");
  setSlot(1, "ASDM5");
  posts = [];
});

// --- markup ------------------------------------------------------------------------------------------------------

/** Every element of one render of the bar. */
const drawn = () => elements(render(html`<${Switcher} />`));

/**
 * Whether an element is a `name` carrying every class in `cls`.
 *
 * @param {MarkupElement} e
 * @param {string} name
 * @param {string[]} cls
 */
const isA = (e, name, cls) => e.name === name && cls.every((c) => classes(e).includes(c));

/**
 * Every element of a list that is a `name` with the classes in `cls`.
 *
 * @param {MarkupElement[]} all
 * @param {string} name
 * @param {...string} cls
 */
const every = (all, name, ...cls) => all.filter((e) => isA(e, name, cls));

/**
 * The elements inside `e`, `e` itself left out; none when `e` is missing.
 *
 * @param {MarkupElement | undefined} e
 */
const inside = (e) => (e ? elements(e.html).slice(0, -1) : []);

/**
 * The elements directly inside `e`.
 *
 * @param {MarkupElement | undefined} e
 */
const kids = (e) => {
  const all = inside(e);
  return all.filter(
    (k) => !all.some((o) => o !== k && o.start <= k.start && o.start + o.html.length >= k.start + k.html.length),
  );
};

/** The two slots of the bar, as `div.slots > div.slot`. */
const slots = () => kids(every(drawn(), "div", "slots")[0]).filter((e) => isA(e, "div", ["slot"]));

// --- taps --------------------------------------------------------------------------------------------------------

/** A vnode's classes. @param {VNode} v */
const vcls = (v) => String(propsOf(v).class ?? propsOf(v).className ?? "").split(/\s+/);

/**
 * The vnodes of one render that are a `name` carrying class `cls`, in document order.
 *
 * @param {string} name
 * @param {string} cls
 */
const controls = (name, cls) =>
  renderTree(html`<${Switcher} />`).seen.filter((v) => v.type === name && vcls(v).includes(cls));

/**
 * Fire one handler of a vnode, if it carries it.
 *
 * @param {VNode | undefined} v
 * @param {string} handler
 * @param {unknown} [ev]
 */
async function fire(v, handler, ev) {
  const fn = v ? propsOf(v)[handler] : undefined;
  if (typeof fn === "function") await fn(ev);
}

// --- the target --------------------------------------------------------------------------------------------------

/** The target button, `button.vfd` inside `div.target`. @param {MarkupElement[]} all */
const targetButton = (all) => {
  const [bar] = every(all, "div", "switcher");
  const [box] = every(kids(bar), "div", "target");
  return { box, button: every(kids(box), "button", "vfd")[0] };
};

test("test_tapping_the_target_button_opens_its_menu", async () => {
  await fire(controls("button", "vpick")[0], "onClick");
  const { button } = targetButton(drawn());
  assert.equal(button ? attr(button, "aria-expanded") : null, "true");
});

// --- the slots ---------------------------------------------------------------------------------------------------

/** Each slot's body, `button.sbody`. */
const slotBodies = () => slots().map((s) => every(inside(s), "button", "sbody")[0]);

/** Each slot's pick, `button.spick`. */
const slotPicks = () => slots().map((s) => every(inside(s), "button", "spick")[0]);

/**
 * The text of the first element inside `e` carrying class `cls`, or null where none is drawn.
 *
 * @param {MarkupElement | undefined} e
 * @param {string} cls
 */
const classText = (e, cls) => {
  const hit = inside(e).find((k) => classes(k).includes(cls));
  return hit ? text(hit) : null;
};

test("test_the_slots_group_is_a_radiogroup", () => {
  const [group] = every(drawn(), "div", "slots");
  assert.equal(group ? attr(group, "role") : null, "radiogroup");
});

test("test_the_slots_group_carries_an_accessible_name", () => {
  const [group] = every(drawn(), "div", "slots");
  assert.equal(group ? hasAttr(group, "aria-label") : null, true);
});

test("test_each_slot_body_is_a_radio", () => {
  assert.deepEqual(
    slotBodies().map((b) => b && attr(b, "role")),
    ["radio", "radio"],
  );
});

const CD = "44100";
const DSD256 = "11289600";

test("test_only_the_running_slot_is_marked_on", () => {
  engineStatus.value = { status: { state: "2", active_rate: DSD256 }, metadata: { samplerate: CD } };
  assert.deepEqual(
    slots().map((s) => classes(s).includes("on")),
    [true, false],
  );
});

/** The loaded SDM chain's running Nx filter, the fixture's own. */
const RUNNING_NX = "poly-sinc-gauss-long";

test("test_an_unlit_running_slots_body_is_checked", () => {
  engineStatus.value = { status: { state: "2", active_rate: DSD256 }, metadata: { samplerate: CD } };
  setSwitcherTarget("Nx filter");
  setSlot(0, RUNNING_NX);
  const [body] = slotBodies();
  assert.equal(body ? attr(body, "aria-checked") : null, "true");
});

/** The fixture's plain breakdown of its two modulators, as a slot body draws it. */
const FACES = {
  ASDM5: { variant: "Fifth order", leaf: "Leaf asdm5" },
  "ASDM7EC 512+fs": { variant: "Seventh order", leaf: "Leaf asdm7" },
};

test("test_slot_0_body_draws_its_names_plain_variant", () => {
  setSlot(0, "ASDM5");
  setSlot(1, "ASDM7EC 512+fs");
  assert.equal(classText(slotBodies()[0], "cpvar"), FACES.ASDM5.variant);
});

test("test_slot_1_body_draws_its_names_plain_variant", () => {
  setSlot(0, "ASDM5");
  setSlot(1, "ASDM7EC 512+fs");
  assert.equal(classText(slotBodies()[1], "cpvar"), FACES["ASDM7EC 512+fs"].variant);
});

test("test_slot_0_body_draws_its_names_plain_leaf", () => {
  setSlot(0, "ASDM5");
  setSlot(1, "ASDM7EC 512+fs");
  assert.equal(classText(slotBodies()[0], "cpl"), FACES.ASDM5.leaf);
});

test("test_slot_1_body_draws_its_names_plain_leaf", () => {
  setSlot(0, "ASDM5");
  setSlot(1, "ASDM7EC 512+fs");
  assert.equal(classText(slotBodies()[1], "cpl"), FACES["ASDM7EC 512+fs"].leaf);
});

/** A fixture modulator with no rate floor, so its face carries no tier badge. */
const UNTIERED = "ASDM5";

test("test_under_standard_a_slot_body_reads_its_engine_name_alone", () => {
  setPlainNames(false);
  setSlot(0, UNTIERED);
  const [body] = slotBodies();
  assert.equal(body ? text(body) : null, UNTIERED);
});

test("test_each_slot_pick_names_its_own_slot", () => {
  assert.equal(new Set(slotPicks().map((p) => p && attr(p, "aria-label"))).size, 2);
});

test("test_each_slot_pick_opens_a_dialog", () => {
  assert.deepEqual(
    slotPicks().map((p) => p && attr(p, "aria-haspopup")),
    ["dialog", "dialog"],
  );
});

test("test_tapping_a_slot_body_sends_that_slot_live", async () => {
  await fire(controls("button", "sbody")[1], "onClick");
  assert.deepEqual(sent("/api/config/live"), [{ fields: { modulator: "0" } }]);
});

test("test_tapping_a_slot_pick_opens_that_slots_list", async () => {
  await fire(controls("button", "spick")[1], "onClick");
  assert.equal(openList.value?.value, "ASDM5");
});

test("test_a_list_slots_pick_is_the_picker_of_its_key_and_the_list_parks_at_it", async () => {
  await fire(controls("button", "spick")[1], "onClick");
  const picks = slots().map((s) => every(inside(s), "button", "spick")[0]);
  assert.deepEqual(
    picks.map((p) => [p && attr(p, "data-list"), p && attr(p, "id") === openList.value?.anchor]),
    [
      ["sdm_modulator", false],
      ["sdm_modulator", true],
    ],
  );
});

// --- matrix profile ----------------------------------------------------------------------------------------------

test("test_under_matrix_profile_a_menu_row_remembers_its_profile_in_that_slot", async () => {
  setSwitcherTarget("Matrix profile");
  await fire(controls("button", "spick")[1], "onClick");
  const row = controls("button", "pmrow").find((v) => {
    const children = propsOf(v).children;
    return [children].flat(Infinity).some((c) => typeof c === "string" && c.trim() === "Desk");
  });
  await fire(row, "onClick");
  assert.equal(switcherView()?.slots[1]?.name, "Desk");
});
