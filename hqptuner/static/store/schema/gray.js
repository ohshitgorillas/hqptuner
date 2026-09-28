// Graying predicates shared by the control catalog parts (store/schema.js).
// Each returns a reason string, '' when the control is enabled.

import { truthy } from "../../lib/coerce.js";

// Mode is the http `mode` field (auto/pcm/sdm) — stable values, always all three.
// (The live GetModes enum is device-dependent: it drops SDM when the active
// device can't do DSD, so it's the wrong source for a persistent config choice.)
// grayWhen contract: return a reason STRING (rendered as a visible caption on
// the grayed field unless quietGray, and as the hover title), '' when enabled —
// a bare boolean leaks "true" into the title attribute.
const inMode = (/** @type {GrayCtx} */ ctx, /** @type {string} */ m) => String(ctx.effective("output_mode")) === m;
/** Grays a PCM-only control while the staged output mode is SDM. */
export const isSdm = (/** @type {GrayCtx} */ ctx) => (inMode(ctx, "sdm") ? "Only relevant to PCM output mode." : "");
/** Grays an SDM-only control while the staged output mode is PCM. */
export const isPcm = (/** @type {GrayCtx} */ ctx) => (inMode(ctx, "pcm") ? "Only relevant to SDM output mode." : "");

/**
 * DirectSDM "will disable volume control and set PCM volume to fixed -3 dBFS
 * value" (manual §4.5). Every persistent control that sets a volume level is
 * therefore inert while it's on — the daemon accepts and stores the setting but
 * nothing reaches the output stage, so the UI has to say so. volume/Playback.js
 * already grays the live slider for the same reason.
 */
export const directSdm = (/** @type {GrayCtx} */ ctx) =>
  truthy(ctx.effective("direct_sdm"))
    ? "Direct SDM bypasses the volume control and sets PCM volume to a fixed -3 dBFS value."
    : "";
// The fixed-volume dBFS *level* (the <fixed> element) only applies when fixed
// volume is enabled. Optimal ISO (volume_fixed) is NOT gated by this — it is an
// independent fixed-volume mode with its own 0/1/2 enable (readme §1.2, attr
// volume_fixed) — so it must not use fixedOff, or disabling fixed volume traps
// a nonzero Optimal ISO the user can no longer clear.
const fixedOff = (/** @type {GrayCtx} */ ctx) =>
  directSdm(ctx) || (truthy(ctx.effective("fixed_volume_enabled")) ? "" : "Requires Fixed volume to be enabled.");
// Optimal ISO supersedes the manual level with an auto-optimized one (manual
// §4.x "Fixed volume check box … optimized level setting"), so they're exclusive.
/** volume_fixed's XML domain is 0 = off / 1 = −3 dB / 2 = −6 dB (readme §1.2), but
 * the value reaches us either as one of those strings (file truth) or as a bare
 * bool (the /config form's checkbox, which cannot express 2). Normalize to the
 * XML domain so both sources read the same. */
export const isoLevel = (/** @type {string | number | boolean | undefined} */ v) => {
  if (v === true) return "1";
  if (v === false || v == null) return "0";
  const s = String(v);
  if (s === "2") return "2";
  return s === "0" || s === "" || s === "false" ? "0" : "1";
};
const isoOn = (/** @type {GrayCtx} */ ctx) => isoLevel(ctx.effective("optimal_iso")) !== "0";
/**
 * Whether the volume control is pinned (manual §4.2, §4.5): fixed volume, Auto
 * headroom (either encoding — file "0"/"1"/"2" or the /config form's lossy
 * bool, both normalized by isoLevel), or a volume range collapsed to 0/0.
 * Takes a getter (key => value) so one predicate serves any view of the config —
 * the signal path passes runningValue to gate the volume-adaptive loudness chip
 * on what the engine is actually applying.
 */
export const volumePinned = (/** @type {(key: string) => string | number | boolean | undefined} */ get) =>
  truthy(get("fixed_volume_enabled")) ||
  isoLevel(get("optimal_iso")) !== "0" ||
  (Number(get("volume_min")) === 0 && Number(get("volume_max")) === 0);
/**
 * Whether the volume is already pinned at a fixed −3 dB, by either of the two
 * independent fixed-volume modes: the manual level (the `<fixed>` element, live
 * only while fixed_volume_enabled is on) or Auto headroom at its −3 dB setting
 * (isoLevel "1", which is also what the /config form's bare checkbox means).
 * Takes a getter, like volumePinned, so the same predicate serves any view.
 */
