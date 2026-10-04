// Rendered suite for the alert homes on hqptuner/static/components/faceplate/Rail.js: a raised alert blinks its stage in
// its colour, and an SDM modulator below its rate floor darkens the stages after Shaping.
//
// The wire is the seam, as tests/js/store/faceplate/alerts.test.js drives it: the shared shaper-fit scenario builder
// states the /api/state, enumerations, config and metadata payloads, the /api/health reading goes into `health`, and
// each /api/status poll is a fresh frame on the case's own track, the health store's baseline effect registered. The
// rail's own signals are set as tests/js/components/faceplate/rail.test.js sets them.
//
// Not reachable here: the `wrap` class a stage takes when its name runs past one line, and the redraw once the fonts
// land. Both run in the rail's effect, which measures the laid-out rail; server rendering lays nothing out and runs no
// effects. A browser run closes that gap.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-alerts/rail.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Rail } from "../../../../hqptuner/static/components/faceplate/Rail.js";
import { openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { hiddenStages } from "../../../../hqptuner/static/store/ui/faceplate.js";
import { engineStatus, health, matrixConfig, volume } from "../../../../hqptuner/static/store/signals.js";
import { initHealth } from "../../../../hqptuner/static/store/health.js";
import { elements, attr, classes } from "../../support/markup.js";
import { reset, DSD512, DSD1024, PCM_8X } from "../../support/shaperfit-fixtures.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/shaperfit-fixtures.js").Scenario} Scenario */

initHealth();

/** A /api/health reading whose credentials the daemon accepted. */
const HEALTHY = { reachable: true, ready: true, connected: true, credentials_ok: true };

let serial = 0;

/**
 * One /api/status poll on the current track: playing at a healthy speed, with the fields a case names laid over it.
 *
 * @param {Record<string, string>} [fields]
 */
function poll(fields = {}) {
  engineStatus.value = {
    status: {
      state: "2",
      track_serial: String(serial),
      process_speed: "1.5",
      output_fill: "0.9",
      clips: "0",
      apod: "0",
      active_filter: "sinc-M",
      ...fields,
    },
  };
}

/**
 * Start a case with nothing wrong: SDM at DSD1024 past its modulator's floor, accepted credentials, a fresh track at a
 * healthy speed, every stage shown and no drawer open. A scenario overrides the shaper fit's half.
 *
 * @param {Scenario} [scenario]
 */
async function quiet(scenario = {}) {
  await reset({ chain: "sdm", mode: "2", sdmRate: DSD1024, pcmRate: PCM_8X, ...scenario });
  matrixConfig.value = { fields: [{ name: "enabled", value: true }] };
  volume.value = "-20";
  hiddenStages.value = [];
  openStage.value = null;
  health.value = { ...HEALTHY };
  serial += 1;
  poll();
}

/** The rendered rail's stage buttons. */
const buttons = () => elements(render(html`<${Rail} />`)).filter((e) => e.name === "button");

/**
 * The rendered button of one stage, or an empty element when there is none.
 *
 * @param {string} id
 * @returns {MarkupElement}
 */
const button = (id) =>
  buttons().find((b) => attr(b, "data-stage") === id) || { name: "", attrs: "", start: -1, html: "" };

test("test_clipping_this_track_blinks_the_volume_stage_amber", async () => {
  await quiet();
  poll({ clips: "12" });
  assert.equal(attr(button("volume"), "data-alert"), "warn");
});

test("test_a_modulator_below_its_floor_blinks_the_shaping_stage_red", async () => {
  await quiet({ sdmRate: DSD512 });
  assert.equal(attr(button("shaping"), "data-alert"), "crit");
});

test("test_a_modulator_below_its_floor_darkens_speakers_and_output_and_not_shaping", async () => {
  await quiet({ sdmRate: DSD512 });
  assert.deepEqual(
    ["shaping", "speakers", "output"].filter((id) => classes(button(id)).includes("dead")),
    ["speakers", "output"],
  );
});
