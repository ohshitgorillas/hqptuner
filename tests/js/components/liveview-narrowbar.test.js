// Behavioral suite for the narrow bar as the LIVE page mounts it
// (components/live/View.js): the page's chain cards have no "DSD Sources"
// subsection, so the bar's "Source format" group has nothing to disclose there
// and the page offers it no more.
//
// This is the user-visible half of the change. The mechanism — the bar's own
// `srcFormat` prop, and the Reset button following the filter-only predicate —
// is pinned by tests/js/components/narrowbar-srcformat-prop.test.js; what is
// pinned here is that the LIVE page is a caller that turns it off.
//
// The sibling case is the anchor: the page still offers the "1x sources" group,
// so a page that rendered no narrow bar at all — or nothing at all — fails
// rather than passing the absence below for free.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. The page is driven by the exported store signals carrying the shapes
// /api/state, /api/enumerations and /api/matrix actually serve, over a faked
// wire on the real REST paths. Nothing of HQPTuner's is stubbed.
//
// The bar is read through tests/js/support/narrowbarview.js, which scans by tag
// balance: a group is "the smallest element that reads that title and encloses a
// segmented switch". That names what a reader sees rather than the classes the
// component happens to use.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/liveview-narrowbar.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { LiveView } from "../../../hqptuner/static/components/live/View.js";
import { health, engineState, enums, config, matrixConfig, metadata } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { liveMode } from "../../../hqptuner/static/store/prefs.js";
import { resetNarrowing, nSrcFormat } from "../../../hqptuner/static/store/narrow/state.js";
import { staticWire } from "../support/wire.js";
import { hasGroup, mentions, resets } from "../support/narrowbarview.js";

// The engine's own `<GetFilters/>` enumeration (protocol.md:226), rated so that
// no facet at its default trims the list, plus the smallest `<State/>` the page
// needs to have a loaded PCM chain to draw cards for.
const ENGINE = {
  enumerations: {
    mode: { name: "PCM" },
    rates: [{ index: "0", rate: "96000" }],
    shapers: [{ index: "0", value: "0", name: "none" }],
    junk_filters: [{ index: "0", value: "0", name: "none" }],
    filters: [
      { index: "0", value: "0", name: "none", arg: 1, description: "5/5 timbre ⥮ Any" },
      { index: "1", value: "40", name: "poly-sinc-gauss-long", arg: 1, description: "5/5 timbre ⥮ Any" },
    ],
  },
  state: { mode: "1", active_chain: "pcm", filter1x: "0", filterNx: "1", shaper: "0", rate: "0" },
};

// Module-level signals outlive a test, so every signal this page reads to draw
// its chain cards is put back, not just the ones a case cares about. `srcFormat`
// is applied AFTER resetNarrowing(), which is what a user moving the control
// does: every other facet stays at its default, so anything the page shows is
// that one facet's doing.
/**
 * @param {{ srcFormat?: string }} [facets]
 * @returns {Promise<string>}
 */
async function openLivePage({ srcFormat = "pcm" } = {}) {
  staticWire({ live: {}, http: {} });
  health.value = { reachable: true, info: {} };
  engineState.value = ENGINE.state;
  enums.value = ENGINE.enumerations;
  metadata.value = {
    settings: {},
    filters: { filters: {}, aliases: {} },
    shapers: { pcm_dithers: {}, sdm_modulators: {} },
  };
  config.value = { fields: [], file: {}, active: "", profiles: null };
  matrixConfig.value = { fields: [] };
  liveMode.value = true;
  resetNarrowing();
  nSrcFormat.value = srcFormat;
  await discardAll();
  return render(html`<${LiveView} />`);
}

// The heading a group prints is the owner's; the id its element carries is
// contract (docs/testing.md rule 9), so the group lookups below use the id.
const SOURCE_FORMAT = "Source format";
const SOURCE_FORMAT_GROUP = "source-format";

test("test_the_live_page_offers_the_1x_sources_group", async () => {
  assert.equal(hasGroup(await openLivePage(), "1x-sources"), true);
});

// Both readings together: the group's shape AND its wording. Either alone would
// also answer no for a control that is still on screen and has merely stopped
// being a segmented switch.

test("test_the_live_page_offers_no_source_format_group", async () => {
  const out = await openLivePage();
  const seen = { group: hasGroup(out, SOURCE_FORMAT_GROUP), wording: mentions(out, SOURCE_FORMAT) };
  assert.deepEqual(seen, { group: false, wording: false });
});

// The group's absence and the Reset button's are separate promises: a page that
// suppressed the control by some other route would keep the case above green
// while its Reset still answered to a facet the user cannot see.

test("test_the_live_page_offers_no_reset_for_source_format_alone", async () => {
  assert.equal(resets(await openLivePage({ srcFormat: "both" })), 0);
});
