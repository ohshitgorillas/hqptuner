// Behavioral suite for group expand/collapse on the Simplified chain dropdowns
// (controls/Combobox.js `collapse`, wired by binder.js for the
// `plainNames`-carrying entries through the prefs store's `collapsedGroups` /
// `toggleCollapsedGroup`): a family header and a variant subheader render as
// toggles, expanded by default; activating one removes that group's contents —
// blurb, option rows and variant containers for a family, its own rows for a
// variant — while the header itself remains, and activating it again restores
// them. The state is shared per dropdown kind through the prefs store, so a
// family collapsed in one filter dropdown is collapsed in the next filter
// dropdown rendered. Standard option style has no groups: its flat list
// ignores stored collapse state entirely.
//
// A header is found as the element carrying `aria-expanded` (the closed dd-box
// button excepted) whose text reads the FIXTURE's own family or variant name —
// invented test data, never a word the component supplies — and it is activated
// the way combobox-fav.test.js clicks a star: through the onClick its vnode
// carries, collected via preact's own `options.vnode` creation hook. What the
// dropdown OFFERS is read off the `data-v` wire value each row carries, never
// off the labels or their order (docs/testing.md rule 9). The pop is hidden
// rather than unmounted, so removal is observable in the closed render.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire; module-level signals persist, so every case resets the collapse
// state alongside the harness's own reset.
//
// NOT covered here (SSR reaches the closed state only): keyboard navigation
// skipping collapsed rows, the pop staying open across a toggle, and highlight
// fallback after a collapse — browser hand-back territory.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/combobox-collapse.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { reset, field, META } from "../support/field-harness.js";
import { renderField, textOf } from "../support/vnodeseam.js";
import { elements, classes, attr, text } from "../support/markup.js";
import { rows } from "../support/comborows.js";
import { plainNames, collapsedGroups, toggleCollapsedGroup } from "../../../hqptuner/static/store/prefs.js";
import { nApod1x, nApodNx, nQuality } from "../../../hqptuner/static/store/narrow/state.js";

/** @typedef {import("../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../support/wheel.js").VNode} VNode */

// The module-load default of the collapse store — everything expanded —
// snapshotted before any case toggles, and restored (as a fresh clone, so a
// toggle mutating in place cannot poison it) by every reset.
const EMPTY_COLLAPSE = structuredClone(collapsedGroups.value);

// --- the plain-names data -----------------------------------------------------
// The grouping combobox-plainnames.test.js pins — family Gauss with two
// variants, single-row families Sinc and Ext, two unknown tails — with a
// family blurb on Gauss so a collapse observably removes it, and every entry
// classified `apod: "none"` so no badge wording rides the headers or rows.

const GAUSS_BLURB = "Bells of every width";

// The fixture's own family and variant names, which are what the header
// toggles are located by. No `short` below repeats the family name, so the
// closed control's own text can never be mistaken for a family header.
const FAMILY = "Gauss";
const VARIANT = "Zed tap";

/**
 * @param {string} family
 * @param {string | null} variant
 * @param {string} leaf
 * @param {string} short
 */
const entry = (family, variant, leaf, short) => ({ family, variant, leaf, short, apod: "none" });

const META_COLLAPSE = {
  ...META,
  plain_names: {
    filters: {
      entries: {
        "sinc-M": entry("Sinc", null, "Classic M", "Sinc M"),
        "poly-sinc-gauss-zeta": entry(FAMILY, VARIANT, "Zeta pick", "Zeta short"),
        "poly-sinc-gauss-long": entry(FAMILY, VARIANT, "Alpha pick", "Reg short"),
        "poly-sinc-gauss-short": entry(FAMILY, "Alpha tap", "Shorter", "Tiny short"),
        "poly-sinc-ext2": entry("Ext", null, "Ext Two", "Ext 2"),
      },
      families: { [FAMILY]: GAUSS_BLURB },
      variants: {},
    },
    dithers: { entries: {}, families: {}, variants: {} },
    modulators: { entries: {}, families: {}, variants: {} },
  },
};

const RAW_ORDER = [
  "poly-sinc-gauss-short",
  "unknown-b",
  "poly-sinc-gauss-long",
  "sinc-M",
  "poly-sinc-ext2",
  "unknown-a",
  "poly-sinc-gauss-zeta",
];

