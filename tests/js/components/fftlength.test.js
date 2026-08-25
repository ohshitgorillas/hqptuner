// Behavioral suite for the FFT filter length setting (`fft_size`) as it renders
// on the Output tab: no card of its own any more, but a detented slider standing
// inside whichever CHAIN card is actually using an FFT filter.
//
// Everything here goes through the exported `Output`, driven by the exported
// store signals (`config` carrying the daemon's own /config form) over a faked
// wire on the real REST paths. Nothing is stubbed. The pure index/value
// arithmetic behind it (`stepIndex`, `stepValue`) is detents.test.js's subject.
//
// Policy (docs/testing.md): public API only, one assertion per test.
//
// The daemon is the enumeration authority, so NOTHING below hardcodes the option
// list, its length or its bounds: every expected count is derived from the very
// option list the case feeds in, and the list here is deliberately five long
// rather than the live daemon's eight, so an implementation keyed to the live
// count fails.
//
// Cards are addressed by the `data-card` their <section> carries and fields by
// the `data-k` their wrapper carries — machine identity, never the words in a
// head or a label (docs/testing.md rule 9). The slider's own two marks, the
// `tick` and the `slider-val` readout, are pre-existing shared control
// primitives (css/controls/sliders.css) and stand on the same footing.
//
// State reset is total on every call — module-level signals, including the
// narrowing facets the filter dropdowns read, outlive a test.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/fftlength.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Output } from "../../../hqptuner/static/components/tabs/OutputTab.js";
import { config, matrixConfig, metadata, engineState, enums } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrow/state.js";
import { stagingWire } from "../support/wire.js";
import { formFields, section } from "../support/tabform.js";
import { attr, classes, elements, keyed, text } from "../support/markup.js";

/** @typedef {import("../support/tabform.js").FieldSpec} FieldSpec */
/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */

/**
 * @param {{ cfg?: Record<string, FieldSpec>, mode?: string }} [opts]
 * @returns {Promise<void>}
 */
async function reset({ cfg = {}, mode = "auto" } = {}) {
  stagingWire();
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  showDescriptions.value = true;
  keepOptionDescriptions.value = true;
  resetNarrowing();
  matrixConfig.value = { fields: [] };
  config.value = { fields: formFields(cfg), file: { mode }, active: "", profiles: null };
  await discardAll();
}

const tab = () => render(html`<${Output} />`);

const PCM = "pcm-chain";
const SDM = "sdm-chain";
// The card this change removes, named only so its ABSENCE can be asserted — and
// asserted on the raw attribute rather than through a card reader, so a card
// resurrected as some element other than a <section> is caught too.
/** @param {string} out */
const carriesLengthCard = (out) => /\sdata-card="filter-length"/.test(out);

// The daemon's own fft_size option list, as `GET /config` hands it over: a
// `select` whose option values are STRINGS (docs/protocol.md:76). Five entries,
// not the live eight — the count is the test's to state, and every expectation
// below is derived from it.
//
// An option's label is a separate field from its value, and only the VALUE is
// the token the wire carries, so the option the readout cases run through is
// given a label that differs from it.
const SIZES = ["128", "256", "512", "1024", "2048"];
const LABELED = "512";
/** @type {{ value: string, label: string }[]} */
const OPTIONS = SIZES.map((value) => ({ value, label: value === LABELED ? `${value} (default)` : value }));
const FFT_SIZE = { value: "512", options: OPTIONS };

/**
 * @param {string} value
 * @param {string} label
 */
const opt = (value, label) => ({ value, options: [{ value, label }] });

// A filter list offering both a plain filter and an FFT one, so a slot can be
// shown to SELECT the FFT entry or merely to offer it. Enum ids are the
// engine's and volatile between versions; the engine NAME is what marks a
// filter as FFT-family (HQPlayer manual §4.7, data/filters.json:97).
const FFT_LIST = [
  { value: "1", label: "poly-sinc-gauss-long" },
  { value: "7", label: "sinc-L (FFT)" },
];
const FFT = { value: "7", options: FFT_LIST };

// The four filter slots, each on a plain non-FFT filter: the baseline no case
// below needs the length control in.
const CHAINS = {
  filter1x: opt("1", "poly-sinc-gauss-long"),
  filter: opt("2", "poly-sinc-xtr-mp"),
  oversampling1x: opt("3", "poly-sinc-short-mp"),
  oversampling: opt("4", "closed-form-M"),
};

/**
 * The Output tab with the four slots as given and the daemon's fft_size field
 * present on the form throughout — so a case where the control does not render
 * says the tab WITHHELD it, not that the daemon never offered it.
 *
 * @param {Record<string, FieldSpec>} slots
 * @returns {Promise<string>}
 */
async function outputWith(slots) {
  await reset({ cfg: { ...CHAINS, ...slots, fft_size: FFT_SIZE } });
  return tab();
}

// Whether a fragment carries the fft_size field, by the schema key its wrapper
// wears in `data-k` (components/Field.js).
/** @param {string} frag */
const carriesFftSize = (frag) => /\sdata-k="fft_size"/.test(frag);

// --- where the control lands --------------------------------------------------

test("test_no_fft_filter_anywhere_renders_no_filter_length_card", async () => {
  assert.equal(carriesLengthCard(await outputWith({})), false);
});

