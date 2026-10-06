// The chain rail's stages, decided from what runs and never from a staged edit: railStages decides them from a plain
// running picture, railNow reads that picture off the store. On a DSD source remodulated to SDM nothing resamples, so
// Resampling's slot carries the SDM to SDM conversion; Direct SDM runs none of the processing stages, and Resampling and
// Shaping leave the chain while it plays.

import { engineStatus, volumeShown } from "../signals.js";
import { runningValue, formFieldName, pipelineBaseline } from "../resolve.js";
import { schema } from "../schema.js";
import { optionsFor } from "../ui/options.js";
import { hiddenStages } from "../ui/faceplate.js";
import { items, stateOf, sourceIsNx } from "../live/derive.js";
import { matrixActiveProfile } from "../matrix/profiles.js";
import { loudnessApplied } from "../matrix/loudness.js";
import { speakers } from "../matrix/speakers.js";
import { playbackPath, runningChain, outputIsSdm } from "./path.js";
import { volumeNow } from "./volume.js";
import { truthy } from "../../lib/coerce.js";
import { hz } from "../../lib/units.js";

/**
 * @typedef {import("./path.js").Path} Path
 * @typedef {{ samplerate?: string, bits?: string }} Metadata  the `<metadata>` child's attributes read here
 * @typedef {{ active_rate?: string, active_bits?: string }} Status  the Status-frame attributes read here
 * @typedef {object} Conversion  the running filters and shaper by engine name, and the running DSD settings by label
 * @property {string} filter1x
 * @property {string} filterNx
 * @property {string} shaper
 * @property {string} noise    noise filter
 * @property {string} decim    decimation filter
 * @property {string} integ    remodulator integrator
 * @property {string} sdmconv  SDM to SDM conversion
 * @typedef {object} Running  what runs, as the rail reads it
 * @property {Path} path
 * @property {"pcm" | "sdm"} chain  the chain whose filters and shaper run
 * @property {"1x" | "nx"} stage  the side of the filter split the source rate falls on
 * @property {boolean} direct  Direct SDM as the daemon runs it
 * @property {Metadata} metadata
 * @property {Status} status
 * @property {string} hf  the running HF filter's engine name, `none` when it is off
 * @property {Conversion} conv
 * @property {boolean} matrix  the matrix engine runs
 * @property {string} profile
 * @property {number} pipelines
 * @property {boolean} crossfeed
 * @property {boolean} loudness
 * @property {number} applied  whole percent of the loudness shelving applied
 * @property {boolean} correction
 * @property {string} model  the running DAC correction model
 * @property {string} volume  the level as the rail prints it, with the pin's word while one holds it
 * @property {boolean} speakers
 * @property {string[]} hidden  the stages the preferences hide
 * @typedef {{ id: string, level: number, name: string, value: string, on: boolean, hidden: boolean, byp: boolean }} RailStage
 * @typedef {{ value: string, on: boolean }} Reading  one stage's value and lamp
 * @typedef {{ dsdInPath: boolean, dsd: string, offChain: boolean, rateConversion: boolean, resampling: string, shaping: string }} Paths
 */

const DASH = "—";

/** The rail's stages in signal order: level 0 a top stage, 1 a Matrix engine part. */
const CHAIN = [
  { id: "source", level: 0, name: "Source" },
  { id: "hf", level: 0, name: "HF filter" },
  { id: "dsd", level: 0, name: "DSD Processing" },
  { id: "matrix", level: 0, name: "Matrix engine" },
  { id: "pipelines", level: 1, name: "DSP pipelines" },
  { id: "crossfeed", level: 1, name: "Crossfeed" },
  { id: "loudness", level: 1, name: "Loudness" },
  { id: "resampling", level: 0, name: "Resampling" },
  { id: "correction", level: 0, name: "DAC correction" },
  { id: "volume", level: 0, name: "Volume" },
  { id: "shaping", level: 0, name: "Shaping" },
  { id: "speakers", level: 0, name: "Speakers" },
  { id: "output", level: 0, name: "Output" },
];

