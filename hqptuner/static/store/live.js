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
import { engineState, engineStatus, enums, modeName, runningValue, refreshConfig } from "./state.js";
import { enumOptions } from "./options.js";
import { narrowOptions } from "./narrowing.js";
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
// Writes that change what the running config reports for the two rate limits.
const RATE_MIRRORED = new Set(["mode", "rate"]);

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
  // A rate or mode write moves what the running config reports for BOTH rate
  // limits (livemap.live_overrides), and that overlay is what the dormant rate
  // column reads. Its own poll is on the slow cadence, so pull it here rather
  // than leave the column showing the pre-switch tier for a few seconds.
  if (RATE_MIRRORED.has(field)) await refreshConfig();
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
    // Rate is the one control whose menu value is not what goes on the wire: the
    // menus name a tier, and only here is the source known well enough to say
    // which member of it (see the base-family note below).
    const wire = field === "rate" ? forSource(String(value)) : String(value);
    const report = await api.live({ [field]: wire });
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
// (protocol.md §6) — so the rate in Hz is what the lane takes back. The menus
// speak tiers, so State's rate comes back as the tier it belongs to; rate "0"
// belongs to no tier and reads as "" (the engine has no pin of its own).
function rateValue() {
  const item = atIndex(items("rates"), stateOf("rate"));
  return TIER[item ? item.rate : ""] || "";
}

// --- the rate card -----------------------------------------------------------
// The Output tab's rate box, as it is there: a PCM column and an SDM column with
// a hairline between them, the one the running mode cannot use grayed (schema
// grayWhen isSdm/isPcm), both reading the manual's rate prose on hover.
//
// The two sides write different slots. The tab writes the LIMIT
// (defaults_samplerate / defaults_bitrate, landing at the next restart), which
// the engine then follows in the source's own base family. LIVE writes SetRate,
// an exact rate that ignores both the limit and the source's family. Same tier
// either way — what differs is only that the live one has to name a member of it.
const RATE_KEY = { pcm: "pcm_rate", sdm: "sdm_rate" };
// No PCM rate the engine offers reaches DSD64, so the lowest SDM rate separates
// the two families outright — no rate is ambiguous between them.
const SDM_FLOOR = 2822400;

const rateFamily = (rate) => (Number(rate) >= SDM_FLOOR ? "sdm" : "pcm");

// --- base family -------------------------------------------------------------
// Every tier has a 44.1k and a 48k member (DSD512 is 22579200 or 24576000). The
// menus carry the 48k one and mean the TIER, not that frequency. A config write
// cannot choose between the two — it has no source — which is exactly why the
// tab writes the limit slot and lets the engine decide. LIVE can choose, because
// the engine reports what is playing, so a tier picked here resolves to that
// source's own member and 44.1k material is never sent out at a 48k base rate.
// Whether the DAC may use a 48k DSD base at all remains the user's setting
// (alsa_anydsd / net_anydsd); this only declines to change it behind their back.
//
// Measured on Opal 2026-07-28, 44.1 kHz source, limit DSD512: no pin -> 22579200;
// pinned 12288000 -> 12288000; pinned 49152000 -> 49152000 (over the limit).
const BASE_44K = 44100;
const TWIN_44K = {
  48000: "44100",
  96000: "88200",
  192000: "176400",
  384000: "352800",
  768000: "705600",
  1536000: "1411200",
  3072000: "2822400",
  6144000: "5644800",
  12288000: "11289600",
  24576000: "22579200",
  49152000: "45158400",
  98304000: "90316800",
};
// Either member of a tier back to the menu value that names it.
const TIER = Object.entries(TWIN_44K).reduce((all, [base, twin]) => ({ ...all, [base]: base, [twin]: base }), {});

