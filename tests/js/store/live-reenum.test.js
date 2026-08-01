// Behavioral suite for store/live.js's RE-ENUMERATION WINDOW — what a live write
// that makes the engine rebuild its menus does to the lists the page reads, and
// what a write that leaves the menus alone does not do.
//
// SetMode rebuilds the filter and shaper enumerations wholesale, and the rate
// list depends on both the mode and the selected filter (HQPlayer manual §4.6) —
// so `mode`, `filter1x`, `filter`, `oversampling1x`, `oversampling` and `rate`
// leave every menu ID on the page meaning something else than it did. A menu
// entry's ID is only meaningful against the enumeration it came from, so between
// such a write landing and the new lists arriving the page is stale, and the new
// State must not be shown against the old lists.
//
// Policy (docs/testing.md): public API only, one assertion per test, fakes at
// the wire. Every case drives the exported `engineState` / `enums` / `config`
// signals with the shapes /api/state, /api/enumerations and /api/config actually
// serve, and every write goes out over a faked `globalThis.fetch` on the real
// REST path — no store function is ever stubbed.
//
// The three sources are kept apart on purpose: the filter the assertions read is
// enum 25 before the write, 0 if the new State is joined to the OLD list, and 3
// once the new State is joined to the NEW one. So a store that commits the two
// halves separately shows a filter no fixture ever configured.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live-reenum.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { engineState, enums, config } from "../../../hqptuner/static/store/signals.js";
import { liveModel, liveErrors, liveBusy, writeLive } from "../../../hqptuner/static/store/live.js";
import { ok, bad } from "../support/wire.js";

const FILTERS = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "40", name: "poly-sinc-gauss-long" },
  { index: "2", value: "25", name: "sinc-M" },
];
const SHAPERS = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "31", name: "TPDF" },
];
// RatesItem carries no name and no value — `<RatesItem index rate/>` (protocol.md §6).
const RATES = [
  { index: "0", rate: "0" },
  { index: "1", rate: "96000" },
  { index: "2", rate: "192000" },
];
const JUNK = [
  { index: "0", value: "0", name: "none" },
  { index: "1", value: "7", name: "20 kHz" },
];

const ENUMS = () => ({ filters: FILTERS, shapers: SHAPERS, rates: RATES, junk_filters: JUNK, mode: { name: "PCM" } });

// The lists a re-enumerating write pulls in: same shape, different names, so
// adopting them is observable. The one filter left carries enum ID 3, which the
// seeded list does not contain at all.
const RE_FILTERS = [{ index: "0", value: "3", name: "poly-sinc-short" }];
const RE_ENUMS = () => ({ ...ENUMS(), filters: RE_FILTERS });

// filterNx sits at index 2, whose enum ID is 25; rate at index 1, which is 96 kHz.
const STATE = () => ({
  mode: "1",
  filter1x: "1",
  filterNx: "2",
  shaper: "1",
  rate: "1",
  filter_junk: "1",
  adaptive: "0",
  active_chain: "pcm",
});

// The engine ends the write on filterNx index 0 — enum 0 against the old list,
// enum 3 against the new one.
const MOVED = () => ({ ...STATE(), filterNx: "0" });

// The SDM side: the rate enumeration is mode-dependent (manual §4.6), so the two
// families never share a list.
const SDM_RATES = [
  { index: "0", rate: "0" },
  { index: "1", rate: "12288000" },
];
const SDM_ENUMS = () => ({ ...ENUMS(), rates: SDM_RATES, mode: { name: "SDM (DSD)" } });
const SDM_RE_ENUMS = () => ({ ...SDM_ENUMS(), filters: RE_FILTERS });
const SDM_STATE = () => ({ ...STATE(), mode: "2", rate: "1", active_chain: "sdm" });

const FILE = () => ({ mode: "pcm" });

// A live-lane server: the write path, plus the endpoints a write re-mirrors
// from. `report` is what /api/config/live answers on 200; `status` + `detail`
// make it refuse instead. `gate(w)` is awaited BEFORE /api/enumerations answers,
// which is the window this suite is about — a reader running then sees whatever
// the store has already committed. Every GET is recorded on `w.gets`, so a lane
// that was never walked is observable without stubbing anything.
function liveWire({ status = 200, detail, report = { live: [] }, fresh, mirrored, file = FILE(), gate } = {}) {
  const w = { posts: [], gets: [], seen: [] };
  globalThis.fetch = async (path, opts = {}) => {
    if (path === "/api/config/live") {
      w.posts.push(JSON.parse(opts.body));
      return status === 200 ? ok(report) : bad(status, detail);
    }
    w.gets.push(path);
    if (path === "/api/state") return ok({ data: mirrored || STATE() });
    if (path === "/api/enumerations") {
      if (gate) await gate(w);
      return ok({ data: fresh || ENUMS() });
    }
    if (path === "/api/config") return ok({ data: { fields: [], file, active: "", profiles: null } });
    return ok({});
  };
  return w;
}

// Total reset: module-level signals outlive a test, so a partial one makes cases
// pass alone and fail in sequence.
function reset({ state, lists, file = FILE(), ...wire } = {}) {
  engineState.value = state || STATE();
  enums.value = lists || ENUMS();
  config.value = { fields: [], file, active: "", profiles: null };
  liveErrors.value = {};
  liveBusy.value = "";
  return liveWire({ mirrored: state, file, ...wire });
}

