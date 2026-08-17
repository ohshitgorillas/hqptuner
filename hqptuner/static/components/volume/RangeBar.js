// Volume range — Min / Startup / Max on one shared dBFS axis, full width,
// directly under the master knob. The three values are interdependent (architecture
// §4 — startup is "an integer box from min-max volume"), so a shared axis
// states the relationship three separate boxes never did: the handles cannot
// cross, and the filled span between Min and Max IS the range the daemon will
// allow at runtime.
//
// The axis bounds and the cannot-cross rule live in lib/volume.js: they are the
// daemon's contract rather than this bar's presentation, and keeping them out
// there is what makes them testable at all (nothing can fire an onInput under
// SSR). The scale is linear across that range.
//
// Staging goes through the ordinary edit() path, so these behave exactly like
// the number boxes they replace: same dirty highlight, same Apply, same
// restart. Nothing here writes to the daemon directly.
import { signal } from "@preact/signals";
import { html, wheelGuard, userEdit } from "../../lib/dom.js";
import { AXIS_MIN, AXIS_MAX, num, clampVolume, clampLoudness } from "../../lib/volume.js";
import { volumeShown, volumeRange } from "../../store/signals.js";
import { effective, isDirty } from "../../store/resolve.js";
import { edit } from "../../store/actions.js";
import { grayReason } from "../../store/graying.js";
import { NumberBox } from "../controls/index.js";
import { Card } from "../common.js";

/**
 * @typedef {{ which: string, db: number }} ActiveHandle
 *   Which handle the pointer, drag or focus is on, and the dB to print in its
 *   bubble.
 * @typedef {{ min: number, startup: number, max: number }} VolumeTrio
 *   The three interdependent volume settings, as numbers on the dBFS axis.
 * @typedef {(which: string, key: string) => (v: string | number) => void} SetVolume
 *   Curried stager: pick the handle and its setting key, then hand it a value.
 *   Clamping to the cannot-cross rule happens inside (lib/volume.js).
 */

const SPAN = AXIS_MAX - AXIS_MIN;

// dB -> percentage across the track.
const pct = (/** @type {number} */ db) => ((Number(db) - AXIS_MIN) / SPAN) * 100;

// The gridline rhythm: one line every 10 dB up to the limiter threshold, plus
// the gain ceiling and the resampling ceiling, which do not fall on a decade.
// The rhythm stops at 0 rather than running the axis out — a decade at +10 would
// sit 2px from the +12 line and read as a printing fault.
const DECADES = Array.from({ length: 13 }, (_, i) => AXIS_MIN + i * 10);

// Which gridlines carry a number: every 30 dB, both ends of the axis, and both
// reference levels. The unit is stated once, on the first number read, rather
// than repeated on every tick — the axis is one quantity throughout.
const LABELS = new Map([
  [-120, "-120 dB"],
  [-90, "-90"],
  [-60, "-60"],
  [-30, "-30"],
  [-3, "-3"],
  [0, "0"],
  [AXIS_MAX, "+12"],
]);

// The two levels a listener actually aims at: 0 is the limiter threshold (manual
// §2.5, the soft-knee limiter engages above it) and -3 the recommended ceiling
// when resampling (manual §2.15). Both are worth naming, so both carry a number
// as well as the heavier line.
const STRONG = new Set([0, -3]);

// Line height states the line's job: a reference level, a level carrying a
// number, or the 10 dB rhythm between them.
/**
 * @param {number} db
 * @returns {string}
 */
function weightOf(db) {
  if (STRONG.has(db)) return "strong";
  return LABELS.has(db) ? "major" : "minor";
}

// A label centred on a gridline at either end of the track hangs half its width
// off that end (the axis floor lost its minus sign that way), so the end labels
// anchor to the end instead and the span they describe stays inside the track.
/**
 * @param {number} pos percentage across the track
 * @returns {string}
 */
function anchorOf(pos) {
  if (pos === 0) return "edge-start";
  return pos === 100 ? "edge-end" : "edge-mid";
}