test("test_no_fft_filter_anywhere_renders_no_fft_size_field", async () => {
  assert.equal(carriesFftSize(await outputWith({})), false);
});

test("test_an_fft_filter_on_the_pcm_1x_slot_puts_the_control_in_the_pcm_chain", async () => {
  assert.equal(carriesFftSize(section(await outputWith({ filter1x: FFT }), PCM)), true);
});

test("test_an_fft_filter_on_a_pcm_slot_leaves_the_sdm_chain_without_the_control", async () => {
  const frag = section(await outputWith({ filter1x: FFT }), SDM);
  assert.ok(frag.length > 0 && !carriesFftSize(frag));
});

test("test_an_fft_filter_on_the_pcm_nx_slot_puts_the_control_in_the_pcm_chain", async () => {
  assert.equal(carriesFftSize(section(await outputWith({ filter: FFT }), PCM)), true);
});

test("test_an_fft_filter_on_the_sdm_1x_slot_puts_the_control_in_the_sdm_chain", async () => {
  assert.equal(carriesFftSize(section(await outputWith({ oversampling1x: FFT }), SDM)), true);
});

test("test_an_fft_filter_on_the_sdm_nx_slot_puts_the_control_in_the_sdm_chain", async () => {
  assert.equal(carriesFftSize(section(await outputWith({ oversampling: FFT }), SDM)), true);
});

test("test_an_fft_filter_in_each_chain_puts_a_control_in_both_chains", async () => {
  const out = await outputWith({ filter1x: FFT, oversampling: FFT });
  assert.ok(carriesFftSize(section(out, PCM)) && carriesFftSize(section(out, SDM)));
});

test("test_an_fft_filter_merely_offered_places_no_control_in_either_chain", async () => {
  // Selected value "1" is the plain filter; the FFT entry is in the list and
  // unchosen. Neither chain may take that for a reason to show the control.
  const out = await outputWith({ filter1x: { value: "1", options: FFT_LIST } });
  const [pcm, sdm] = [section(out, PCM), section(out, SDM)];
  assert.ok(pcm.length > 0 && sdm.length > 0 && !carriesFftSize(pcm) && !carriesFftSize(sdm));
});

// The enum id domain is the engine's and shifts between versions; the engine
// NAME is the contract. The same FFT filter under a different number still
// counts, and the number an FFT filter used to sit on does not.

test("test_an_fft_name_under_an_unfamiliar_enum_id_still_places_the_control", async () => {
  const out = await outputWith({ filter1x: opt("42", "sinc-L (FFT)") });
  assert.equal(carriesFftSize(section(out, PCM)), true);
});

test("test_a_familiar_enum_id_with_a_non_fft_name_places_no_control", async () => {
  const frag = section(await outputWith({ filter1x: opt("7", "poly-sinc-gauss-short") }), PCM);
  assert.ok(frag.length > 0 && !carriesFftSize(frag));
});

// --- the detented slider ------------------------------------------------------

/**
 * The fft_size field's own markup, whole, from the chain card it landed in.
 *
 * @param {Record<string, FieldSpec>} [form]
 * @returns {Promise<string>}
 */
async function fftSizeField(form = {}) {
  await reset({ cfg: { ...CHAINS, filter1x: FFT, fft_size: FFT_SIZE, ...form } });
  return keyed(section(tab(), PCM), "fft_size").html;
}

/**
 * The field's range input — the slider itself, found by its input type rather
 * than by any class or structure around it.
 *
 * @param {string} frag
 * @returns {MarkupElement}
 */
function slider(frag) {
  const hit = elements(frag).find((el) => el.name === "input" && attr(el, "type") === "range");
  if (!hit) throw new Error("the fft_size field carries no range input");
  return hit;
}

/**
 * One element of a fragment carrying a class token, exactly. Anything but a
 * single hit is a broken fixture, not a case.
 *
 * @param {string} frag
 * @param {string} token
 * @returns {MarkupElement}
 */
function marked(frag, token) {
  const hits = elements(frag).filter((el) => classes(el).includes(token));
  if (hits.length !== 1) throw new Error(`expected one .${token} in the fft_size field, found ${hits.length}`);
  return hits[0];
}

test("test_the_fft_size_slider_starts_at_the_first_option", async () => {
  assert.equal(attr(slider(await fftSizeField()), "min"), "0");
});

test("test_the_fft_size_slider_ends_at_the_last_option", async () => {
  assert.equal(attr(slider(await fftSizeField()), "max"), String(OPTIONS.length - 1));
});

test("test_the_fft_size_slider_moves_one_option_at_a_time", async () => {
  assert.equal(attr(slider(await fftSizeField()), "step"), "1");
});

test("test_the_fft_size_slider_carries_one_tick_per_option", async () => {
  const frag = await fftSizeField();
  assert.equal(elements(frag).filter((el) => classes(el).includes("tick")).length, OPTIONS.length);
});

// A stored value the daemon's list does not carry — the config file holding an
// fft_size no current option matches. The slider has to land somewhere, but the
// READOUT reports what is stored: showing the nearest option instead would tell
// the user a value that is not their setting.
test("test_a_stored_fft_size_outside_the_option_list_reads_out_as_stored", async () => {
  const stray = "700";
  const frag = await fftSizeField({ fft_size: { value: stray, options: OPTIONS } });
  assert.equal(text(marked(frag, "slider-val")), stray);
});