// What the dropdown offers, as the SET of wire values its rows carry: each
// option is offered under its index in RAW_ORDER. A set, sorted, rather than a
// sequence — the display ORDER of a grouped list is presentation, and rule 9
// keeps it out of an assertion the same way the labels are kept out.
const ALL_VALUES = RAW_ORDER.map((_, i) => String(i)).sort();
// Gauss holds indices 0 (short / Alpha tap), 2 and 6 (Zed tap).
const WITHOUT_GAUSS = ["1", "3", "4", "5"];
const WITHOUT_ZED_TAP = ["0", "1", "3", "4", "5"];

/**
 * The wire values a rendered dropdown offers, sorted.
 *
 * @param {string} out
 * @returns {(string | undefined)[]}
 */
const offered = (out) =>
  rows(out)
    .map((r) => attr(r, "data-v"))
    .sort();

// Both PCM filter dropdowns, so the shared-state case can collapse in one and
// read the other; the daemon names the two slots `filter1x` and `filter`.
const FIELDS = ["filter1x", "filter"].map((name) => ({
  name,
  value: "0",
  options: RAW_ORDER.map((label, i) => ({ value: String(i), label })),
}));

/** @param {{ plain?: boolean }} [state] */
async function setup({ plain = true } = {}) {
  await reset({ fields: FIELDS, meta: META_COLLAPSE });
  nApod1x.value = "all";
  nApodNx.value = "all";
  nQuality.value = 0;
  collapsedGroups.value = structuredClone(EMPTY_COLLAPSE);
  plainNames.value = plain;
}

/**
 * Activate the header toggle reading `wording` in a fresh render of field `k`:
 * the DEEPEST clickable vnode whose subtree text includes the wording —
 * children are built before parents, so the first match collected is the
 * innermost. Throws when nothing clickable reads it.
 *
 * @param {string} k
 * @param {string} wording
 */
function activateHeader(k, wording) {
  const { seen } = renderField(k);
  const toggle = seen.find((v) => v && v.props && typeof v.props.onClick === "function" && textOf(v).includes(wording));
  if (!toggle) throw new Error(`nothing clickable reads "${wording}"`);
  /** @type {(event: object) => void} */ (toggle.props.onClick)({ preventDefault() {}, stopPropagation() {} });
}

/**
 * The aria-expanded value of the header reading `wording` — the element
 * carrying the attribute whose text includes the wording. Throws when no such
 * element renders, so a vanished header fails loudly.
 *
 * @param {string} out
 * @param {string} wording
 */
function expandedState(out, wording) {
  const hit = elements(out).find(
    (el) => /aria-expanded="/.test(el.attrs) && !classes(el).includes("dd-box") && text(el).includes(wording),
  );
  if (!hit) throw new Error(`no aria-expanded element reads "${wording}"`);
  return (/aria-expanded="([^"]*)"/.exec(hit.attrs) || [])[1];
}

/**
 * Whether anything rendered reads `wording`.
 *
 * @param {string} out
 * @param {string} wording
 */
const renders = (out, wording) => elements(out).some((el) => text(el).includes(wording));

// --- the defaults ---------------------------------------------------------------

test("test_a_family_header_toggle_is_expanded_by_default", async () => {
  await setup();
  assert.equal(expandedState(field("pcm_filter_1x"), FAMILY), "true");
});

test("test_a_variant_subheader_toggle_is_expanded_by_default", async () => {
  await setup();
  assert.equal(expandedState(field("pcm_filter_1x"), VARIANT), "true");
});

// --- collapsing a family ----------------------------------------------------------

test("test_collapsing_a_family_removes_its_option_rows", async () => {
  await setup();
  activateHeader("pcm_filter_1x", FAMILY);
  assert.deepEqual(offered(field("pcm_filter_1x")), WITHOUT_GAUSS);
});

test("test_collapsing_a_family_removes_its_blurb", async () => {
  await setup();
  activateHeader("pcm_filter_1x", FAMILY);
  assert.equal(renders(field("pcm_filter_1x"), GAUSS_BLURB), false);
});

test("test_collapsing_a_family_removes_its_variant_subheaders", async () => {
  await setup();
  activateHeader("pcm_filter_1x", FAMILY);
  assert.equal(renders(field("pcm_filter_1x"), VARIANT), false);
});