const TICK_LAYOUT = [...DECADES, AXIS_MAX, -3].map((db) => ({
  db,
  pos: pct(db),
  weight: weightOf(db),
  label: LABELS.get(db) || "",
}));

// Volume-adaptive loudness compensation rides the same axis: the full bass and
// treble adjustment applies at or below the lower bound, none at or above the
// upper, and it scales linearly between (readme §1.11.2.1). Defaults match the
// ones the loudness plot reads, so the bounds and the plot never disagree.
const LOUD_LOW = -60;
const LOUD_HIGH = -20;
const LOUD_KEYS = ["loudness_range_low", "loudness_range_high"];

// The bounds ride the bar only while loudness is actually running. That is more
// than the switch: the schema's own gate on these two settings composes the
// matrix engine, the volume path and the switch, and any one of them off means
// there is no compensation to mark. Reusing it keeps the bar and the Loudness
// card answering to one rule — a bypassed matrix takes the marks off the bar
// rather than leaving two dead parentheses on it.
const loudnessOn = () => !grayReason("loudness_range_low");

// Live playback volume rides the same axis as a needle. It is the one mark here
// that is not a setting: its source is the engine, not the config, so it is read
// from the live signals rather than through effective() and it never stages.
//
// Both halves of the engine's report have to be usable for the needle to mean
// anything. The enabled test is deliberately the narrow one Playback.js
// uses — VolumeRange reports the flag as 1 / "1" / true and nothing else
// (protocol §6), and widening it here would draw a needle over a control the
// engine is holding. An unusable level is the same thing to a reader as no
// report at all, so both take the needle off the bar rather than parking it at a
// default: a needle at a made-up position is worse than no needle.
//
// Returns the dB to draw at, clamped onto the axis, or null for "do not draw".
/** @returns {number | null} */
function volumeLive() {
  const vr = volumeRange.value;
  if (!vr || !(vr.enabled === "1" || vr.enabled === 1 || vr.enabled === true)) return null;
  // volumeShown, not volume: the needle tracks the knob under the pointer rather
  // than waiting for the poll to report where the drag has already moved to
  const db = num(volumeShown.value, NaN);
  return Number.isNaN(db) ? null : Math.max(AXIS_MIN, Math.min(AXIS_MAX, db));
}

// The needle: a pointer, not a handle. It carries no input and takes no pointer
// events, because the volume it reports is already adjustable from the knob
// directly above — a second grab on the same value would be two controls
// disagreeing about who owns it.
function PlaybackNeedle() {
  const db = volumeLive();
  if (db === null) return null;
  return html`<div class="vr-needle" style=${`left:${pct(db)}%`} aria-hidden="true"></div>`;
}

// Which handle is being dragged or hovered, for the value bubble. Null = none.
// Typed to the surface this file uses: @preact/signals is ambient `any`
// (types/vendor.d.ts), so nothing else would describe what `.value` holds.
/** @type {{ value: ActiveHandle | null }} */
const active = signal(null);
// "no handle touched", named once because a bare `null` literal types as `any`
// under this checking tier and would leave every clearing handler untyped.
/** @type {ActiveHandle | null} */
const NONE = null;

// The three settings are one feature to the user, so the card speaks for the
// group: whichever key grays first supplies the reason (DirectSDM grays the
// lot), and any one staged edit lights the whole card. Declaration order below
// IS the priority order for the reason.
const KEYS = ["volume_max", "volume_min", "startup_volume"];
const groupReason = () => KEYS.reduce((found, k) => found || grayReason(k), "");
// A loudness bound counts toward the card's highlight only while the bounds are
// on the bar: the same two settings sit on the Loudness card, and lighting both
// cards is how the user sees that the value they are changing lives in two
// places. Gray is not shared — a loudness bound grays on its own reasons, and
// the three volume settings must not gray with it.
const groupDirty = () => KEYS.some(isDirty) || (loudnessOn() && LOUD_KEYS.some(isDirty));

