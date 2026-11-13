// Rendered suite for the four places a modulator is picked from a list (hqptuner/static/components/faceplate/): the
// Shaping chain picker, the Setting Switcher's slot list, the stage drawer's nameplate and the Snapshot builder's
// picker. Under an SDM output rate in force each one opens the same list: a modulator whose rate floor is above the
// rate is grayed and a tap on it writes and stages nothing; one the rate runs, or with no floor, is not grayed.
//
// The wire is the seam (tests/js/support/listsfixture.js): the fixture's two modulators, ASDM7EC 512+fs with a rate floor
// of 20480000 and ASDM5 with none, under an SDM rate limit served as the `defaults_bitrate` reading, and a fetch fake
// that records every request after the list is open. A surface is driven by the tap that opens its list, through the
// renderer's vnode seam (tests/js/support/vnodeseam.js); the open list is the view's `openList` signal, rendered through
// OptionList. Every string asserted is a fixture name.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-lists/rate-floor-surfaces.test.js

import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { OptionList } from "../../../../hqptuner/static/components/faceplate/lists/OptionList.js";
import { ChainPick } from "../../../../hqptuner/static/components/faceplate/page/ChainPick.js";
import { Switcher } from "../../../../hqptuner/static/components/faceplate/bottom/Switcher.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { SHAPING_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/modes.js";
import { SnapshotRows } from "../../../../hqptuner/static/components/faceplate/builders/SnapshotRows.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { engineState } from "../../../../hqptuner/static/store/signals.js";
import { conversionSections } from "../../../../hqptuner/static/store/faceplate/page/conversion.js";
import {
  setSlot,
  setSwitcherTarget,
  switcherView,
} from "../../../../hqptuner/static/store/faceplate/bottom/switcher.js";
import { cur, staged } from "../../../../hqptuner/static/store/faceplate/builders/shell.js";
import { editNow } from "../../../../hqptuner/static/store/faceplate/builders/snapshot.js";
import { openList, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { liveBook } from "../../../../hqptuner/static/store/live/presets.js";
import { flushNarrowing } from "../../../../hqptuner/static/store/narrow/persist.js";
import { setBottomBar } from "../../../../hqptuner/static/store/ui/prefs.js";
import { ok, stagingWire } from "../../support/wire/wire.js";
import { settle } from "../../support/wire/favoriteswire.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr, elements } from "../../support/markup.js";
import { useStorage } from "../../support/storage.js";
import { loadLists, resetLists } from "../../support/listsfixture.js";

useStorage();

/** The modulator the rate cannot run, and the one with no floor that the engine runs. */
const GRAYED = "ASDM7EC 512+fs";
const PLAIN = "ASDM5";
const DSD256 = "12288000";

/** @type {{ fetch?: unknown }} */
const env = globalThis;

/** @type {string[]} */
let sent = [];

beforeEach(async () => {
  useStorage();
  stagingWire();
  resetLists();
  await loadLists({ readings: { defaults_bitrate: DSD256 } });
  engineState.value = { ...engineState.value, shaper: "0" };
  cancel();
  await discardAll();
  openList.value = null;
  sent = [];
  env.fetch = async (/** @type {string} */ url, /** @type {{ method?: string }} */ init) => {
    sent.push(`${init?.method ?? "GET"} ${url}`);
    return ok({});
  };
});

afterEach(async () => {
  await flushNarrowing();
});

/**
 * Tap the first element of one render of `tree` whose props satisfy `pred`.
 *
 * @param {Parameters<typeof render>[0]} tree
 * @param {(props: Record<string, unknown>) => boolean} pred
 */
async function tapOn(tree, pred) {
  const { seen } = renderTree(tree);
  const hit = seen.find((v) => typeof v.type === "string" && pred(v.props ?? {}));
  const fn = /** @type {(() => unknown) | undefined} */ (hit?.props.onClick);
  if (fn) await fn();
  await settle();
}

/** Each surface opens its modulator list by a tap on its own control. @type {Record<string, () => Promise<void>>} */
const OPEN = {
  chain: async () => {
    const field = conversionSections().shaping.fields.find((f) => f.key === "sdm_modulator");
    if (!field) throw new Error("the Shaping section holds no modulator field");
    await tapOn(html`<${ChainPick} field=${field} label="Shaping" />`, (p) => p["data-list"] === "sdm_modulator");
  },
  switcher: async () => {
    setBottomBar("switcher");
    setSwitcherTarget("Modulator");
    setSlot(0, "");
    setSlot(1, "");
    await tapOn(html`<${Switcher} />`, (p) => typeof p.id === "string" && p.id === "swlist-0");
  },
  drawer: async () => {
    openStage.value = SHAPING_DRAWER.id;
    await tapOn(html`<${Drawer} schema=${SHAPING_DRAWER} />`, (p) => p["data-list"] === "sdm_modulator");
  },
  builder: async () => {
    liveBook.value = {
      Speakers: {
        S01: {
          chain: "sdm",
          fields: { mode: "sdm", oversampling1x: "38", oversampling: "38", modulator: "0" },
          names: {},
        },
      },
    };
    staged.value = new Map();
    cur.value = { st: "Speakers", name: "S01" };
    await tapOn(html`<${SnapshotRows} />`, (p) => p["data-list"] === "sdm_modulator");
  },
};

/** The rows of the open list, by engine name. */
const listed = () =>
  Object.fromEntries(
    elements(render(html`<${OptionList} />`))
      .filter((e) => attr(e, "role") === "option")
      .map((e) => [attr(e, "data-v"), attr(e, "aria-disabled") === "true"]),
  );

/** The state a pick would have moved on each surface besides the wire. @type {Record<string, () => unknown>} */
const MOVED = {
  chain: () => sent,
  switcher: () => switcherView()?.slots.map((s) => s.name),
  drawer: () => sent,
  builder: () => JSON.stringify(editNow()?.vals),
};

for (const surface of Object.keys(OPEN)) {
  test(`test_the_${surface}_list_grays_a_modulator_above_the_rate_in_force`, async () => {
    await OPEN[surface]();
    assert.equal(listed()[GRAYED], true);
  });

  test(`test_the_${surface}_list_leaves_a_modulator_with_no_floor_pickable`, async () => {
    await OPEN[surface]();
    assert.equal(listed()[PLAIN], false);
  });

  test(`test_a_tap_on_a_grayed_row_from_the_${surface}_list_writes_and_stages_nothing`, async () => {
    await OPEN[surface]();
    const before = JSON.stringify(MOVED[surface]());
    await tapOn(html`<${OptionList} />`, (p) => p.role === "option" && p["data-v"] === GRAYED);
    assert.equal(JSON.stringify(MOVED[surface]()), before);
  });
}