const control = (field) => [...liveModel.value.pcmChain, ...liveModel.value.sdmChain].find((c) => c.field === field);
const filterName = () => enums.value.filters[0].name;

// --- every field that rebuilds the engine's menus ------------------------------
// The two SDM-chain fields are written against an engine that has the SDM chain
// loaded, because a write for the chain the engine has NOT loaded is held rather
// than applied and re-enumerates nothing (the HELD case below).

const REENUM = [
  { field: "mode", value: "sdm" },
  { field: "filter1x", value: "40" },
  { field: "filter", value: "40" },
  { field: "rate", value: "192000" },
  { field: "oversampling1x", value: "38", sdm: true },
  { field: "oversampling", value: "38", sdm: true },
];

const scene = (c) =>
  c.sdm ? { state: SDM_STATE(), lists: SDM_ENUMS(), fresh: SDM_RE_ENUMS() } : { fresh: RE_ENUMS() };

for (const c of REENUM) {
  test(`test_a_${c.field}_write_pulls_the_new_enumerations`, async () => {
    reset({ ...scene(c), report: { live: [{ setting: c.field, ok: true }] } });
    await writeLive(c.field, c.value);
    assert.equal(filterName(), "poly-sinc-short");
  });
}

// --- the two halves land together ---------------------------------------------

test("test_a_re_enumerating_write_ends_with_the_new_state_read_against_the_new_lists", async () => {
  // filterNx index 0 against the NEW list is enum 3. Against the old list it is
  // enum 0, and unmoved it is the seeded 25 — so only a store that adopted both
  // halves can answer 3.
  reset({ fresh: RE_ENUMS(), mirrored: MOVED(), report: { live: [{ setting: "filter", ok: true }] } });
  await writeLive("filter", "40");
  assert.equal(control("filter").value, "3");
});

test("test_the_engine_state_is_still_the_pre_write_one_while_the_new_enumerations_are_outstanding", async () => {
  // The reader runs inside the /api/enumerations request, after every other
  // pending answer has had its turn. A store that committed State first would be
  // showing index 0 against the old list here — enum 0, a filter the user never
  // chose and the engine is not running.
  const w = reset({
    fresh: RE_ENUMS(),
    mirrored: MOVED(),
    report: { live: [{ setting: "filter", ok: true }] },
    gate: async (server) => {
      await new Promise((r) => setImmediate(r));
      server.seen.push(control("filter").value);
    },
  });
  await writeLive("filter", "40");
  assert.deepEqual(w.seen, ["25"]);
});

// --- fields that rebuild nothing ----------------------------------------------

const PLAIN = [
  { field: "adaptive_volume", value: "1" },
  { field: "junk_filter", value: "0" },
];

for (const c of PLAIN) {
  test(`test_a_${c.field}_write_leaves_the_enumerations_alone`, async () => {
    reset({ fresh: RE_ENUMS(), report: { live: [{ setting: c.field, ok: true }] } });
    await writeLive(c.field, c.value);
    assert.equal(filterName(), "none");
  });

  test(`test_a_${c.field}_write_asks_the_daemon_for_no_enumerations`, async () => {
    const w = reset({ fresh: RE_ENUMS(), report: { live: [{ setting: c.field, ok: true }] } });
    await writeLive(c.field, c.value);
    assert.equal(w.gets.includes("/api/enumerations"), false);
  });
}

test("test_a_write_that_rebuilds_nothing_still_adopts_the_engines_new_state", async () => {
  // Nothing re-enumerated, so the seeded list still applies: index 0 of it is
  // enum 0, which is neither the seeded 25 nor anything the new lists carry.
  reset({ mirrored: MOVED(), report: { live: [{ setting: "junk_filter", ok: true }] } });
  await writeLive("junk_filter", "0");
  assert.equal(control("filter").value, "0");
});

// --- a write the backend HELD --------------------------------------------------
// The edit was for the chain the engine has not loaded, so the daemon stored it
// instead of applying it (`stored` in the report, lanes/livemap.py). Nothing
// reached the engine, so no enumeration on it was rebuilt — but the held value
// reaches the frontend through the running configuration's live overlay and
// through no other lane, so that configuration is re-read. The lists come back
// with it; what a held write must not do is a re-enumeration pull of its OWN on
// top of that read.

const HELD = () => ({ fresh: RE_ENUMS(), report: { live: [], stored: { oversampling: "38" } } });

test("test_a_held_write_re_reads_the_running_configuration", async () => {
  const w = reset(HELD());
  await writeLive("oversampling", "38");
  assert.equal(w.gets.includes("/api/config"), true);
});

test("test_a_held_write_reads_the_enumerations_no_more_than_that_re_read_carries", async () => {
  // The configuration re-read brings one set of lists with it. A store that
  // treated a held write as a re-enumeration as well would walk that lane twice.
  const w = reset(HELD());
  await writeLive("oversampling", "38");
  assert.equal(w.gets.filter((p) => p === "/api/enumerations").length, 1);
});