export const atFixedMinusThree = (/** @type {(key: string) => string | number | boolean | undefined} */ get) =>
  (truthy(get("fixed_volume_enabled")) && Number(get("fixed_volume")) === -3) || isoLevel(get("optimal_iso")) === "1";
/** Grays the manual fixed-volume level while fixed volume is off or Auto headroom supersedes it. */
export const levelGray = (/** @type {GrayCtx} */ ctx) =>
  fixedOff(ctx) || (isoOn(ctx) ? "Auto headroom sets the level automatically." : "");
/**
 * The live volume control is bypassed in three documented cases (manual §4.2,
 * §4.5): Direct SDM, fixed volume / Optimal ISO, and volume min = max = 0.
 * Adaptive volume offsets the live volume, so it is inert in all three.
 * The range controls themselves (min / max / startup level) share the first two
 * reasons but deliberately NOT the third: min = max = 0 is a state you escape by
 * editing min or max, so graying them there would trap the user in it.
 */
export const volumeRangeGray = (/** @type {GrayCtx} */ ctx) =>
  directSdm(ctx) ||
  (truthy(ctx.effective("fixed_volume_enabled")) || isoOn(ctx) ? "Fixed volume bypasses the volume control." : "");
/** volumeRangeGray plus the third case, volume min = max = 0. */
export const volumeBypassed = (/** @type {GrayCtx} */ ctx) =>
  volumeRangeGray(ctx) ||
  (Number(ctx.effective("volume_min")) === 0 && Number(ctx.effective("volume_max")) === 0
    ? "Volume min and max are both 0 — volume control is bypassed. Not suitable for normal cases, since it will cause inter-sample overs and thus limiting either at HQPlayer side or at the DAC side."
    : "");
/** Grays the log file path while logging is off. */
export const logOff = (/** @type {GrayCtx} */ ctx) =>
  truthy(ctx.effective("log_enabled")) ? "" : "Enable logging to set a log file path.";
// The outer gate on every post-process control. `<post_process>` nests inside
// `<matrix>` (readme §1.11.2) and §1.11's `enabled` is the matrix processing
// switch, so a bypassed matrix runs no plugin in the chain: Bauer crossfeed, DAC
// correction and loudness are all inert until the engine is engaged. It composes
// AHEAD of a feature's own reason — a user reading "Enable crossfeed to adjust"
// under a bypassed engine would enable crossfeed and still hear nothing.
// One sentence, three consumers: this gate, the card note (MatrixBypassNote) —
// the sole visible surface, once per card — and Field's caption rule, which
// suppresses it per field so no card repeats it under every control; a grayed
// knob still carries it on hover.
export const MATRIX_BYPASS_REASON = "Matrix engine is bypassed. These settings have no effect.";
/** The outer gate: every post-process control is inert while the matrix engine is bypassed. */
export const matrixBypassed = (/** @type {GrayCtx} */ ctx) =>
  truthy(ctx.effective("matrix_enabled")) ? "" : MATRIX_BYPASS_REASON;
/** A post-process card's sub-controls gray out until the feature is enabled. */
export const crossfeedOff = (/** @type {GrayCtx} */ ctx) =>
  matrixBypassed(ctx) || (truthy(ctx.effective("crossfeed_enabled")) ? "" : "Enable crossfeed to adjust.");
/**
 * Loudness is volume-ADAPTIVE (manual §7): the applied fraction follows the
 * live volume across the loudness range. A bypassed/fixed volume pins it —
 * at −3/−6 dB (above any sane range upper bound) that means 0% applied, ever.
 */
export const loudnessGated = (/** @type {GrayCtx} */ ctx) => {
  const bypassed = matrixBypassed(ctx);
  if (bypassed) return bypassed;
  const r = volumeBypassed(ctx);
  return r ? `${r} Volume-adaptive loudness cannot adapt — use a Matrix EQ for a volume-agnostic equivalent.` : "";
};
/** Loudness sub-controls gray out until loudness is enabled and not gated. */
export const loudnessOff = (/** @type {GrayCtx} */ ctx) =>
  loudnessGated(ctx) || (truthy(ctx.effective("loudness_enabled")) ? "" : "Enable loudness to adjust.");
