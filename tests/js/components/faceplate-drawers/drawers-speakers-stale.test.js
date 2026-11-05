// Rendered suite for the stale mark on the Speakers drawer as the settings truth rules have it: the drawer keeps
// showing its last reading of the daemon's /speakers form, and while it waits on its readback after an apply, or while
// its last read failed, every value of the form it shows is marked stale, each channel's level and distance box and the
// speakers switch alike, the mark going when a fresh reading lands. The mark is visual only: a dimmed ink, no text.
//
// The mark's observable form is tests/js/support/rendered/stalemark.js's: the `stale` class token, on the element
// showing a value, on an element inside it, or on an element enclosing it. A box is a number input inside a channel
// row, found by its `sprow` class. The switch is the catalog's `spken` row drawn by the generic drawer, found by its
// `drow` class and its `data-k`, and the value it shows is its lit option, the button carrying the `on` state class.
// The speaker set is a browser preference, not a File value, and is not asked about.
//
// The wire is the seam: `GET /api/speakers` answers the form the case hands the fake, `POST /api/speakers` answers an
// applied report, and the read after it is held until the case releases it; the running direct_sdm is written into
// `config`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-speakers-stale.test.js

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { SpeakersBody } from "../../../../hqptuner/static/components/faceplate/drawers/Speakers.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import {
  SPEAKERS_BLOCKS,
  SPEAKERS_DRAWER,
} from "../../../../hqptuner/static/components/faceplate/drawers/speakers-drawer.js";
import { config } from "../../../../hqptuner/static/store/signals.js";
import { loadSpeakers } from "../../../../hqptuner/static/store/matrix/speakers.js";
import * as drawer from "../../../../hqptuner/static/store/faceplate/drawers/speakers.js";
import { renderTree } from "../../support/vnodeseam.js";
import { seedReadings } from "../../support/readings.js";
import { attr, classes, elements } from "../../support/markup.js";
import { heldReadbackWire, marksOn, turn, until } from "../../support/rendered/stalemark.js";
import { SPEAKER_DISTANCES, speakersFormAt } from "../../support/rendered/speakersform.js";
import { bad, ok, quiesce, stagingWire } from "../../support/wire/wire.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

//: The channel the apply writes, and the distance it writes there and the readback carries.
const WRITTEN_CHANNEL = 1;
const WRITTEN_CM = 333;

const FORM = speakersFormAt(SPEAKER_DISTANCES);
const READBACK = speakersFormAt(SPEAKER_DISTANCES.map((d, i) => (i === WRITTEN_CHANNEL ? WRITTEN_CM : d)));

//: The refusal a daemon answers a /speakers read with.
const READ_REFUSED = "fixture speakers read refused";

const FIRST = drawer.SETS[0];

/** A daemon answering every /speakers read with `FORM`; returns the wire, to wait on. */
const readingDaemon = () =>
  stagingWire({
    routes: (path, opts) => (path === "/api/speakers" && opts.method !== "POST" ? ok({ data: FORM }) : undefined),
  });

/** A daemon refusing every /speakers read; returns the wire, to wait on. */
const refusingDaemon = () =>
  stagingWire({ routes: (path) => (path === "/api/speakers" ? bad(502, READ_REFUSED) : undefined) });

/** A daemon reading `FORM`, answering a write as applied, and holding the readback after it at `READBACK`. */
const heldReadbackDaemon = () =>
  heldReadbackWire({
    path: "/api/speakers",
    before: ok({ data: FORM }),
    written: ok({ report: { applied: true, speakers: READBACK } }),
    after: ok({ data: READBACK }),
  });

/** @param {MarkupElement} e  whether the element is a number box */
const isBox = (e) => e.name === "input" && attr(e, "type") === "number";

/** For each channel row drawn, for each of its number boxes, whether the box carries the stale mark. */
const boxesMarked = () => {
  const out = renderTree(html`<${SpeakersBody} schema=${SPEAKERS_DRAWER} />`).out;
  const rows = elements(out).filter((e) => classes(e).includes("sprow"));
  return rows.map((row) =>
    marksOn(out, (e) => isBox(e) && e.start > row.start && e.start < row.start + row.html.length),
  );
};