// Per-control highlight: only the setting actually edited carries it.
const dirtyClass = (/** @type {string} */ key) => (isDirty(key) ? "dirty" : "");

// The bounds are two more handles on the same track. They do not join the
// cannot-cross rule the volume trio obeys — that rule is about Min, Startup and
// Max, and this pair's only ordering constraint is its own (lib/volume.js).
//
// Each spans the track's whole axis, as Min does, because a handle's thumb
// travels its own min..max across the width it is given: a bound input stopping
// at 0 would map 120 dB onto a track drawn for 132 and land every bound short of
// its gridline. The daemon's 0 dBFS ceiling is the clamp's job instead.
function LoudnessBounds() {
  if (!loudnessOn()) return null;
  const low = num(effective("loudness_range_low"), LOUD_LOW);
  const high = num(effective("loudness_range_high"), LOUD_HIGH);
  const cur = { low, high };

  const bound = (
    /** @type {string} */ which,
    /** @type {string} */ key,
    /** @type {number} */ db,
    /** @type {string} */ label,
  ) => html`
    <input
      type="range"
      class="vr-handle vr-loud-${which} ${dirtyClass(key)}"
      min=${AXIS_MIN}
      max=${AXIS_MAX}
      step="1"
      value=${db}
      aria-label=${label}
      title=${`${label}: ${db} dBFS`}
      onWheel=${wheelGuard}
      onInput=${userEdit(db, (e) => edit(key, String(clampLoudness(which, e.target.value, cur))))}
    />
  `;

  return html`
    <div class="vr-loud" style=${`left:${pct(low)}%;right:${100 - pct(high)}%`}></div>
    ${bound("low", "loudness_range_low", low, "Loudness lower bound")}
    ${bound("high", "loudness_range_high", high, "Loudness upper bound")}
  `;
}

// The parentheses and the needle need naming the same way the brackets and the
// pin do, but the row of number boxes is distributed Min-left / Max-right — a
// fourth group in it would break that — and neither of these marks has a box on
// this card at all. So they get their own row, each entry appearing exactly when
// the mark it names is on the bar.
function BarLegend() {
  const loud = loudnessOn();
  const needle = volumeLive() !== null;
  if (!loud && !needle) return null;
  return html`
    <div class="vr-legend">
      ${
        loud
          ? html`<div class="vr-loud-legend">
              <span class="vr-loud-keys">
                <span class="vr-key vr-key-loud-low"></span>
                <span class="vr-key vr-key-loud-high"></span>
              </span>
              <span>Loudness bounds</span>
            </div>`
          : null
      }
      ${
        needle
          ? html`<div class="vr-needle-legend">
              <span class="vr-key vr-key-needle"></span>
              <span>Playback volume</span>
            </div>`
          : null
      }
    </div>
  `;
}

// One draggable bound on the track. Hover, drag and focus all publish `active`,
// which is what puts the dBFS bubble over the handle being touched.
/**
 * @param {{
 *   which: string, hkey: string, db: number, label: string, disabled: boolean, set: SetVolume,
 * }} props
 */
function RangeHandle({ which, hkey, db, label, disabled, set }) {
  return html`
    <input
      type="range"
      class="vr-handle vr-${which} ${dirtyClass(hkey)}"
      min=${AXIS_MIN}
      max=${AXIS_MAX}
      step="1"
      value=${db}
      disabled=${disabled}
      aria-label=${label}
      onWheel=${wheelGuard}
      onInput=${userEdit(db, (e) => {
        active.value = { which, db: Number(e.target.value) };
        set(which, hkey)(e.target.value);
      })}
      onPointerDown=${() => (active.value = { which, db })}
      onPointerUp=${() => (active.value = NONE)}
      onMouseEnter=${() => (active.value = { which, db })}
      onMouseLeave=${() => (active.value = NONE)}
      onBlur=${() => (active.value = NONE)}
    />
  `;
}