/** Resampling's name where its slot carries the SDM to SDM conversion. */
const RATE_CONVERSION = "Rate conversion";

/** The stages that leave the chain under Direct SDM. */
const OFF_CHAIN = ["resampling", "shaping"];

/** The processing stages a Direct SDM path does not run; DSD Processing goes by its own path rule. */
const BYPASSED_BY_DIRECT = [
  "hf",
  "volume",
  "matrix",
  "pipelines",
  "crossfeed",
  "loudness",
  "resampling",
  "shaping",
  "correction",
];

/**
 * A rate as the rail prints it: the frequency, never a DSD multiplier.
 *
 * @param {string | undefined} rate
 * @returns {string}
 */
function fmtRate(rate) {
  const n = Number(rate);
  return n ? hz(n, 3) : DASH;
}

/**
 * The incoming stream: its rate and bit depth, a bare dash with no stream.
 *
 * @param {Metadata} md
 * @returns {string}
 */
export function sourceLabel(md) {
  if (!md.samplerate) return DASH;
  return `${fmtRate(md.samplerate)} / ${md.bits || "?"}bit`;
}

/**
 * The output: its rate and the depth the Status frame reports, 1 bit on a DSD rate where it reports none.
 *
 * @param {Status} st
 * @returns {string}
 */
export function outputLabel(st) {
  const rate = st.active_rate;
  const bits = Number(st.active_bits);
  if (!Number(rate)) return DASH;
  if (bits) return `${fmtRate(rate)} / ${bits}bit`;
  if (outputIsSdm(st)) return `${fmtRate(rate)} / 1bit`;
  return fmtRate(rate);
}

/**
 * A running /config or /matrix dropdown by its option's label, the raw value where no option matches, "" when unset.
 *
 * @param {string} key
 * @returns {string}
 */
export function configLabel(key) {
  const raw = runningValue(key);
  if (raw === undefined || raw === "") return "";
  const entry = schema[key];
  const hit = optionsFor(entry.optionsFrom || "", formFieldName(entry)).find(
    (/** @type {OptionItem} */ o) => String(o.value) === String(raw),
  );
  return hit ? hit.label : String(raw);
}

/**
 * Whether the filter that runs is the Nx one: a DSD source to PCM always decimates to it; on a PCM source the source
 * rate decides; nothing resamples with nothing playing, under Direct SDM or on a remodulated DSD source.
 *
 * @param {Running} r
 */
const runsNx = (r) => r.path === "dsd-pcm" || (["pcm-pcm", "pcm-sdm"].includes(r.path) && r.stage === "nx");

/**
 * DSD Processing, Resampling and Shaping for what plays. DSD Processing names what it runs for the running chain: on
 * PCM the noise filter and the decimation filter, on SDM the integrator, or Direct.
 *
 * @param {Running} r
 * @returns {Paths}
 */
function conversion(r) {
  const { conv } = r;
  const remod = r.path === "sdm-sdm";
  const sdm = r.direct ? "Direct" : conv.integ;
  return {
    dsdInPath: remod || r.path === "dsd-pcm",
    dsd: r.chain === "pcm" ? `${conv.noise} · ${conv.decim}` : sdm,
    offChain: r.path === "direct",
    rateConversion: remod,
    resampling: remod ? conv.sdmconv : runsNx(r) ? conv.filterNx : conv.filter1x,
    shaping: conv.shaper,
  };
}

/**
 * A Matrix engine part: lit while it is engaged and the matrix engine runs.
 *
 * @param {Running} r
 * @param {boolean} engaged
 * @param {string} value
 * @returns {Reading}
 */
const part = (r, engaged, value) => ({ value, on: engaged && r.matrix });

/**
 * A lit stage's value: the source and output describe a stream, and the rest name what runs. A stage switched off
 * has none.
 *
 * @type {Record<string, (r: Running, p: Paths) => Reading>}
 */
