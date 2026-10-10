// Rendered suite for a drawer row whose settings metadata entry holds part of its paragraph back: an entry may carry
// `more`, the prose held back, beside `tooltip`, the start shown. A row whose entry carries `more` shows its tooltip and
// then the `see more` trigger, and the trigger's popover holds the `more` prose. A row whose entry carries no `more`
// shows its tooltip whole, with no trigger.
//
// The mark lives in the metadata, so the fixture puts it where drawer code could not have guessed it: on the IPv6 and
// channel offset entries, one per backend, while the DAC bits entry carries the owner's whole DAC bits paragraph
// (docs/copy-before-after.md, DAC bits tooltip) as its tooltip and no `more`.
//
// Renders through preact-render-to-string with the store driven at the wire by the staging fake. Rows are found by their
// catalog key (`data-k`), the trigger by its `data-testid`, the popover by its `role`.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-output-seemore.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Drawer } from "../../../../hqptuner/static/components/faceplate/drawer/Drawer.js";
import { OUTPUT_BLOCKS, OUTPUT_DRAWER } from "../../../../hqptuner/static/components/faceplate/drawers/output.js";
import { config, engineState, engineStatus, enums, metadata } from "../../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../../hqptuner/static/store/actions.js";
import { openPopover, openStage } from "../../../../hqptuner/static/store/faceplate/view.js";
import { pickChannelLayout } from "../../../../hqptuner/static/store/faceplate/drawers/output.js";
import { stagingWire } from "../../support/wire/wire.js";
import { attr, classes, elements, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */

/** The owner's whole DAC bits paragraph, handed to the DAC bits entry as its tooltip with no `more` beside it. */
const DAC_BITS_PARAGRAPH =
  "Number of significant bits the DAC has; this is the dithering level. 0 auto-detects. When the DAC is connected to " +
  "a unidirectional interface like S/PDIF, AES/EBU or I2S, it is important to select the correct number of bits. In " +
  "addition, when a DAC is connected to USB and has something other than 32-bit input resolution, it is recommended to " +
  "set the actual value here. Also, when a suitable noise-shaper, such as LNS15, NS9 or NS5, is used in combination " +
  "with high output rates, linearity errors inherent to all R2R DACs can be corrected. This will lower the distortion " +
  "of especially low-level signals and reduce zero-crossing distortions.";

/** The metadata entries that carry `more`, keyed by the row each one describes. */
const MARKED = {
  net_ipv6: {
    entry: "ipv6",
    tooltip: "Start of the IPv6 fixture paragraph",
    more: "Prose the IPv6 fixture entry holds back.",
  },
  alsa_offset: {
    entry: "channel_offset",
    tooltip: "Start of the channel offset fixture paragraph",
    more: "Prose the channel offset fixture entry holds back.",
  },
};

/** The rows whose entry carries `more`. */
const MARKED_ROWS = Object.keys(MARKED);

/** The DAC bits row of each backend, whose entry carries no `more`. */
const DAC_BITS_ROWS = ["net_bits", "alsa_bits"];

/** The settings metadata keys the Output drawer's rows read their paragraphs from. */
const OUTPUT_META_KEYS = [
  "output_mode",
  "dop",
  "dsd_48k",
  "dac_bits",
  "backend",
  "ipv6",
  "buffer_time",
  "channel_offset",
  "net_device",
  "alsa_device",
];

/** @type {Record<string, { label: string, tooltip: string, more?: string }>} */
const OUTPUT_META = Object.fromEntries(
  OUTPUT_META_KEYS.map((k) => [k, { label: "label-fixture", tooltip: `Tooltip fixture for ${k}` }]),
);
OUTPUT_META.dac_bits = { label: "label-fixture", tooltip: DAC_BITS_PARAGRAPH };
for (const { entry, tooltip, more } of Object.values(MARKED))
  OUTPUT_META[entry] = { label: "label-fixture", tooltip, more };

const META = {
  settings: {
    output: OUTPUT_META,
    dsp: { channels: { label: "label-fixture", tooltip: "Tooltip fixture for channels" } },
  },
};

const NET = "naa-office/hw:CARD=sndrpihifiberry,DEV=0";
const ALSA = "hw:CARD=NVidia,DEV=3";

beforeEach(async () => {
  stagingWire();
  config.value = {
    fields: [
      { name: "mode", type: "select", value: "pcm" },
      { name: "backend", type: "select", value: "combo" },
      { name: "defaults_samplerate", type: "select", value: "192000" },
      { name: "defaults_bitrate", type: "select", value: "12288000" },
      { name: "channels", type: "number", value: 2 },
      { name: "net_device", type: "select", value: NET, options: [{ value: NET, label: "naa-office: card: iface" }] },
      { name: "alsa_device", type: "select", value: ALSA, options: [{ value: ALSA, label: "HDA NVidia: HDMI 0" }] },
      { name: "net_dop", type: "checkbox", value: false },
      { name: "alsa_dop", type: "checkbox", value: false },
      { name: "net_anydsd", type: "checkbox", value: true },
      { name: "alsa_anydsd", type: "checkbox", value: false },
      { name: "net_bits", type: "number", value: 20 },
      { name: "alsa_bits", type: "number", value: 24 },
      { name: "net_ipv6", type: "checkbox", value: true },
      { name: "alsa_offset", type: "number", value: 0 },
      { name: "net_period", type: "number", value: 0 },
      { name: "alsa_period", type: "number", value: 100 },
    ],
    file: {},
    active: "",
    profiles: null,
    device_caps: null,
    autosave: true,
  };
  engineState.value = { state: "0" };
  engineStatus.value = { status: {}, metadata: {} };
  enums.value = null;
  metadata.value = META;
  openStage.value = null;
  openPopover.value = null;
  await pickChannelLayout("2");
  await discardAll();
});

/** Every row the drawer draws, each with its own markup. */
const rows = () =>
  elements(render(html`<${Drawer} schema=${OUTPUT_DRAWER} blocks=${OUTPUT_BLOCKS} />`)).filter(
    (e) => classes(e).includes("drow") && attr(e, "data-k") !== undefined,
  );

/**
 * The elements inside the row drawn for `key`.
 *
 * @param {string} key
 * @returns {MarkupElement[]}
 */
function inRow(key) {
  const row = rows().find((e) => attr(e, "data-k") === key);
  return row ? elements(row.html) : [];
}

/** @param {MarkupElement} e */
const isTrigger = (e) => attr(e, "data-testid") === "see-more";

/** @param {MarkupElement} e */
const isPopover = (e) => attr(e, "role") === "dialog";

/**
 * Whether `inner` lies inside `outer`.
 *
 * @param {MarkupElement} inner
 * @param {MarkupElement} outer
 */
const within = (inner, outer) => inner.start >= outer.start && inner.start < outer.start + outer.html.length;

/** Spaces, full stops and ellipses at either end carry no words. */
const WORDLESS = " .…";

/** `s` less its wordless ends. @param {string} s */
function words(s) {
  let start = 0;
  let end = s.length;
  while (start < end && WORDLESS.includes(s[start])) start += 1;
  while (end > start && WORDLESS.includes(s[end - 1])) end -= 1;
  return s.slice(start, end);
}

/** @param {string} h */
const textOf = (h) => text({ name: "p", attrs: "", start: 0, html: h });

/**
 * The paragraphs a row shows in sight, outside any popover.
 *
 * @param {MarkupElement[]} inside
 * @returns {MarkupElement[]}
 */
function inSight(inside) {
  const popovers = inside.filter(isPopover);
  return inside.filter((e) => e.name === "p" && !popovers.some((pop) => within(e, pop)));
}

/**
 * The description a row shows in sight, less the see-more trigger's own text.
 *
 * @param {string} key
 * @returns {string}
 */
function shownDescription(key) {
  const inside = inRow(key);
  const triggers = inside.filter(isTrigger);
  return words(
    inSight(inside)
      .map((p) => triggers.filter((t) => within(t, p)).reduce((h, t) => h.replace(t.html, ""), p.html))
      .map(textOf)
      .join(" "),
  );
}

/**
 * The description a row shows in sight, read on either side of its see-more trigger: the words before it and the
 * words after it. With no trigger in sight, `after` is null and `before` is the whole description.
 *
 * @param {string} key
 * @returns {{ before: string, after: string | null }}
 */
function aroundTrigger(key) {
  const inside = inRow(key);
  const shown = inSight(inside);
  const trigger = inside.find((e) => isTrigger(e) && shown.some((p) => within(e, p)));
  if (!trigger) return { before: shownDescription(key), after: null };
  const side = (/** @type {(p: MarkupElement) => string} */ cut) => words(shown.map(cut).map(textOf).join(" "));
  const end = trigger.start + trigger.html.length;
  return {
    before: side((p) => (p.start < trigger.start ? p.html.slice(0, trigger.start - p.start) : "")),
    after: side((p) => (p.start + p.html.length > end ? p.html.slice(Math.max(0, end - p.start)) : "")),
  };
}

/**
 * The text of the paragraphs inside a row's see-more popover.
 *
 * @param {string} key
 * @returns {string}
 */
function popoverText(key) {
  const pop = inRow(key).find(isPopover);
  return pop
    ? elements(pop.html)
        .filter((e) => e.name === "p")
        .map(text)
        .join(" ")
    : "";
}

test("test_the_rows_with_a_see_more_trigger_are_the_rows_whose_metadata_entry_carries_more", () => {
  const withTrigger = rows()
    .filter((row) => elements(row.html).some(isTrigger))
    .map((row) => attr(row, "data-k"))
    .sort();
  assert.deepEqual(withTrigger, [...MARKED_ROWS].sort());
});

for (const [key, { tooltip }] of Object.entries(MARKED)) {
  test(`test_the_${key}_row_shows_its_tooltip_and_then_the_see_more_trigger`, () => {
    assert.deepEqual(aroundTrigger(key), { before: words(tooltip), after: "" });
  });
}

for (const [key, { more }] of Object.entries(MARKED)) {
  test(`test_the_${key}_rows_see_more_popover_holds_its_more_prose`, () => {
    assert.equal(popoverText(key), more);
  });
}

for (const key of DAC_BITS_ROWS) {
  test(`test_the_${key}_row_whose_entry_carries_no_more_shows_its_tooltip_whole`, () => {
    assert.equal(shownDescription(key), words(DAC_BITS_PARAGRAPH));
  });
}
