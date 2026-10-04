// Rendered suite for the alert lines on hqptuner/static/components/faceplate/drawer/Drawer.js: a drawer an alert is
// homed on prints that alert's line under its head, ahead of its panels, in the alert's severity.
//
// The wire is the seam, as tests/js/store/faceplate/alerts.test.js drives it: the shared shaper-fit scenario builder
// states the /api/state, enumerations, config and metadata payloads, the /api/health reading goes into `health`, and
// each /api/status poll is a fresh frame on the case's own track, the health store's baseline effect registered. The
// drawers are schemas of one intro tab, named by the rail ids the alerts are homed on.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-alerts/drawer.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { engineStatus, health } from "../../../../hqptuner/static/store/signals.js";
import { initHealth } from "../../../../hqptuner/static/store/health.js";
import { elements, attr, classes } from "../../support/markup.js";
import { reset, DSD1024, PCM_8X } from "../../support/shaperfit-fixtures.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../../../hqptuner/static/store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

initHealth();

/** A /api/health reading whose credentials the daemon accepted. */
const HEALTHY = { reachable: true, ready: true, connected: true, credentials_ok: true };

/** The junk advisor's object as /api/status carries it. */
const ADVICE = { filter: "30k", reason: "reason-fixture", ceiling_khz: 30 };

let serial = 0;

/**
 * One /api/status poll on the current track: playing at a healthy speed, with the fields a case names laid over it.
 *
 * @param {Record<string, string>} [fields]  Status frame attributes
 * @param {Record<string, unknown>} [extra]  the payload's other keys: `junk`
 */
function poll(fields = {}, extra = {}) {
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
    ...extra,
  };
}

/** Start a case with nothing wrong: SDM at DSD1024 past its modulator's floor, accepted credentials, a fresh track. */
async function quiet() {
  await reset({ chain: "sdm", mode: "2", sdmRate: DSD1024, pcmRate: PCM_8X });
  health.value = { ...HEALTHY };
  openStage.value = null;
  serial += 1;
  poll();
}

/**
 * A drawer of one intro tab under the given rail id.
 *
 * @param {string} id
 * @returns {DrawerSchema}
 */
const drawer = (id) => ({
  id,
  title: `${id}-title`,
  aria: id,
  tabs: [{ id: "only", label: "only", body: [{ intro: "intro-fixture" }] }],
});

/**
 * Every element of a drawer's markup.
 *
 * @param {string} id
 * @returns {MarkupElement[]}
 */
const markup = (id) => elements(render(html`<${Drawer} schema=${drawer(id)} />`));

/**
 * The first element of a drawer's markup carrying a class, or undefined.
 *
 * @param {string} id
 * @param {string} cls
 */
const first = (id, cls) => markup(id).find((e) => classes(e).includes(cls));

test("test_clipping_prints_one_alert_line_in_the_volume_drawer", async () => {
  await quiet();
  poll({ clips: "12" });
  assert.equal(markup("volume").filter((e) => classes(e).includes("aline")).length, 1);
});

test("test_the_junk_advice_line_in_the_hf_drawer_reads_advice", async () => {
  await quiet();
  poll({}, { junk: { ...ADVICE } });
  const line = first("hf", "aline");
  assert.equal(line ? attr(line, "data-sev") : undefined, "advice");
});

test("test_the_alert_lines_precede_the_drawers_panels", async () => {
  await quiet();
  poll({ clips: "12" });
  const lines = first("volume", "dalert");
  const panel = first("volume", "dpanel");
  assert.equal(lines && panel ? lines.start < panel.start : null, true);
});
