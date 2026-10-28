// Rendered suite for the stale mark on the Hardware acceleration drawer as the settings truth rules have it: the
// drawer keeps showing its last File reading, and while it waits on its readback after an apply, or while its last
// read failed, every setting it shows is marked stale, the mark going when a fresh reading lands. The mark is visual
// only: a dimmed ink, no text.
//
// The mark's observable form is tests/js/support/rendered/stalemark.js's: the `stale` class token, on the element
// showing a setting's value, on an element inside it, or on an element enclosing it; one setting per engine attribute
// the form holds. The drawer's catalog rows are found by their `data-k` wire key in the drawer's own render, and its
// two blocks are rendered as the blocks' own suite renders them: Blocks per cycle's value by its range input, each
// CUDA device box by its `data-k` input. The all-stations field is not a File value and is not asked about.
//
// The wire is the seam: `GET /api/engine` answers the engine table the case hands the fake, `POST /api/engine` answers
// a confirmed report, and the readback after it is held until the case releases it.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-settings/hardware-stale.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { HARDWARE_DRAWER } from "../../../../hqptuner/static/components/faceplate/settings/hardware.js";
import {
  CudaDevicesBlock,
  NblocksBlock,
} from "../../../../hqptuner/static/components/faceplate/settings/HardwareBlocks.js";
import {
  applyHardware,
  discardHardware,
  loadHardware,
  setAllStations,
  setHardware,
} from "../../../../hqptuner/static/store/faceplate/settings/hardware.js";
import { renderTree } from "../../support/vnodeseam.js";
import { attr } from "../../support/markup.js";
import { heldReadbackWire, marksOn, turn, until } from "../../support/rendered/stalemark.js";
import { bad, ok, quiesce, stagingWire } from "../../support/wire/wire.js";

/** @typedef {Record<string, string>} EngineTable  the engine attributes as `GET /api/engine` carries them */
/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

//: The engine as the daemon reports it, every attribute off the daemon's default.
const ENGINE = { cuda: "1", multicore: "0", ecores: "pool", nblocks: "4", cuda_dev: "0", cuda_cdev: "1" };

//: The engine as read back after the apply landed `ecores: "filter"`.
const READBACK = { ...ENGINE, ecores: "filter" };

//: The refusal a daemon answers an engine read with.
const READ_REFUSED = "fixture engine read refused";

//: Where each block is drawn, as the drawer hands it in.
const HERE = { drawer: "hardware", tab: "gpu" };

/** @param {string} key  a matcher for the element carrying the wire key */
const keyed = (key) => (/** @type {MarkupElement} */ e) => attr(e, "data-k") === key;

const drawer = () => html`<${Drawer} schema=${HARDWARE_DRAWER} />`;
const nblocks = () => html`<${NblocksBlock} schema=${HARDWARE_DRAWER} here=${HERE} />`;
const devices = () => html`<${CudaDevicesBlock} schema=${HARDWARE_DRAWER} here=${HERE} />`;

/**
 * Each engine attribute the form holds, with the tree that shows it and how its value's element is found there.
 *
 * @type {{ key: string, tree: () => unknown, shows: (e: MarkupElement) => boolean }[]}
 */
const SHOWN = [
  { key: "multicore", tree: drawer, shows: keyed("multicore") },
  { key: "ecores", tree: drawer, shows: keyed("ecores") },
  { key: "cuda", tree: drawer, shows: keyed("cuda") },
  { key: "nblocks", tree: nblocks, shows: (e) => e.name === "input" && attr(e, "type") === "range" },
  { key: "cuda_dev", tree: devices, shows: keyed("cuda_dev") },
  { key: "cuda_cdev", tree: devices, shows: keyed("cuda_cdev") },
];

/** A daemon answering every engine read with `ENGINE`; returns the wire, to wait on. */
const readingDaemon = () =>
  stagingWire({
    routes: (path, opts) => (path === "/api/engine" && opts.method !== "POST" ? ok({ engine: ENGINE }) : undefined),
  });

/** A daemon refusing every engine read; returns the wire, to wait on. */
const refusingDaemon = () =>
  stagingWire({ routes: (path) => (path === "/api/engine" ? bad(502, READ_REFUSED) : undefined) });

/** A daemon reading `ENGINE`, confirming a write, and holding the readback after it at `READBACK`. */
const heldReadbackDaemon = () =>
  heldReadbackWire({
    path: "/api/engine",
    before: ok({ engine: ENGINE }),
    written: ok({ report: { verified: { applied: true, engine: READBACK }, members: [], backup_bytes: 0 } }),
    after: ok({ engine: READBACK }),
  });

/** Each engine attribute, keyed, with whether the element showing it carries the stale mark, or null when not drawn. */
const valuesMarked = () =>
  Object.fromEntries(SHOWN.map(({ key, tree, shows }) => [key, marksOn(renderTree(tree()).out, shows)[0] ?? null]));

/** @param {boolean} on */
const every = (on) => Object.fromEntries(SHOWN.map(({ key }) => [key, on]));

beforeEach(async () => {
  await quiesce(readingDaemon());
  discardHardware();
  setAllStations(false);
  await loadHardware();
});

// Break: the drawer draws the draft's values without the form's stale mark, or keeps the mark once the readback has
// landed.
test("test_the_settings_shown_read_stale_from_a_confirmed_apply_until_its_readback_lands", async () => {
  const { wire, release, asked } = heldReadbackDaemon();
  setHardware("ecores", "filter");
  const seen = [valuesMarked()];
  const applying = applyHardware();
  await until(asked);
  await turn();
  seen.push(valuesMarked());
  release();
  await applying;
  await quiesce(wire);
  seen.push(valuesMarked());
  assert.deepEqual(seen, [every(false), every(true), every(false)]);
});

// Break: a failed engine read leaves the settings shown unmarked over the last reading, or the next read that lands
// leaves the mark on.
test("test_the_settings_shown_read_stale_exactly_while_the_last_engine_read_failed", async () => {
  await quiesce(refusingDaemon());
  await loadHardware().catch(() => undefined);
  const seen = [valuesMarked()];
  await quiesce(readingDaemon());
  await loadHardware();
  seen.push(valuesMarked());
  assert.deepEqual(seen, [every(true), every(false)]);
});
