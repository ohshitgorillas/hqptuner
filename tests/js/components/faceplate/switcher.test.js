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
import { ok, quiesce } from "../../support/wire/wire.js";
import { elements, attr, classes, hasAttr, text } from "../../support/markup.js";
import { renderTree } from "../../support/vnodeseam.js";
import { propsOf } from "../../support/wheel.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/vnodeseam.js").VNode} VNode */

useStorage();

const { html } = await import("../../../../hqptuner/static/lib/dom.js");
const { config, engineState, engineStatus, enums, matrixConfig, volume, volumeDrag, volumeRange } =
  await import("../../../../hqptuner/static/store/signals.js");
const { setBottomBar } = await import("../../../../hqptuner/static/store/ui/faceplate.js");
const { openList } = await import("../../../../hqptuner/static/store/faceplate/view.js");
const { volumeNow } = await import("../../../../hqptuner/static/store/faceplate/volume.js");
const { loadLists, resetLists } = await import("../../support/listsfixture.js");
const { TARGETS, switcherTarget, setSwitcherTarget, switcherView, setSlot, slotList } =
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

/** An element's tag and classes, dotted. @param {MarkupElement} e */
const sig = (e) => [e.name, ...classes(e).filter(Boolean)].join(".");

/** The text of the first `name.cls` inside `e`, or undefined. @param {MarkupElement | undefined} e @param {string} name @param {string} cls */
const textIn = (e, name, cls) => {
  const [hit] = every(inside(e), name, cls);
  return hit ? text(hit) : undefined;
};

/** The two slots of the bar, as `div.slots > div.slot`. */
const slots = () => kids(every(drawn(), "div", "slots")[0]).filter((e) => isA(e, "div", ["slot"]));

/** The menu panels the bar draws that are showing. @param {MarkupElement[]} all */
const openMenus = (all) => all.filter((e) => attr(e, "role") === "menu" && !hasAttr(e, "hidden"));

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

/** A key pressed on a control. @param {string} key */
const keyEvent = (key) => ({ key, preventDefault: () => {} });

// --- the target --------------------------------------------------------------------------------------------------

/** The target button, `button.vfd` inside `div.target`. @param {MarkupElement[]} all */
const targetButton = (all) => {
  const [bar] = every(all, "div", "switcher");
  const [box] = every(kids(bar), "div", "target");
  return { box, button: every(kids(box), "button", "vfd")[0] };
};

test("test_the_target_button_names_the_current_target_over_a_closed_menu_of_the_targets", () => {
  setSwitcherTarget("Nx filter");
  const all = drawn();
  const { box, button } = targetButton(all);
  const [menu] = all.filter(
    (e) => attr(e, "role") === "menu" && attr(e, "data-pop") === (button && attr(button, "data-pop")),
  );
  const rows = every(inside(menu), "button", "pmrow");
  assert.deepEqual(
    {
      eng: every(kids(box), "span", "eng").length,
      label: button && hasAttr(button, "aria-label"),
      popup: button && attr(button, "aria-haspopup"),
      expanded: button && attr(button, "aria-expanded"),
      hidden: menu && hasAttr(menu, "hidden"),
      rows: rows.map((r) => attr(r, "data-target")),
      checked: rows.filter((r) => attr(r, "aria-checked") === "true").map((r) => attr(r, "data-target")),
    },
    { eng: 1, label: true, popup: "menu", expanded: "false", hidden: true, rows: [...TARGETS], checked: ["Nx filter"] },
  );
});

test("test_tapping_the_target_button_opens_its_menu", async () => {
  await fire(controls("button", "vpick")[0], "onClick");
  const all = drawn();
  const { button } = targetButton(all);
  assert.deepEqual([button && attr(button, "aria-expanded"), openMenus(all).length], ["true", 1]);
});