//: Each channel row's two boxes, level then distance, all reading `on`.
const every = (/** @type {boolean} */ on) => FIRST.channels.map(() => [on, on]);

//: The catalog id of the speakers switch's row.
const SPKEN = "spken";

/**
 * Whether `inner` lies inside `outer`, both from one render.
 *
 * @param {MarkupElement} inner
 * @param {MarkupElement} outer
 */
const within = (inner, outer) => inner.start > outer.start && inner.start < outer.start + outer.html.length;

/** For the switch row's lit option, as the whole drawer draws it, whether it carries the stale mark. */
const switchMarked = () => {
  const out = renderTree(html`<${Drawer} schema=${SPEAKERS_DRAWER} blocks=${SPEAKERS_BLOCKS} />`).out;
  const rows = elements(out).filter((e) => classes(e).includes("drow") && attr(e, "data-k") === SPKEN);
  return marksOn(out, (e) => e.name === "button" && classes(e).includes("on") && rows.some((row) => within(e, row)));
};

beforeEach(async () => {
  await quiesce(readingDaemon());
  await loadSpeakers();
  config.value = { fields: [{ name: "direct_sdm" }] };
  seedReadings({ direct_sdm: false });
  drawer.discardDraft();
  drawer.pickSpeakerSet(FIRST.id);
});

// Break: the channel boxes draw the draft's values without the form's stale mark, or keep the mark once the readback
// has landed.
test("test_the_channel_boxes_read_stale_from_an_applied_write_until_its_readback_lands", async () => {
  const { wire, release, asked } = heldReadbackDaemon();
  drawer.setChannelDistance(WRITTEN_CHANNEL, String(WRITTEN_CM));
  const seen = [boxesMarked()];
  const applying = drawer.applyDraft();
  await until(asked);
  await turn();
  seen.push(boxesMarked());
  release();
  await applying;
  await quiesce(wire);
  seen.push(boxesMarked());
  assert.deepEqual(seen, [every(false), every(true), every(false)]);
});

// Break: a failed /speakers read leaves the channel boxes unmarked over the last reading, or the next read that lands
// leaves the mark on.
test("test_the_channel_boxes_read_stale_exactly_while_the_last_speakers_read_failed", async () => {
  await quiesce(refusingDaemon());
  await loadSpeakers().catch(() => undefined);
  const seen = [boxesMarked()];
  await quiesce(readingDaemon());
  await loadSpeakers();
  seen.push(boxesMarked());
  assert.deepEqual(seen, [every(true), every(false)]);
});

// Break: the switch row draws its lit option without the form's stale mark while a channel write waits on its
// readback, the mark reaching the channel rows only, or keeps the mark once the readback has landed.
test("test_the_speakers_switch_reads_stale_from_an_applied_write_until_its_readback_lands", async () => {
  const { wire, release, asked } = heldReadbackDaemon();
  drawer.setChannelDistance(WRITTEN_CHANNEL, String(WRITTEN_CM));
  const seen = [switchMarked()];
  const applying = drawer.applyDraft();
  await until(asked);
  await turn();
  seen.push(switchMarked());
  release();
  await applying;
  await quiesce(wire);
  seen.push(switchMarked());
  assert.deepEqual(seen, [[false], [true], [false]]);
});

// Break: a failed /speakers read leaves the switch row's lit option unmarked over the last reading, the mark reaching
// the channel rows only, or the next read that lands leaves the mark on.
test("test_the_speakers_switch_reads_stale_exactly_while_the_last_speakers_read_failed", async () => {
  await quiesce(refusingDaemon());
  await loadSpeakers().catch(() => undefined);
  const seen = [switchMarked()];
  await quiesce(readingDaemon());
  await loadSpeakers();
  seen.push(switchMarked());
  assert.deepEqual(seen, [[true], [false]]);
});