// The same three bounds as typed numbers. Startup is fenced by the other two, so
// it can never be set outside the range it starts inside.
/** @param {{ cur: VolumeTrio, reason: string, set: SetVolume }} props */
function VolumeBoxes({ cur, reason, set }) {
  const { min, startup, max } = cur;
  return html`
    <div class="vr-boxes">
      <label class="vr-box ${dirtyClass("volume_min")}">
        <span class="vr-key vr-key-min"></span>
        <span>Min</span>
        <${NumberBox}
          value=${min}
          min=${AXIS_MIN}
          max=${0}
          step="1"
          disabled=${!!reason}
          onChange=${set("min", "volume_min")}
        />
      </label>
      <label class="vr-box ${dirtyClass("startup_volume")}">
        <span class="vr-key vr-key-startup"></span>
        <span>Startup</span>
        <${NumberBox}
          value=${startup}
          min=${min}
          max=${max}
          step="1"
          disabled=${!!reason}
          onChange=${set("startup", "startup_volume")}
        />
      </label>
      <label class="vr-box ${dirtyClass("volume_max")}">
        <span class="vr-key vr-key-max"></span>
        <span>Max</span>
        <${NumberBox}
          value=${max}
          min=${AXIS_MIN}
          max=${AXIS_MAX}
          step="1"
          disabled=${!!reason}
          onChange=${set("max", "volume_max")}
        />
      </label>
    </div>
  `;
}

/** Renders the Range card — a dB track with draggable min/startup/max handles over the loudness bounds and needle. */
export function VolumeRangeBar() {
  const max = num(effective("volume_max"), 0);
  const min = num(effective("volume_min"), -60);
  const startup = num(effective("startup_volume"), min);
  const cur = { min, startup, max };

  const reason = groupReason();
  const dirty = groupDirty();

  /** @type {SetVolume} */
  const set = (which, key) => (v) => edit(key, String(clampVolume(which, v, cur)));

  const handle = (
    /** @type {string} */ which,
    /** @type {string} */ hkey,
    /** @type {number} */ db,
    /** @type {string} */ label,
  ) => html`<${RangeHandle} which=${which} hkey=${hkey} db=${db} label=${label} disabled=${!!reason} set=${set} />`;

  /** @type {Record<string, number>} */
  const bubbleFor = { min, startup, max };
  const bub = active.value;

  return html`
    <${Card} title="Range" cardClass=${`vr-card ${dirty ? "dirty" : ""}`} hint=${reason}>
        <div class="vr-track ${reason ? "disabled" : ""}">
          <!-- the span the user will actually be able to reach at runtime -->
          <div class="vr-fill" style=${`left:${pct(min)}%;right:${100 - pct(max)}%`}></div>
          <!-- bounds first: where a bracket and a parenthesis land on the same
               spot, the volume handle above takes the grab -->
          <${LoudnessBounds} />
          ${TICK_LAYOUT.map(
            (t) => html`
              <div class="vr-tick ${t.weight}" style=${`left:${t.pos}%`}></div>
              ${
                t.label
                  ? html`<span class="vr-tick-label ${anchorOf(t.pos)}" style=${`left:${t.pos}%`}>${t.label}</span>`
                  : null
              }
            `,
          )}
          <!-- the needle sits under the handles: it takes no pointer events, but
               stacking it below them keeps that true even if that ever changes -->
          <${PlaybackNeedle} />
          ${handle("min", "volume_min", min, "Min volume")}
          ${handle("startup", "startup_volume", startup, "Startup volume")}
          ${handle("max", "volume_max", max, "Max volume")}
          ${
            bub
              ? html`<span class="vr-bubble vr-bubble-${bub.which}" style=${`left:${pct(bubbleFor[bub.which])}%`}>
                  ${bubbleFor[bub.which]} dBFS
                </span>`
              : null
          }
        </div>
        <${VolumeBoxes} cur=${cur} reason=${reason} set=${set} />
        <${BarLegend} />
    <//>
  `;
}