test("test_a_collapsed_family_header_remains_and_reads_collapsed", async () => {
  await setup();
  activateHeader("pcm_filter_1x", FAMILY);
  assert.equal(expandedState(field("pcm_filter_1x"), FAMILY), "false");
});

test("test_activating_a_collapsed_family_header_restores_its_rows", async () => {
  await setup();
  activateHeader("pcm_filter_1x", FAMILY);
  activateHeader("pcm_filter_1x", FAMILY);
  assert.deepEqual(offered(field("pcm_filter_1x")), ALL_VALUES);
});

// --- collapsing a variant ---------------------------------------------------------

test("test_collapsing_a_variant_removes_only_that_variants_rows", async () => {
  await setup();
  activateHeader("pcm_filter_1x", VARIANT);
  assert.deepEqual(offered(field("pcm_filter_1x")), WITHOUT_ZED_TAP);
});

test("test_a_collapsed_variant_subheader_remains_and_reads_collapsed", async () => {
  await setup();
  activateHeader("pcm_filter_1x", VARIANT);
  assert.equal(expandedState(field("pcm_filter_1x"), VARIANT), "false");
});

// --- the state is shared per dropdown kind ----------------------------------------

test("test_a_family_collapsed_in_one_filter_dropdown_is_collapsed_in_the_next", async () => {
  await setup();
  activateHeader("pcm_filter_1x", FAMILY);
  assert.deepEqual(offered(field("pcm_filter_nx")), WITHOUT_GAUSS);
});

// --- Standard style has no groups to collapse --------------------------------------

test("test_standard_style_keeps_the_flat_list_despite_stored_collapse_state", async () => {
  await setup({ plain: false });
  toggleCollapsedGroup("filters|Gauss");
  assert.deepEqual(offered(field("pcm_filter_1x")), ALL_VALUES);
});

test("test_standard_style_renders_no_header_toggle", async () => {
  await setup({ plain: false });
  // The closed combobox button (dd-box) is the one legitimate aria-expanded
  // carrier of a Standard render; nothing else may carry the attribute.
  const others = elements(field("pcm_filter_1x")).filter(
    (el) => /aria-expanded="/.test(el.attrs) && !/\bclass="[^"]*\bdd-box\b/.test(el.attrs),
  );
  assert.deepEqual(others, []);
});

// --- the prefs store itself ----------------------------------------------------------
// Read off FRESH instances imported under `.fresh-<tag>.js` specifiers
// (tests/js/support/vendor-resolve.js), so each case holds wherever it runs in
// the file — this process has no localStorage, which IS the storage-unset
// case. Membership is read shape-agnostically: absence of the key means
// expanded, whatever the signal holds keys in.

const PREFS_MODULE = new URL("../../../hqptuner/static/store/prefs.js", import.meta.url).href;

/** @param {string} tag */
const freshPrefs = (tag) => import(`${PREFS_MODULE.replace(/\.js$/, `.fresh-${tag}.js`)}`);

/**
 * Whether the collapse store holds `key` collapsed.
 *
 * @param {unknown} value
 * @param {string} key
 */
function holds(value, key) {
  if (value instanceof Set || value instanceof Map) return value.has(key);
  if (Array.isArray(value)) return value.includes(key);
  return Boolean(value && typeof value === "object" && /** @type {Record<string, unknown>} */ (value)[key]);
}

test("test_collapsed_groups_default_to_everything_expanded", async () => {
  const fresh = await freshPrefs("collapse-default");
  assert.equal(holds(fresh.collapsedGroups.value, "filters|Polyphase sinc"), false);
});

test("test_toggling_a_group_key_marks_it_collapsed", async () => {
  const fresh = await freshPrefs("collapse-once");
  fresh.toggleCollapsedGroup("filters|Polyphase sinc");
  assert.equal(holds(fresh.collapsedGroups.value, "filters|Polyphase sinc"), true);
});

test("test_toggling_the_same_key_twice_returns_to_expanded", async () => {
  const fresh = await freshPrefs("collapse-twice");
  fresh.toggleCollapsedGroup("filters|Polyphase sinc");
  fresh.toggleCollapsedGroup("filters|Polyphase sinc");
  assert.equal(holds(fresh.collapsedGroups.value, "filters|Polyphase sinc"), false);
});
