// Signal path bar — the front panel. The live chain in physical processing order:
// source → matrix → Bauer crossfeed (input-side, pre-oversampling) → the
// conversion stages → DAC correction → output rate. Crossfeed operates on the
// source-rate signal; DAC correction is a per-DAC response correction and so runs
// at the OUTPUT rate, after the conversion stages — it is output-rate-dependent
// and cannot precede the filter (this corrects architecture §3, which grouped both
// post-process stages "before oversampling"; §3's order was flagged unverified).
// A disabled post-process stage is omitted entirely, so the chain only ever shows
// what's actually in the path. Stages read as one continuous chain (connector
// thread, not floating arrows); playing carries the accent through the thread and
// glows the output Rate chip; idle dims the bar.
//
// Data sources differ by stage: the active filter/shaper/rate come off the live
// Status frame (st.*), DAC correction from its live `correction` 0/1 flag, and
// crossfeed/loudness/matrix from the RUNNING config forms (runningValue — never
// effective: the front panel reflects the active state, so a previewed preset
// or a staged-but-unapplied edit must not move these chips).
import { html } from "../lib/dom.js";
import { engineStatus, engineState } from "../store/signals.js";
import { runningValue, formFieldName } from "../store/resolve.js";
import { schema, volumePinned } from "../store/schema.js";
import { optionsFor } from "../store/options.js";
import { truthy as on } from "../lib/coerce.js";
import { hz } from "../lib/units.js";

/**
 * @typedef {{
 *   active_rate?: string, active_bits?: string, active_filter?: string, active_shaper?: string, correction?: string,
 * }} Status
 *   The Status-frame attributes this bar reads (protocol.md §Status). Every one
 *   is an XML attribute, so it arrives as text or not at all.
 * @typedef {{ samplerate?: string, bits?: string, sdm?: string }} Metadata
 *   The `<metadata>` child's attributes this bar reads — same wire rule.
 * @typedef {{ stage: string, label: string, value?: string, hero?: boolean }} PathStage
 *   One chip on the bar. `stage` is the stage's own code, stable across any
 *   relabelling. `hero` marks the output chip, which glows on playback.
 */

const PLAYING = 2; // State: 0 Stopped, 1 Paused, 2 Playing, 3 Stopping
const DSD_FLOOR = 2822400; // DSD64 (44.1k × 64) — the lowest 1-bit bitstream rate

// The front panel shows the actual frequency, not a DSD multiplier: a DSD
// bitstream is a 1-bit stream at this rate, so "24.576 MHz" reads truer than
// "DSD512" (and sidesteps the 44.1k-vs-48k base ambiguity that mislabeled it).
/**
 * @param {string | undefined} rate
 * @returns {string}
 */
function fmtRate(rate) {
  const n = Number(rate);
  return n ? hz(n, 3) : "—";
}

// The placeholder every "nothing to report" path in this file already writes:
// no source, no rate, no chain. Marked as its own state rather than left as
// ordinary chip text, because a bare dash styled like a value reads as a value
// that failed to load — the stopped panel should read as dormant, not broken.
const DASH = "—";

/** @param {PathStage} props */
function Chip({ stage, label, value, hero }) {
  const shown = value || DASH;
  // joined rather than interpolated in place: an inline ternary for each state
  // leaves the empty slots behind as stray spaces in the attribute, and the
  // chip's class list is asserted verbatim.
  const cls = ["chip", hero ? "chip-hero" : "", shown === DASH ? "chip-dash" : ""].filter(Boolean).join(" ");
  return html`
    <span class=${cls} data-stage=${stage}>
      <span class="chip-label">${label}</span>
      <span class="chip-val">${shown}</span>
    </span>
  `;
}

// A /config dropdown reports the form's option VALUE ("2", "xfi"); the chip
// needs the human label, so join through the same option list the control on the
// DSP tab renders from rather than keeping a second copy of the enum here.
/**
 * @param {string} key
 * @returns {string}
 */
function configLabel(key) {
  const raw = runningValue(key);
  if (raw === undefined || raw === "") return "";
  // FieldEntry, not the ambient SchemaField: the catalog spells three fields
  // differently and does not overlap it (components/Field.js states which).
  const entry = /** @type {Record<string, import("./Field.js").FieldEntry>} */ (schema)[key];
  const hit = optionsFor(entry.optionsFrom || "", formFieldName(entry)).find(
    (/** @type {OptionItem} */ o) => String(o.value) === String(raw),
  );
  return hit ? hit.label : String(raw);
}

