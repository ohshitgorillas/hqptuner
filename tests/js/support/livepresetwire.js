// Shared fixtures for the live-preset suites: the wire fake, the records it
// serves, and the enumeration/metadata trees the LIVE page reads.
//
// A live preset is HQPTuner's, not the daemon's: it stores a batch of live
// settings keyed by form-field name, and it carries the OUTPUT MODE among them
// (`fields.mode`, one of auto / pcm / sdm). Applying one switches the engine to
// that mode before applying the rest, so there is no such thing as an
// incompatible preset: every saved preset is pickable, always, whatever chain
// the engine currently reports.
//
// The fake answers the real REST paths with the real shapes —
// GET /api/livepresets -> {presets}, PUT /api/livepresets/{name} -> the record,
// POST /api/livepresets/{name}/apply -> {live, stored}, DELETE -> {deleted} —
// and it HOLDS the list the way the backend does, so "a save re-reads the list"
// is observable as the list having moved. No store function is ever stubbed.

import { ok, bad } from "./wire.js";

// A saved record as /api/livepresets serves it: `fields` is the batch that gets
// applied, keyed by form-field name and carrying the output mode it was
// captured under; `names` is display only.
export const rec = (name, chain) => ({
  name,
  chain,
  fields: { mode: chain, filter1x: "40", rate: "0" },
  names: { mode: chain.toUpperCase(), filter1x: "poly-sinc-gauss-long" },
});

// The engine's own answer for /api/state: `active_chain` is "pcm", "sdm" or
// null (nothing loaded yet).
export const STATE = (chain, rate = "1") => ({
  mode: "1",
  filter1x: "0",
  filterNx: "1",
  shaper: "0",
  rate,
  filter_junk: "0",
  adaptive: "0",
  volume: "-10.0",
  active_chain: chain,
});

export const ENUMS = {
  filters: [
    { index: "0", value: "0", name: "none" },
    { index: "1", value: "40", name: "poly-sinc-gauss-long" },
  ],
  shapers: [{ index: "0", value: "0", name: "none" }],
  rates: [
    { index: "0", rate: "0" },
    { index: "1", rate: "96000" },
  ],
  junk_filters: [{ index: "0", value: "0", name: "none" }],
  mode: { name: "PCM" },
};

// settings.json's per-control label and tooltip, plus the name-keyed overlays:
// same SHAPE as the shipped prose, cut to a sentence each.
export const METADATA = {
  settings: {
    output: {
      output_mode: { label: "Output mode", tooltip: "Selects default output mode." },
      rate: { label: "Output rate", tooltip: "Output sample rate request, or upper limit." },
      junk_filter: { label: "High-frequency filter", tooltip: "Playback filters for noise.", options: { 0: "None." } },
    },
    dsp: {
      filter_1x: { label: "1x filter", tooltip: "Oversampling filter for base-rate sources." },
      filter_nx: { label: "Nx filter", tooltip: "Oversampling filter above the base rates." },
      shaper: { label: "Dither", tooltip: "Noise shaping applied at the output word length." },
    },
    volume: { adaptive_volume: { label: "Adaptive volume", tooltip: "Applies the source's ReplayGain 2.0 offset." } },
  },
  filters: { filters: {}, aliases: {} },
  shapers: { pcm_dithers: {}, sdm_modulators: {} },
};

// PUT and DELETE move the list the fake HOLDS, the way the backend's store
// does, so a following GET answers differently — the only way "a save re-reads
// the list" can be told apart from a save that quietly kept the old one.
function storeSave(w, c, name) {
  if (c.saveStatus !== 200) return bad(c.saveStatus, c.saveDetail);
  const saved = rec(name, c.chain);
  w.presets = [...w.presets.filter((p) => p.name !== name), saved];
  return ok(saved);
}

function storeDelete(w, name) {
  w.presets = w.presets.filter((p) => p.name !== name);
  return ok({ deleted: name });
}

// /api/livepresets/{name} and its /apply sub-path.
function onePreset(w, c, name, isApply, method) {
  if (isApply) return c.applyStatus === 200 ? ok(c.report) : bad(c.applyStatus, c.applyDetail);
  if (method === "PUT") return storeSave(w, c, name);
  if (method === "DELETE") return storeDelete(w, name);
  return ok({});
}

// The endpoints a preset lane may touch on either side of its own: the engine's
// state, and the three trees the page reads. Each answers its real shape, so a
// lane that re-mirrors gets something it can adopt rather than a bare {}.
function ambient(path, c) {
  // the whole frame the daemon lane serves, not just its payload: a lane reading
  // `stale` must see the real field rather than undefined (docs/testing.md rule 4)
  if (path === "/api/state") return ok({ stale: false, loaded_at: 1, data: c.mirrored || STATE(c.chain) });
  if (path === "/api/enumerations") return ok({ data: ENUMS });
  if (path === "/api/config") return ok({ data: { fields: [], file: {}, active: "", profiles: null } });
  if (path === "/api/matrix") return ok({ data: { fields: [] } });
  if (path === "/api/config/pending" || path === "/api/config/stage") return ok({ live: {}, http: {} });
  return ok({});
}

const ONE = /^\/api\/livepresets\/([^/]+)(\/apply)?$/;

export function presetWire(cfg = {}) {
  const c = { presets: [], chain: "pcm", listStatus: 200, saveStatus: 200, applyStatus: 200, ...cfg };
  c.report = cfg.report || { live: [], stored: {} };
  const w = { calls: [], presets: [...c.presets] };
  globalThis.fetch = async (path, opts = {}) => {
    const method = opts.method || "GET";
    w.calls.push({ path, method, body: opts.body });
    if (path === "/api/livepresets") {
      return c.listStatus === 200 ? ok({ presets: w.presets }) : bad(c.listStatus, c.listDetail);
    }
    const one = ONE.exec(path);
    return one ? onePreset(w, c, decodeURIComponent(one[1]), Boolean(one[2]), method) : ambient(path, c);
  };
  return w;
}

// The fake resolves without timers, so the whole read -> json -> signal chain
// settles in a handful of microtask ticks. No wall clock is waited on
// (docs/testing.md rule 7): a lane that never fired fails here immediately
// rather than hanging.
export async function settle(ticks = 50) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}
