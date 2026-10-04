// Rendered suite for hqptuner/static/components/faceplate/settings/logging.js, the Logging drawer's schema drawn by the
// stage drawer and its two Settings rail readouts: the body in order, the log path's gray line following the logging
// switch, and the readouts printing the running values through settingsRail.
//
// Renders `Drawer` through preact-render-to-string and drives the store at the wire by the staging fake. Rows are found
// by catalog key (`data-k`), the block by its name (`data-block`), readouts by id; every string asserted is a wire value
// or the readout control's own option label.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/logging.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { LOGGING_DRAWER, LOGGING_READOUTS } from "../../../../hqptuner/static/components/faceplate/settings/logging.js";
import {
  config,
  engineState,
  engineStatus,
  enums,
  metadata,
  pendingPreset,
} from "../../../../hqptuner/static/store/signals.js";
import { discardAll, edit } from "../../../../hqptuner/static/store/actions.js";
import { cancel } from "../../../../hqptuner/static/store/ask.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { pickApplyMode } from "../../../../hqptuner/static/store/faceplate/drawer.js";
import { settingsRail } from "../../../../hqptuner/static/store/faceplate/settings/rail.js";
import { alertPlan } from "../../../../hqptuner/static/model/shell/alerts.js";
import { stagingWire } from "../../support/wire/wire.js";
import { elements, attr, classes } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

const RUNNING_PATH = "/var/log/hqplayerd-running.log";

/**
 * The daemon's form with logging switched as given.
 *
 * @param {boolean} on
 */
const form = (on) => ({
  fields: [
    { name: "log_enabled", type: "checkbox", value: on },
    { name: "log_file", type: "text", value: RUNNING_PATH },
  ],
  file: {},
  active: "",
});

beforeEach(async () => {
  stagingWire();
  config.value = form(false);
  engineState.value = {};
  engineStatus.value = {};
  enums.value = {};
  metadata.value = null;
  pendingPreset.value = null;
  openStage.value = null;
  openPopover.value = null;
  cancel();
  await discardAll();
  pickApplyMode("apply");
});

/** Every element of the drawer's markup, in document order. @returns {MarkupElement[]} */
const markup = () => elements(render(html`<${Drawer} schema=${LOGGING_DRAWER} />`)).sort((a, b) => a.start - b.start);

/** The gray lines inside the log path row. @returns {number} */
function pathGrayLines() {
  const row = markup().find((e) => attr(e, "data-k") === "log_file");
  return row ? elements(row.html).filter((e) => e.name === "span" && classes(e).includes("gr")).length : -1;
}

/**
 * One readout's printed text on the Settings rail, by readout id.
 *
 * @param {string} id
 * @returns {string | undefined}
 */
function railText(id) {
  const [entry] = settingsRail([{ id: "logging", name: "", readouts: LOGGING_READOUTS }], alertPlan([], {}), null, []);
  return entry?.rows[LOGGING_READOUTS.findIndex((r) => r.id === id)]?.text;
}

/**
 * The label the logging readout's own control gives an option value.
 *
 * @param {string} v
 * @returns {string | undefined}
 */
const logonLabel = (v) =>
  LOGGING_READOUTS.find((r) => r.id === "logon")?.control.options?.find((o) => String(o.v) === v)?.label;

test("test_the_logging_drawer_draws_the_switch_the_path_and_the_log_tail_in_order", () => {
  const items = markup()
    .filter((e) => classes(e).includes("drow") || classes(e).includes("dblock"))
    .map((e) => attr(e, "data-k") ?? attr(e, "data-block"));
  assert.deepEqual(items, ["log_enabled", "log_file", "logtail"]);
});

test("test_the_log_path_row_grays_while_logging_is_off_and_not_while_on", () => {
  const off = pathGrayLines();
  config.value = form(true);
  assert.deepEqual([off, pathGrayLines()], [1, 0]);
});

test("test_the_logging_readout_prints_the_running_switch_as_its_option", () => {
  const off = railText("logon");
  config.value = form(true);
  const on = railText("logon");
  assert.deepEqual([off, on, off !== on], [logonLabel("0"), logonLabel("1"), true]);
});

test("test_the_log_path_readout_prints_the_running_path_not_a_staged_one", async () => {
  await edit("log_file", "/tmp/staged.log");
  assert.equal(railText("logpath"), RUNNING_PATH);
});