// Source describes the incoming stream, so it only means anything while one
// exists — a bare dash otherwise (not "N/A", not the engine's remembered rate).
/**
 * @param {Metadata} md
 * @returns {string}
 */
function sourceLabel(md) {
  if (!md.samplerate) return "—";
  return `${fmtRate(md.samplerate)} / ${md.bits || "?"}bit`;
}

// The output chip reads like the source chip — rate and bit depth — and the
// depth comes straight off the Status frame's `active_bits` (protocol.md), which
// reports 1 on an SDM path and 24/32 on a PCM one. Falling back on the DSD floor
// keeps the chip right when the field is absent, where the only depth derivable
// without it is the 1 bit a DSD bitstream always carries.
/**
 * @param {Status} st
 * @returns {string}
 */
function outputLabel(st) {
  const rate = st.active_rate;
  const bits = Number(st.active_bits);
  if (!Number(rate)) return "—"; // no rate, no chain — a bare depth reads as noise
  if (bits) return `${fmtRate(rate)} / ${bits}bit`;
  if (Number(rate) >= DSD_FLOOR) return `${fmtRate(rate)} / 1bit`;
  return fmtRate(rate);
}

// Crossfeed and loudness share ONE post-process slot — both active collapses to
// "DSP" rather than a chip each, which would crowd the panel.
/**
 * @param {boolean} cf
 * @param {boolean} loud
 * @returns {PathStage | null}
 */
function postProcessStage(cf, loud) {
  if (cf && loud) return { stage: "dsp", label: "DSP", value: "On" };
  if (cf) return { stage: "crossfeed", label: "Crossfeed", value: "On" };
  if (loud) return { stage: "loudness", label: "Loudness", value: "On" };
  return null;
}

// Which conversion chain is running is decided by the SOURCE domain and the
// OUTPUT domain, not by the configured mode.
//
// Source domain: the Status metadata child carries an `sdm` flag, which is the
// direct answer, but protocol.md only lists the attribute — nothing has verified
// it on the wire against 6.0.4. The source rate is the independent check, since a
// DSD bitstream reports its bitstream rate and that is always at or above DSD64.
// Either one alone suffices, so the pair survives whichever turns out to be absent.
const sourceIsDsd = (/** @type {Metadata} */ md) => on(md.sdm) || Number(md.samplerate) >= DSD_FLOOR;
const outputIsSdm = (/** @type {Status} */ st) => Number(st.active_rate) >= DSD_FLOOR;

// DirectSDM only means anything on the DSD→SDM path: it "disables all processing
// when source is DSD content and output format is SDM to a DSD-device or file"
// (manual §4.5). With a PCM track playing it is inert, however it is configured.
const directPassThrough = (/** @type {Status} */ st, /** @type {Metadata} */ md) =>
  sourceIsDsd(md) && outputIsSdm(st) && on(runningValue("direct_sdm"));

// The four source→output combinations run four DISJOINT sets of controls
// (manual §4.4 PCM tab, §4.5 SDM tab, §4.6 filter/oversampling):
//
//   PCM → PCM   <pcm filter>                    + <pcm dither>
//   DSD → PCM   pdm_filt + pdm_conv, then       <pcm filter> + <pcm dither>
//   PCM → SDM   <sdm oversampling>              + <sdm modulator>
//   DSD → SDM   sdm_integrator + sdm_conversion — and NEITHER an oversampling
//               filter nor a modulator: the SDM→SDM converter carries its own
//               noise shaping (§4.5, "in addition to increasing noise shaping
//               noise"), and integrator + conversion are the only two controls
//               the manual names for this path.
//
// Status.active_filter / active_shaper report the CONFIGURED filter and shaper
// whatever the source is — hqplayerd's own web UI shows the same pair regardless
// — so reading them unconditionally shows a DSD source in SDM mode a modulator
// that is not in its path at all. Both fields are read only on the paths that
// actually use them.
//
// Note the two filter enumerations are distinct: <pcm filter> (67 entries) and
// <sdm oversampling> (77, different enum IDs, no "none") — architecture §2's
// mode-relative enumerations. The engine reports whichever the current mode uses,
// so one `active_filter` read serves both branches.
/**
 * @param {Status} st
 * @param {Metadata} md
 * @returns {PathStage[]}
 */