test("test_a_target_menu_row_switches_the_target_and_closes_the_menu", async () => {
  await fire(controls("button", "vpick")[0], "onClick");
  const row = controls("button", "pmrow").find((v) => propsOf(v)["data-target"] === "Volume");
  await fire(row, "onClick");
  assert.deepEqual([switcherTarget.value, openMenus(drawn()).length], ["Volume", 0]);
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

test("test_only_the_running_slots_body_is_checked", () => {
  assert.deepEqual(
    slotBodies().map((b) => b && attr(b, "aria-checked")),
    ["true", "false"],
  );
});

const CD = "44100";
const DSD256 = "11289600";

test("test_only_the_running_slot_is_marked_on", () => {
  engineState.value = { ...engineState.value, state: "2" };
  engineStatus.value = { status: { active_rate: DSD256 }, metadata: { samplerate: CD } };
  assert.deepEqual(
    slots().map((s) => classes(s).includes("on")),
    [true, false],
  );
});

/** The loaded SDM chain's running Nx filter, the fixture's own. */
const RUNNING_NX = "poly-sinc-gauss-long";

test("test_an_unlit_running_slot_has_no_on_class", () => {
  engineState.value = { ...engineState.value, state: "2" };
  engineStatus.value = { status: { active_rate: DSD256 }, metadata: { samplerate: CD } };
  setSwitcherTarget("Nx filter");
  setSlot(0, RUNNING_NX);
  const [slot] = slots();
  const [body] = slotBodies();
  assert.deepEqual([slot && classes(slot).includes("on"), body && attr(body, "aria-checked")], [false, "true"]);
});

/** The fixture's plain breakdown of its two modulators, as a slot body draws it. */
const FACES = {
  ASDM5: { fam: "Adaptive", variant: "Fifth order", leaf: "Leaf asdm5" },
  "ASDM7EC 512+fs": { fam: "Adaptive", variant: "Seventh order", leaf: "Leaf asdm7" },
};

test("test_each_slot_body_draws_its_names_plain_family_variant_and_leaf", () => {
  setSlot(0, "ASDM5");
  setSlot(1, "ASDM7EC 512+fs");
  assert.deepEqual(
    slotBodies().map((b) => ({
      fam: classText(b, "cpfam"),
      variant: classText(b, "cpvar"),
      leaf: classText(b, "cpl"),
    })),
    [FACES.ASDM5, FACES["ASDM7EC 512+fs"]],
  );
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
  assert.deepEqual([openList.value?.key, openList.value?.value], ["sdm_modulator", "ASDM5"]);
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

// --- output mode -------------------------------------------------------------------------------------------------

test("test_under_output_mode_each_slot_shows_its_mode_with_no_pick", () => {
  setSwitcherTarget("Output mode");
  const view = switcherView();
  assert.deepEqual(
    slots().map((s) => {
      const [pick] = every(inside(s), "button", "spick");
      return {
        mode: classes(s).includes("mode"),
        v: textIn(s, "span", "v"),
        aka: textIn(s, "span", "aka"),
        hidden: pick && hasAttr(pick, "hidden"),
      };
    }),
    [0, 1].map((i) => ({
      mode: true,
      v: view?.slots[i]?.label,
      aka: view?.slots[i]?.aka,
      hidden: true,
    })),
  );
});

// --- matrix profile ----------------------------------------------------------------------------------------------

test("test_under_matrix_profile_a_pick_opens_a_menu_of_the_profile_choices", async () => {
  setSwitcherTarget("Matrix profile");
  await fire(controls("button", "spick")[1], "onClick");
  const menus = openMenus(drawn());
  assert.deepEqual(
    {
      open: menus.length,
      rows: every(inside(menus[0]), "button", "pmrow").map(text),
    },
    { open: 1, rows: (slotList(1) ?? []).map((o) => o.label) },
  );
});

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

// --- volume ------------------------------------------------------------------------------------------------------

test("test_under_volume_the_volume_bar_stands_in_for_the_slots", () => {
  setSwitcherTarget("Volume");
  const all = drawn();
  const [bar] = every(all, "div", "vbar");
  assert.deepEqual(
    {
      slots: every(all, "div", "slots").length,
      role: bar && attr(bar, "role"),
      label: bar && hasAttr(bar, "aria-label"),
      order: kids(bar)
        .filter((k) => k.name !== "span")
        .map(sig),
    },
    {
      slots: 0,
      role: "group",
      label: true,
      order: ["button.round.vbtn", "div.vbsl", "button.round.vbtn", "div.vfd.vbrd"],
    },
  );
});

test("test_the_volume_slider_carries_the_loudness_marks_over_the_scale", () => {
  setSwitcherTarget("Volume");
  const [box] = every(drawn(), "div", "vbsl");
  const [track] = every(kids(box), "div", "vsl");
  assert.deepEqual(
    {
      under: kids(box).map(sig),
      track: kids(track).map((k) => (k.name === "input" ? `input[${attr(k, "type")}]` : sig(k))),
    },
    { under: ["div.vsl", "div.scale"], track: ["input[range]", "div.lmk"] },
  );
});

test("test_the_volume_readout_prints_the_level", () => {
  setSwitcherTarget("Volume");
  const [rd] = every(drawn(), "div", "vfd", "vbrd");
  assert.deepEqual([rd && attr(rd, "role"), textIn(rd, "span", "v")], ["status", volumeNow().txt]);
});

// --- keys --------------------------------------------------------------------------------------------------------

test("test_an_arrow_key_on_a_slot_body_sends_the_other_slot_live", async () => {
  const bodies = controls("button", "sbody");
  await fire(bodies[0], "onKeyDown", keyEvent("ArrowRight"));
  await quiesce(wire);
  await fire(bodies[1], "onKeyDown", keyEvent("ArrowUp"));
  await fire(bodies[0], "onKeyDown", keyEvent("Enter"));
  assert.deepEqual(sent("/api/config/live"), [{ fields: { modulator: "0" } }]);
});