// 44.1k when the playing source divides by it — true of 88.2/176.4/352.8 and of
// every DSD rate, all of which are multiples. With nothing playing there is no
// source to follow, so the menus' own 48k base stands, which is what a config
// write would have used anyway.
function sourceIs44k() {
  const st = engineStatus.value || {};
  const source = Number((st.metadata || {}).samplerate) || Number((st.status || {}).active_rate) || 0;
  return source > 0 && source % BASE_44K === 0;
}

// A menu value as the rate to actually send.
const forSource = (tier) => (sourceIs44k() && TWIN_44K[tier] ? TWIN_44K[tier] : tier);

// A tier the engine is not currently offering is listed and grayed with the
// reason, never dropped: a tier silently missing from the menu reads as one this
// build doesn't support, rather than one the engine isn't offering right now.
// Offered is judged on the member that would actually be sent, since that is
// what SetRate has to find in the list. The enumeration says only that it is
// absent, never why — so the reason says that and no more.
const UNOFFERED = "unavailable";

function rateOptions(key) {
  const offered = new Set(items("rates").map((o) => String(o.rate)));
  return schema[key].options.map((o) =>
    offered.has(forSource(String(o.value))) ? o : { ...o, disabled: true, reason: UNOFFERED },
  );
}

// Which family the engine is running. The loaded chain answers it outright; with
// no chain loaded the mode does, and in auto mode before playback nothing does —
// there neither column is grayed, because the engine takes a rate for either.
function liveFamily() {
  const chain = (engineState.value || {}).active_chain;
  if (chain) return chain;
  const mode = modeValue();
  return mode === "pcm" || mode === "sdm" ? mode : null;
}

// --- what the dormant column shows -------------------------------------------
// State reports one rate, the running family's, so the moment the engine changes
// family the other column has nothing of its own left to read — and the engine
// has genuinely forgotten it, because SetMode clears the pin outright (measured
// 2026-07-28, scripts/probe_mode_rate_pin.py). What survives the switch is the
// backend's own per-family memory of what LIVE pinned, which it re-asserts on the
// engine when that family comes round again and reports in BOTH limit fields of
// the running config (livemap.live_overrides). runningValue reads exactly that
// overlay, so the dormant column here and the Output tab's column are one number
// from one source rather than two guesses that drift apart.
function rateColumn(family) {
  const live = liveFamily();
  const enabled = live === null || live === family;
  const key = RATE_KEY[family];
  const tier = rateValue();
  const mine = tier !== "" && rateFamily(tier) === family;
  const configured = runningValue(key);
  return {
    field: "rate",
    key,
    entry: schema[key],
    disabled: !enabled,
    // The engine's own pin when it is reporting one for this family, the running
    // config's limit otherwise — which already carries the remembered pin. With
    // no pin at all the limit is what the engine selects, so a column nothing has
    // touched names the same tier the Output tab does instead of reporting the
    // empty slot as "Auto".
    value: enabled && mine ? tier : configured,
    // One menu for both columns — the tab's own table, in the tab's own order,
    // whole either way. The live column grays what the engine is not offering;
    // the disabled column is already grayed entire, and the engine has no list
    // for the family it isn't running anyway.
    options: enabled ? rateOptions(key) : schema[key].options,
  };
}

// Filter narrowing is the same feature the Resampling tab has, on the same
// state: one set of facets narrows a control here and its twin there, because
// they are the same control and the narrowing is the user's standing answer to
// "which of these 77 filters am I willing to look at". Presentational only — it
// never hides the running selection (store/narrowing.js), so no live value can
// be narrowed off its own dropdown. Shapers carry `narrow` nowhere and are left
// whole.
function chainOptions(c, value) {
  const options = idOptions(c.enumKey);
  return c.entry.narrow ? narrowOptions(options, value, c.entry.narrow, c.key) : options;
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
    pcmRate: rateColumn("pcm"),
    sdmRate: rateColumn("sdm"),
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
    chainControls: (CHAINS[chain] || []).map((c) => {
      const value = idValue(c.enumKey, c.state);
      return { field: c.field, key: c.key, entry: c.entry, value, options: chainOptions(c, value) };
    }),
  };
});
