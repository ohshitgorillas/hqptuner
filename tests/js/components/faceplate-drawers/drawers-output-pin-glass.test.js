// Rendered suite for what the rate dial's glass (components/faceplate/drawers/output/RateDial.js) shows of each tier's
// two rate values under the pin picker: under Auto every value reads alike as shown, and under a picked family only that
// family's values keep that look while the other family's are set apart on the glass. The claim is made on a tier
// away from the needle and on the tier the running band's needle sits on.
//
// The look of a value is the attribute runs of its own element and of every element between it and its tier group
// (`g[data-i]`), so the test names no class or attribute the component is free to choose: a value is compared with
// itself across picks, never with a literal. Indication carried only on the tier group or above it, through a stylesheet
// descendant rule, is not observable under server rendering and fails here.
//
// A value is found by its number alone, read in kHz or Hz, inside the tier that carries it. The pick is fired through
// the vnode seam (tests/js/support/vnodeseam.js) on the option's wire identifier (`data-pin`), since server rendering
// fires no events; Auto is the picker's reading on opening the drawer with nothing pinned.
//
// Not reachable here: whether the glass keeps the other family's values on screen under a pick. That holds today,
// so no red run can say anything about it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-output-pin-glass.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { useStorage } from "../../support/storage.js";
import { ok, quiesce, stagingWire } from "../../support/wire/wire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, elements, text } from "../../support/markup.js";

useStorage();

const { html } = await import("../../../../hqptuner/static/lib/dom.js");
const { RateDial } = await import("../../../../hqptuner/static/components/faceplate/drawers/output/RateDial.js");
const { config, engineState, engineStatus, enums, metadata } =
  await import("../../../../hqptuner/static/store/signals.js");
const { discardAll } = await import("../../../../hqptuner/static/store/actions.js");
const { openPopover, openStage } = await import("../../../../hqptuner/static/store/faceplate/view.js");
const { setAllowPinnedRates } = await import("../../../../hqptuner/static/store/ui/faceplate.js");

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/wire/wire.js").StagingWire} StagingWire */

const PCM_HZ = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000, 1411200, 1536000];

/** The Output drawer's stage on the rail. */
const OUTPUT = "output";

/** PCM 2x on the dial (tiers count PCM 1x..32x as 0..5), and its two members. */
const PCM_2X = 1;
const HZ_44 = 88200;
const HZ_48 = 96000;

/** PCM 4x, where the running band's needle sits on the 192000 limit loaded below, and its two members. */
const PCM_NEEDLE = 2;
const NEEDLE_HZ_44 = 176400;
const NEEDLE_HZ_48 = 192000;

/** Playing at PCM 8x of the 44.1k family, away from the tier read. */
const PLAYING = "352800";

const STANDA = "naa-7bdbb6cb/hw:CARD=Standa,DEV=0";

/** @type {StagingWire} */
let wire;

/** @param {string} path */
function routes(path) {
  if (path === "/api/config/live") return ok({ report: { live: [], stored: {} } });
  if (path === "/api/state") return ok({ data: engineState.value });
  if (path === "/api/enumerations") return ok({ data: enums.value });
  return undefined;
}

/** Load the /config payload and put the engine on PCM playing, nothing pinned. */
function load() {
  config.value = {
    fields: [
      { name: "defaults_samplerate", type: "select", value: "192000" },
      { name: "defaults_bitrate", type: "select", value: "12288000" },
      { name: "mode", type: "select", value: "pcm" },
      { name: "backend", type: "select", value: "network" },
      { name: "net_dop", type: "checkbox", value: false },
      { name: "net_device", type: "select", value: STANDA, options: [{ value: STANDA, label: STANDA }] },
    ],
    file: {},
    active: "",
    profiles: null,
    device_caps: null,
  };
  enums.value = {
    rates: [{ index: "0", rate: "0" }, ...PCM_HZ.map((r, n) => ({ index: String(n + 1), rate: String(r) }))],
  };
  engineState.value = { state: "2", mode: "1", active_chain: "pcm", rate: "0" };
  engineStatus.value = { status: { active_rate: PLAYING }, metadata: { samplerate: "44100" } };
}

beforeEach(async () => {
  wire = stagingWire({ routes });
  load();
  metadata.value = null;
  openPopover.value = null;
  setAllowPinnedRates(true);
  await quiesce(wire);
  await discardAll();
  openStage.value = null;
  openStage.value = OUTPUT;
  await quiesce(wire);
});

/**
 * Tap the picker option `pin`, or nothing when the dial carries none, and let anything it sends run out.
 *
 * @param {string} pin
 */
async function pick(pin) {
  const { seen } = renderTree(html`<${RateDial} />`);
  const hit = seen.find((v) => typeof v.type === "string" && (v.props ?? {})["data-pin"] === pin);
  const fn = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (fn) await fn();
  await quiesce(wire);
}

/**
 * Whether an element's own text is the rate `hz` and nothing else, read in kHz or Hz.
 *
 * @param {MarkupElement} el
 * @param {number} hz
 */
function reads(el, hz) {
  const m = /^(\d+(?:\.\d+)?)\s*(k|kHz|Hz)?$/i.exec(text(el));
  return m !== null && [hz, hz / 1000].includes(Number(m[1]));
}

/**
 * The look of the value `hz` printed on tier `i`: the attribute runs of the smallest element reading it and of every
 * element between it and the tier group, outermost first. Undefined when the tier prints no such value.
 *
 * @param {number} i
 * @param {number} hz
 */
function look(i, hz) {
  const tier = elements(render(html`<${RateDial} />`)).find((e) => e.name === "g" && attr(e, "data-i") === String(i));
  const inside = elements(tier?.html ?? "").slice(0, -1);
  const value = inside.filter((e) => reads(e, hz)).sort((a, b) => a.html.length - b.html.length)[0];
  if (value === undefined) return undefined;
  const end = value.start + value.html.length;
  return inside
    .filter((e) => e.start <= value.start && e.start + e.html.length >= end)
    .sort((a, b) => a.start - b.start || b.html.length - a.html.length)
    .map((e) => `<${e.name}${e.attrs}>`)
    .join("");
}

/**
 * Pick `fam` and say, for tier `i`, whether its own family's value and the other family's value each still look as
 * they did under Auto.
 *
 * @param {number} i
 * @param {string} fam
 * @param {number} own
 * @param {number} other
 */
async function lookAgainstAuto(i, fam, own, other) {
  const auto = { own: look(i, own), other: look(i, other) };
  await pick(fam);
  return [look(i, own) === auto.own, look(i, other) === auto.other];
}

for (const { fam, own, other } of [
  { fam: "f44", own: HZ_44, other: HZ_48 },
  { fam: "f48", own: HZ_48, other: HZ_44 },
]) {
  test(`test_picking_${fam}_keeps_only_its_own_familys_values_as_auto_shows_them`, async () => {
    assert.deepEqual(await lookAgainstAuto(PCM_2X, fam, own, other), [true, false]);
  });
}

for (const { fam, own, other } of [
  { fam: "f44", own: NEEDLE_HZ_44, other: NEEDLE_HZ_48 },
  { fam: "f48", own: NEEDLE_HZ_48, other: NEEDLE_HZ_44 },
]) {
  test(`test_picking_${fam}_keeps_only_its_own_familys_values_as_auto_shows_them_on_the_needles_tier`, async () => {
    assert.deepEqual(await lookAgainstAuto(PCM_NEEDLE, fam, own, other), [true, false]);
  });
}
