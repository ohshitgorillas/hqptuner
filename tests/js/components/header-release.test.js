// Behavioral suite for the chrome header's daemon-identity line —
// components/Header.js — on WHICH version string it prints.
//
// /api/health carries three separately-numbered strings: `info.engine` is the
// DSP engine build, `release` is the HQPlayer release the daemon reports
// installed (tests/api/test_release_fetch.py), and `app_version` is HQPTuner's
// own package version. The identity line names the daemon and its RELEASE, so a
// daemon reporting engine 6.0.4 and release 6.0.2 reads "v6.0.2".
//
// Policy (docs/testing.md): public API only, one assertion per test. The header
// is a pure function of exported store signals, so every case drives them
// directly; `head()` reassigns all of them on every call, because module-level
// signals outlive a test and a partial reset makes cases pass alone and fail in
// sequence.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/header-release.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Header } from "../../../hqptuner/static/components/Header.js";
import { cancel } from "../../../hqptuner/static/store/ask.js";
import { health, engineState, config, pendingPreset } from "../../../hqptuner/static/store/signals.js";

// The two identity spans, in render order.
const NAME = 0;
const VERSION = 1;

/** @param {Record<string, unknown> | null} snapshot */
function head(snapshot) {
  cancel();
  health.value = snapshot;
  engineState.value = {};
  config.value = { fields: [], file: {}, active: "", profiles: null };
  pendingPreset.value = null;
  return render(html`<${Header} />`);
}

/** @param {string} out */
const daemon = (out) => out.split('<div class="daemon">')[1].split("</div>")[0];

// The identity spans' text, in render order. A header carrying no identity at
// all raises rather than reporting an empty list, so "shows no version" can
// never be answered by markup that simply moved.
/** @param {string} out */
function idents(out) {
  const found = [...daemon(out).matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);
  if (found.length === 0) throw new Error("the rendered header carries no daemon identity");
  return found;
}

// The daemon on this host as /api/health serves it: the engine build and the
// installed release are DIFFERENT numbers, so a line reading either one can be
// told apart from a line reading the other.
const REPORTED = {
  reachable: true,
  info: { name: "hqplayerd", engine: "6.0.4" },
  release: "6.0.2",
  app_version: "1.5.0",
};

test("test_the_installed_release_is_shown_with_a_v_prefix", () => {
  assert.equal(idents(head(REPORTED))[VERSION], "v6.0.2");
});

test("test_the_dsp_engine_build_is_not_shown_as_the_daemon_version", () => {
  assert.equal(idents(head(REPORTED))[VERSION].includes("6.0.4"), false);
});

// The daemon's /about page is the release's only source and can be unreachable
// or unparsable; the API answers "" for it then (tests/api/test_release_fetch.py).
// A bare "v", or a quiet fall back to the engine build, both misreport.

test("test_an_empty_release_shows_no_version_at_all", () => {
  assert.equal(idents(head({ ...REPORTED, release: "" }))[VERSION], "");
});

test("test_a_health_snapshot_carrying_no_release_shows_no_version_at_all", () => {
  assert.equal(idents(head({ reachable: true, info: { name: "hqplayerd", engine: "6.0.4" } }))[VERSION], "");
});

test("test_the_daemon_name_is_still_shown_beside_the_release", () => {
  assert.equal(idents(head(REPORTED))[NAME], "hqplayerd");
});
