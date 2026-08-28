// The geometry the DROPDOWN's apodizing badge draws, per class — the anchor
// Easy Mode's tile marks are read against.
//
// Not a *.test.js file on purpose: the runner glob would execute it.
//
// WHY IT EXISTS. A tile-only reading can say "the three classes draw three
// different marks" but never which of the three is which: an implementation
// that drew the crossed A for full and the circled A for none satisfies every
// such case. Naming one by its path data would put baked vector geometry in a
// test, which breaks the first time a designer nudges a curve. So identity is
// borrowed instead: the badge on a filter dropdown's row has drawn the full and
// half glyphs since long before Easy Mode had tiles, and
// tests/js/components/combobox-apod.test.js pins that it does. A tile mark that
// matches it is the same mark; one that does not has swapped two forms.
//
// The fixture is the Standard-style one that suite uses — one filter of each
// class, its class stated BOTH ways the real wire states it (the enumeration's
// `arg` bitfield and the static overlay's `apodizing` fact), so nothing here
// depends on which half of the union a reader consults.
//
// SIGNALS ARE LEFT AS FOUND where a caller could care: the dropdown fixture runs
// in Standard style, which is the default, so a suite that renders an Easy Mode
// card afterwards meets no preference this module moved.

import { enums } from "../../../hqptuner/static/store/signals.js";
import { nApod1x, nQuality } from "../../../hqptuner/static/store/narrow/state.js";

import { reset, field, META } from "./field-harness.js";
import { rowIncluding } from "./comborows.js";
import { elements, classes, attr } from "./markup.js";

/** @typedef {import("./markup.js").MarkupElement} MarkupElement */

// The class the mark wears, shared by the dropdown badge and the tile mark.
const MARK = "apod-mark";

// One filter of each class. Names and `arg` bits are wire identifiers; the row
// each is read by is its own `data-v`, which is its index here.
/** @type {[string, string, string][]} name, enum arg, overlay class */
const ROWS = [
  ["full-a", "1", "full"],
  ["half-a", "2", "half"],
  ["plain-a", "0", "none"],
];

const [FULL_ROW, HALF_ROW] = ROWS.map((_, i) => String(i));

const FIELDS = [
  {
    name: "filter1x",
    value: "0",
    options: ROWS.map(([label], i) => ({ value: String(i), label })),
  },
];

// The live enumeration's own shape: `arg` a string bitfield, `apodizing` the
// decoded bit 0, every row rated above the quality facet's floor.
const ENUMS = {
  filters: ROWS.map(([name, arg], i) => ({
    index: String(i),
    name,
    value: String(i),
    arg,
    description: "5/5 ⥮ Any",
    apodizing: arg === "1",
  })),
};

// The static overlay's half of the same union.
const OVERLAY = {
  ...META,
  filters: {
    ...META.filters,
    filters: {
      ...META.filters.filters,
      ...Object.fromEntries(ROWS.map(([name, , apodizing]) => [name, { apodizing }])),
    },
  },
};

/**
 * The one <path> of the badge inside one option row; anything but exactly one
 * badge, or one path in it, throws.
 *
 * @param {string} out
 * @param {string} value
 * @returns {string | undefined}
 */
function badgePath(out, value) {
  const row = rowIncluding(out, value);
  const end = row.start + row.html.length;
  const found = elements(out).filter(
    (el) => classes(el).includes(MARK) && el.start >= row.start && el.start + el.html.length <= end,
  );
  if (found.length !== 1) throw new Error(`expected one badge in the row "${value}", found ${found.length}`);
  const paths = elements(found[0].html).filter((el) => el.name === "path");
  if (paths.length !== 1) throw new Error(`expected one path in the row "${value}" badge, found ${paths.length}`);
  return attr(paths[0], "d");
}

/**
 * The geometry the dropdown badge draws for a full-apodizing row and for a
 * half-apodizing one. A class of its own is not offered: a row of neither class
 * wears no badge at all, which is the dropdown's rule and not the tile's.
 *
 * @returns {Promise<{ full: string | undefined, half: string | undefined }>}
 */
export async function dropdownGlyphs() {
  await reset({ fields: FIELDS, meta: OVERLAY });
  enums.value = ENUMS;
  nApod1x.value = "all";
  nQuality.value = 0;
  const out = field("pcm_filter_1x");
  return { full: badgePath(out, FULL_ROW), half: badgePath(out, HALF_ROW) };
}
