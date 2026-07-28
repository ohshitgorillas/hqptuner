// The LIVE view's store: what its controls read, and the one path they write by.
//
// Every control writes the moment it changes — one field, one
// POST /api/config/live, readback-verified by the backend before it answers.
// Nothing here stages. The pending buffer belongs to the tabs view and Apply
// flushes all of it, so a LIVE control that touched it would apply edits the
// user never asked for (lanes/livelane.py says the same from the other side).
//
// Two mirrors follow a write. `engineState` always: a live edit never reaches the
// config file, so /api/state is the only place its new value shows up. `enums`
// when the write re-enumerates — SetMode swaps the filter and shaper lists
// wholesale, and the rate list depends on both mode and the selected filter
// (manual §4.6). The backend has already refreshed them; this pulls the fresh
// lists into the page so the next control resolves against what the engine now
// offers.
//
// No control here is ever refused because playback is running (CLAUDE.md): what
// a live change costs mid-stream is the user's to spend, and the captions say so.

import { signal, computed } from "@preact/signals";
import { api } from "../lib/api.js";
import { hz } from "../lib/units.js";
import { engineState, enums, modeName } from "./state.js";
import { enumOptions } from "./options.js";
import { schema } from "./schema.js";

// The control currently mid-write ("" = none), and the last error per control.
// One error per control and latest wins: the page has no toast stack, and a
// failed write is about the control the user just touched.
export const liveBusy = signal("");
export const liveErrors = signal({});
// True while the enumerations are being re-pulled. The lists a re-enumerating
// write invalidated are stale until it clears, so the sections built from them
// say "reloading" instead of offering options the engine may no longer have.
export const liveReloading = signal(false);

// Writes whose own success invalidates an enumeration, in config-form terms.
// Mirrors livelane._REENUMERATES, which names the same three by setter key.
const REENUMERATES = new Set(["mode", "filter1x", "filter", "oversampling1x", "oversampling", "rate"]);

function setError(field, message) {
  const next = { ...liveErrors.value };
  if (message) next[field] = message;
  else delete next[field];
  liveErrors.value = next;
}

// A 200 still carries failures: the backend verifies each setter by State
// readback and reports per setting, so an entry that did not verify is this
// control's error just as much as a thrown 409 is.
function reportError(report) {
  const failed = ((report && report.live) || []).find((e) => !e.ok);
  if (!failed) return "";
  return failed.error || `${failed.setting} did not take`;
}

async function remirror(field) {
  const state = await api.state();
  engineState.value = state.data;
  if (!REENUMERATES.has(field)) return;
  liveReloading.value = true;
  try {
    const fresh = await api.enumerations();
    enums.value = fresh.data;
  } finally {
    liveReloading.value = false;
  }
}

// Write one live control. Returns nothing on purpose: the outcome lives on the
// signals above, so no control has to hold a second copy of it.
export async function writeLive(field, value) {
  liveBusy.value = field;
  setError(field, "");
  try {
    const report = await api.live({ [field]: String(value) });
    await remirror(field);
    setError(field, reportError(report));
  } catch (e) {
    // a refused batch applied nothing, so the mirrors are still current
    setError(field, e.message);
  } finally {
    liveBusy.value = "";
  }
}

// --- what the controls read --------------------------------------------------
// The running engine is the sole authority for enumeration names, IDs and
// ordering (architecture §2), so every option list below is built from the
// enumerations rather than from anything shipped.

const items = (key) => (enums.value && enums.value[key]) || [];
const stateOf = (attr) => (engineState.value || {})[attr];

// State reports a LIST INDEX; the config-form domain these controls speak is the
// enum ID (protocol.md §4). The enumeration item carries both, so the join is a
// lookup and never a computation.
const atIndex = (list, index) => list.find((o) => String(o.index) === String(index));

const idOptions = (key) => items(key).map((o) => ({ value: o.value, label: o.name }));

function idValue(key, attr) {
  const item = atIndex(items(key), stateOf(attr));
  return item ? item.value : "";
}