function conversionStages(st, md) {
  const dsdIn = sourceIsDsd(md);
  const sdmOut = outputIsSdm(st);
  if (dsdIn && sdmOut) {
    return [
      { stage: "sdm-integrator", label: "Reconstruction filter", value: configLabel("sdm_integrator") },
      { stage: "sdm-conversion", label: "Source bandwidth", value: configLabel("sdm_conversion") },
    ];
  }
  if (dsdIn) {
    return [
      { stage: "noise-filter", label: "Noise filter", value: configLabel("noise_filter") },
      { stage: "pcm-conversion", label: "Decimation filter", value: configLabel("pcm_conversion") },
      { stage: "filter", label: "Filter", value: st.active_filter },
      { stage: "shaper", label: "Dither", value: st.active_shaper },
    ];
  }
  return [
    { stage: "filter", label: "Filter", value: st.active_filter },
    { stage: "shaper", label: sdmOut ? "Modulator" : "Dither", value: st.active_shaper },
  ];
}

// The chain in processing order, omitting disabled post-process stages: matrix
// and crossfeed are input-side and precede the conversion stages; DAC correction
// is output-rate-dependent and follows them.
/**
 * @param {Status} st
 * @param {Metadata} md
 * @param {boolean} playing
 * @returns {PathStage[]}
 */
function chainStages(st, md, playing) {
  const source = { stage: "source", label: "Source", value: playing ? sourceLabel(md) : "—" };
  const output = { stage: "output", label: "Output", value: playing ? outputLabel(st) : "—", hero: true };
  // A bit-perfect pass-through has nothing between source and DAC, so the bar
  // must stop advertising a matrix, a crossfeed or a correction that the daemon
  // is not running (manual §5 excepts only speaker distance processing, which
  // this bar has never shown).
  if (directPassThrough(st, md))
    return [source, { stage: "direct-sdm", label: "Direct SDM", value: "Bit-perfect" }, output];
  /** @type {PathStage[]} */
  const stages = [source];
  // A stage indicator, never a profile readout: profile names run long enough to
  // overrun the chip, so the chip states only that a matrix is in the path.
  const matrixOn = on(runningValue("matrix_enabled"));
  if (matrixOn) {
    stages.push({ stage: "matrix", label: "Matrix", value: "On" });
  }
  // `<post_process>` nests inside `<matrix>` (readme §1.11.2), so a bypassed
  // engine runs neither plugin however their own enables read — a config the
  // daemon reaches easily, since bypassing the matrix leaves the plugin switches
  // alone. Same rule as the pass-through above: never advertise a stage that is
  // not running.
  // Loudness is additionally volume-ADAPTIVE (manual §7): the applied fraction
  // follows the live volume, so a pinned volume — fixed volume, Auto headroom,
  // or a 0/0 range — means 0% applied, ever. An engaged-but-pinned loudness is
  // inaudible, so its chip must not show; crossfeed is not volume-adaptive and
  // keeps its own gate. The combined "DSP" chip follows from the two shown
  // chips, so it collapses only when both stages are actually audible.
  const post = matrixOn
    ? postProcessStage(
        on(runningValue("crossfeed_enabled")),
        on(runningValue("loudness_enabled")) && !volumePinned(runningValue),
      )
    : null;
  if (post) stages.push(post);
  stages.push(...conversionStages(st, md));
  if (st.correction === "1") stages.push({ stage: "correction", label: "Correction", value: "On" });
  stages.push(output);
  return stages;
}

/** Chip row tracing the engine's active chain from the status payload, linked stage by stage and styled live or idle. */
export function SignalPath() {
  // /api/status payload is { status: {active_*...}, metadata: {track tags} } —
  // the active chain lives on the Status root (status.*), the track info on the
  // metadata child.
  const s = engineStatus.value || {};
  const st = s.status || {};
  const md = s.metadata || {};
  const playing = Number((engineState.value || {}).state) === PLAYING;

  /** @type {unknown[]} */
  const nodes = [];
  chainStages(st, md, playing).forEach((stage, i) => {
    if (i) nodes.push(html`<span class="link"></span>`);
    nodes.push(html`<${Chip} stage=${stage.stage} label=${stage.label} value=${stage.value} hero=${stage.hero} />`);
  });

  return html`<div class="signal-path ${playing ? "live" : "idle"}">${nodes}</div>`;
}