const READ = {
  source: (r) => ({ value: r.path === "idle" ? DASH : sourceLabel(r.metadata), on: true }),
  hf: (r) => {
    const on = r.hf !== "" && r.hf !== "none";
    return { value: on ? r.hf : "", on };
  },
  dsd: (_r, p) => ({ value: p.dsd, on: true }),
  matrix: (r) => ({ value: r.profile, on: r.matrix }),
  pipelines: (r) => part(r, true, `${r.pipelines} active`),
  crossfeed: (r) => part(r, r.crossfeed, ""),
  loudness: (r) => part(r, r.loudness, `${r.applied}% applied`),
  resampling: (_r, p) => ({ value: p.resampling, on: true }),
  correction: (r) => part(r, r.correction, r.correction ? r.model || "[none]" : ""),
  volume: (r) => ({ value: r.volume, on: true }),
  shaping: (_r, p) => ({ value: p.shaping, on: true }),
  speakers: (r) => ({ value: "", on: r.speakers }),
  output: (r) => ({ value: r.path === "idle" ? DASH : outputLabel(r.status), on: true }),
};

/**
 * The rail's stages for what runs, in signal order: each one's value and lamp, whether it is hidden (by the
 * preferences, or off the chain under Direct SDM) and whether this track's path bypasses it.
 *
 * @param {Running} r
 * @returns {RailStage[]}
 */
export function railStages(r) {
  const p = conversion(r);
  const direct = r.path === "direct";
  return CHAIN.map((s) => ({
    ...s,
    ...READ[s.id](r, p),
    name: s.id === "resampling" && p.rateConversion ? RATE_CONVERSION : s.name,
    hidden: r.hidden.includes(s.id) || (p.offChain && OFF_CHAIN.includes(s.id)),
    byp: (direct && BYPASSED_BY_DIRECT.includes(s.id)) || (s.id === "dsd" && !p.dsdInPath),
  }));
}

/**
 * The engine name of the enumeration item at the list index State reports for one attribute, "" when there is none.
 *
 * @param {string} key
 * @param {string} attr
 * @returns {string}
 */
function nameAt(key, attr) {
  const at = stateOf(attr);
  const hit = items(key).find((o) => String(o.index) === String(at));
  return hit ? hit.name : "";
}

/**
 * What runs now, read off the engine's reports, the daemon's running forms and the browser's preferences.
 *
 * @returns {Running}
 */
export function railNow() {
  const s = engineStatus.value || {};
  const spk = /** @type {{ enabled?: boolean } | null} */ (speakers.value);
  return {
    path: playbackPath(),
    chain: runningChain(),
    stage: sourceIsNx() ? "nx" : "1x",
    direct: truthy(runningValue("direct_sdm")),
    metadata: s.metadata || {},
    status: s.status || {},
    hf: nameAt("junk_filters", "filter_junk"),
    conv: {
      filter1x: nameAt("filters", "filter1x"),
      filterNx: nameAt("filters", "filterNx"),
      shaper: nameAt("shapers", "shaper"),
      noise: configLabel("noise_filter"),
      decim: configLabel("pcm_conversion"),
      integ: configLabel("sdm_integrator"),
      sdmconv: configLabel("sdm_conversion"),
    },
    matrix: truthy(runningValue("matrix_enabled")),
    profile: matrixActiveProfile.value,
    pipelines: pipelineBaseline.value.length,
    crossfeed: truthy(runningValue("crossfeed_enabled")),
    loudness: truthy(runningValue("loudness_enabled")),
    applied: loudnessApplied(),
    correction: truthy(runningValue("dac_correction_enabled")),
    model: configLabel("dac_correction_profile"),
    volume: volumeShown.value == null ? "" : volumeNow().rail,
    speakers: !!(spk && spk.enabled),
    hidden: hiddenStages.value,
  };
}