// Every control here names its catalog key, and its words are then the tab
// twin's words: the schema entry carries the label, the settings.json group its
// tooltip lives in, and which description overlay its selection reads
// (store/prose.js). Nothing on this page writes prose of its own — a live
// control and its persistent twin are the same knob and must say the same
// thing.
const catalog = (key) => ({ key, entry: schema[key] });

// The two chains' form fields, in signal order. Mirrors livemap.ROUTABLE, which
// is what accepts these names back.
const CHAINS = {
  pcm: [
    { field: "filter1x", ...catalog("pcm_filter_1x"), enumKey: "filters", state: "filter1x" },
    { field: "filter", ...catalog("pcm_filter_nx"), enumKey: "filters", state: "filterNx" },
    { field: "dither", ...catalog("pcm_dither"), enumKey: "shapers", state: "shaper" },
  ],
  sdm: [
    { field: "oversampling1x", ...catalog("sdm_filter_1x"), enumKey: "filters", state: "filter1x" },
    { field: "oversampling", ...catalog("sdm_filter_nx"), enumKey: "filters", state: "filterNx" },
    { field: "modulator", ...catalog("sdm_modulator"), enumKey: "shapers", state: "shaper" },
  ],
};

// The live rate is the one control with no catalog key: its persistent twins are
// the pcm_rate/sdm_rate pair, which write a different form field on a different
// lane (defaults_samplerate / defaults_bitrate). It reads the manual's prose for
// the rate control directly instead — settings.json `output.rate`, which is the
// paragraph describing exactly this setting.
const RATE_ENTRY = { key: "rate", entry: { group: "output" } };

// Mode is the one live field whose value is a name rather than a number. The
// modes enumeration is device-dependent — it drops SDM on a device that cannot
// do DSD — so the form value is matched from the item's NAME, exactly as
// livemap._mode_form_value does on the other side.
function modeValue() {
  const name = modeName.value.toUpperCase();
  if (name.startsWith("[SOURCE]")) return "auto";
  if (name.startsWith("PCM")) return "pcm";
  return name.startsWith("SDM") || name.startsWith("DSD") ? "sdm" : "";
}

// `RatesItem` carries neither a name nor a value — it is `<RatesItem index rate/>`
// (protocol.md §6) — so the rate in Hz is both what the lane takes back and its
// own label, and rate "0" is "follow the source".
function rateOptions() {
  return items("rates").map((o) => ({ value: o.rate, label: o.rate === "0" ? "Auto" : hz(Number(o.rate), 3) }));
}

function rateValue() {
  const item = atIndex(items("rates"), stateOf("rate"));
  return item ? item.rate : "";
}

// Everything the LIVE page renders, in one read. A single computed rather than a
// dozen exports: the controls are one picture of the engine, and building them
// apart is how a page ends up showing a filter from one poll beside a chain from
// the next.
export const liveModel = computed(() => {
  const chain = (engineState.value || {}).active_chain || null;
  return {
    chain,
    // `mode`'s config-form values are the stable strings auto/pcm/sdm, so its
    // option list is the catalog's own, not an enumeration.
    mode: { field: "mode", ...catalog("output_mode"), value: modeValue(), options: schema.output_mode.options },
    rate: { field: "rate", ...RATE_ENTRY, value: rateValue(), options: rateOptions() },
    // The junk (playback) filter is index-domain on both sides: the daemon's own
    // /config form has no field for it, so the list index IS the value — which
    // is what enumOptions hands back, and what its per-option prose is keyed by.
    junk: {
      field: "junk_filter",
      ...catalog("junk_filter"),
      value: stateOf("filter_junk"),
      options: enumOptions("junk_filters"),
    },
    adaptive: { field: "adaptive_volume", ...catalog("adaptive_volume"), value: stateOf("adaptive") },
    chainControls: (CHAINS[chain] || []).map((c) => ({
      field: c.field,
      key: c.key,
      entry: c.entry,
      value: idValue(c.enumKey, c.state),
      options: idOptions(c.enumKey),
    })),
  };
});
