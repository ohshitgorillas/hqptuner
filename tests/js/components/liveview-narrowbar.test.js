// Behavioral suite for the narrow bar as the LIVE page mounts it
// (components/LiveView.js): the page's chain cards have no "DSD Sources"
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
import { LiveView } from "../../../hqptuner/static/components/LiveView.js";
import { health, engineState, enums, config, matrixConfig, metadata } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { liveMode } from "../../../hqptuner/static/store/prefs.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrowing.js";
import { staticWire } from "../support/wire.js";
import { hasGroup } from "../support/narrowbarview.js";

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
// its chain cards is put back, not just the ones a case cares about.
async function openLivePage() {
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
  await discardAll();
  return render(html`<${LiveView} />`);
}

test("test_the_live_page_offers_the_1x_sources_group_above_its_chain_cards", async () => {
  assert.equal(hasGroup(await openLivePage(), "1x sources"), true);
});

test("test_the_live_page_offers_no_source_format_group", async () => {
  assert.equal(hasGroup(await openLivePage(), "Source format"), false);
});
