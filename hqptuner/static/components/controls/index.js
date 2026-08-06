// Dumb presentational primitives. Each takes value/options/constraints +
// onChange and renders — no store knowledge. The Field binder wires them to the
// three-tree store by control key. Reusable and independently testable.

import { useRef, useEffect } from "preact/hooks";
import { html, wheelGuard, userEdit } from "../../lib/dom.js";
import { truthy } from "../../lib/coerce.js";

/**
 * @typedef {string | number | boolean | undefined} CtrlValue
 *   A control's rendered value, as store/resolve.js `effective()` hands it over:
 *   a staged edit is the string the control wrote, a /config baseline may be a
 *   real number or bool, and an unset control has none.
 * @typedef {SchemaOption & { disabled?: boolean, reason?: string, dirty?: boolean }} RenderOption
 *   One row of an option list as it reaches these widgets. Wider than either
 *   shared type on purpose: Field.js hands over a schema literal's SchemaOption
 *   list unchanged when the entry carries `options`, and an OptionItem from the
 *   option stores when it carries `optionsFrom` — so disabled/reason are present
 *   on one path only. `dirty` is added by VolumeTab.js for the staged-edit dot.
 * @typedef {(v: string | number) => void} ValueSink
 *   What every widget reports an edit through. Values leave as the DOM spelled
 *   them (strings) except where the option list carried a number.
 * @typedef {{ target: HTMLInputElement }} InputEv
 *   The subset of the DOM event these handlers read: the input they are bound to.
 */

/**
 * @param {CtrlValue} v
 * @returns {string}
 */
const s = (v) => (v == null ? "" : String(v));

// Clicking the button that is already active reports nothing: `onChange` means
// the value changed, and every caller takes it as one. On the LIVE page that
// event is a write to the engine — re-picking the running output mode would
// re-enumerate and drop the engine's rate pin (store/live/write.js) for a selection the
// user did not alter.
/**
 * @param {{ value: CtrlValue, options: RenderOption[] | undefined, disabled?: boolean, onChange: ValueSink }} props
 */
export function Segment({ value, options, disabled, onChange }) {
  return html`
    <span class="segment">
      ${(options || []).map(
        (o) => html`
          <button
            type="button"
            class=${s(o.value) === s(value) ? "seg active" : "seg"}
            disabled=${disabled || !!o.disabled}
            title=${o.reason || undefined}
            onClick=${() => s(o.value) !== s(value) && onChange(o.value)}
          >
            ${o.label}${o.dirty ? html`<span class="seg-dirty-dot" aria-label="staged edits" />` : null}
          </button>
        `,
      )}
    </span>
  `;
}

/**
 * @param {{ value: CtrlValue, options: RenderOption[] | undefined, disabled?: boolean, onChange: ValueSink }} props
 */
export function Dropdown({ value, options, disabled, onChange }) {
  return html`
    <select
      value=${s(value)}
      disabled=${disabled}
      onWheel=${wheelGuard}
      onChange=${(/** @type {{ target: HTMLSelectElement }} */ e) => onChange(e.target.value)}
    >
      ${(options || []).map(
        (o) => html`
          <option value=${s(o.value)} disabled=${o.disabled}>${o.label}${o.reason ? ` — ${o.reason}` : ""}</option>
        `,
      )}
    </select>
  `;
}

// Typed inputs are UNCONTROLLED while focused. `onChange` is the native change
// event (commit on blur), so a half-typed value lives only in the DOM until then
// — and the 2 s poll re-renders constantly. A controlled `value=` would reset the
// field mid-edit (typing "-1" snapped straight back to "0"). So sync from the
// store by ref, and only when the user isn't in the field. Same rule the live
// volume slider follows.
/**
 * @param {CtrlValue} value
 */
function useSyncWhenIdle(value) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el) el.value = s(value);
  });
  return ref;
}

/**
 * @typedef {{ value: CtrlValue, min?: string | number, max?: string | number, step?: string | number,
 *   disabled?: boolean, onChange: ValueSink }} BoundedProps
 */

/**
 * @param {BoundedProps} props
 */
export function NumberBox({ value, min, max, step, disabled, onChange }) {
  const ref = useSyncWhenIdle(value);
  return html`
    <input
      type="number"
      ref=${ref}
      min=${min}
      max=${max}
      step=${step == null ? 1 : step}
      disabled=${disabled}
      onWheel=${wheelGuard}
      onChange=${(/** @type {InputEv} */ e) => onChange(e.target.value)}
    />
  `;
}

/**
 * @param {{ value: CtrlValue, disabled?: boolean, onChange: ValueSink }} props
 */
export function TextBox({ value, disabled, onChange }) {
  const ref = useSyncWhenIdle(value);
  return html`<input
    type="text"
    ref=${ref}
    disabled=${disabled}
    onChange=${(/** @type {InputEv} */ e) => onChange(e.target.value)}
  />`;
}

/**
 * @param {{ value: CtrlValue, disabled?: boolean, onChange: ValueSink }} props
 */
export function Checkbox({ value, disabled, onChange }) {
  return html`
    <input
      type="checkbox"
      checked=${truthy(value)}
      disabled=${disabled}
      onChange=${(/** @type {InputEv} */ e) => onChange(e.target.checked ? "1" : "0")}
    />
  `;
}

/**
 * @param {BoundedProps} props
 */
export function Slider({ value, min, max, step, disabled, onChange }) {
  return html`
    <span class="slider">
      <input
        type="range"
        value=${s(value)}
        min=${min}
        max=${max}
        step=${step == null ? 1 : step}
        disabled=${disabled}
        onWheel=${wheelGuard}
        onChange=${userEdit(s(value), (/** @type {InputEv} */ e) => onChange(e.target.value))}
      />
      <span class="slider-val">${s(value)}</span>
    </span>
  `;
}

// Slider + number box bound to one value: slider for coarse feel, box for the
// exact figure (a fine step over a wide range is unusable on a slider alone).
// Optional `ticks` (values) draw reference marks.
/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
const pctOf = (v, lo, hi) => (hi === lo ? 0 : Math.max(0, Math.min(1, (Number(v) - lo) / (hi - lo))) * 100);

// Which end the fill grows from. `anchor="max"` (the default) fills leftward
// from the right, so its length reads as the amount moved AWAY from max — right
// for a reduction, e.g. attenuation on a −12…0 dB range: 0 = empty, −12 = full,
// rather than the misleading "full track = maxed" of a default range.
// `anchor="min"` fills left-to-right like a native range, which is what a value
// that grows with the thing it names wants (speaker angle, correction strength).
// The track sets `appearance: none`, so the fill is drawn here either way — a
// bare `accent-color` renders nothing once the native track is gone.
/**
 * @param {number} pct
 * @param {string | undefined} anchor
 * @returns {string}
 */
const fillStyle = (pct, anchor) => {
  const [from, to] =
    anchor === "min" ? ["var(--accent)", "var(--surface-raised)"] : ["var(--surface-raised)", "var(--accent)"];
  return `background:linear-gradient(to right, ${from} 0%, ${from} ${pct}%, ${to} ${pct}%, ${to} 100%)`;
};

// A caller with a single `onChange` gets drag-only, and deliberately does NOT
// gain a second event at the end of a drag — that would stage every value
// twice. Splitting means preview on drag, stage on release.
/**
 * @param {{ onChange?: ValueSink, onDrag?: ValueSink, onCommit?: ValueSink }} handlers
 * @returns {{ drag: ValueSink, commit: ValueSink, split: boolean }}
 */
function events({ onChange, onDrag, onCommit }) {
  return { drag: onDrag || onChange, commit: onCommit || onChange, split: !!(onDrag || onCommit) };
}

// The number half: the figure, an optional unit sharing its chrome, and an
// optional sub-caption under it (a second reading of the same quantity).
/**
 * @param {{ shown: string, min?: string | number, max?: string | number, step: string | number,
 *   unit?: string, sub?: string, disabled?: boolean, onCommit: ValueSink }} props
 */
function ReadBox({ shown, min, max, step, unit, sub, disabled, onCommit }) {
  return html`
    <span class="slidernum-readbox">
      <label class="slidernum-box">
        <input
          type="number"
          value=${shown}
          min=${min}
          max=${max}
          step=${step}
          disabled=${disabled}
          onWheel=${wheelGuard}
          onChange=${(/** @type {InputEv} */ e) => onCommit(e.target.value)}
        />
        ${unit ? html`<span class="slidernum-unit">${unit}</span>` : null}
      </label>
      ${sub ? html`<span class="slidernum-sub">${sub}</span>` : null}
    </span>
  `;
}

// `boxStep` is the number box's own step, which need not be the slider's: a
// slider wants a detent coarse enough to hit, while the box can take any value
// in range (step="any").
// `scale="log"`: the RANGE TRACK works in log space (equal travel per octave —
// what a 20 Hz–20 kHz or 0.1–16 Q axis needs) while value, box, ticks and both
// callbacks stay in real units. Log implies step="any" on the track; the box
// keeps boxStep. min must be > 0.
// A log track cannot rely on the native `change` event for its release commit:
// the caller's drag patch rounds in real units, so the re-rendered value
// (enc∘round∘dec) is never byte-equal to the thumb's raw position — Preact
// rewrites `.value` mid-drag, the browser then counts the value as program-set
// and skips `change` on release. Log tracks commit on pointerup instead (a
// linear track's rounded value matches its own step, so its `change` fires and
// a second commit with the identical value is harmless where both arrive).
/**
 * @param {{ value: CtrlValue, min: string | number, max: string | number, step?: string | number,
 *   boxStep?: string | number, ticks?: number[], unit?: string, sub?: string,
 *   format?: (n: number) => string, disabled?: boolean, anchor?: string, scale?: string,
 *   onChange?: ValueSink, onDrag?: ValueSink, onCommit?: ValueSink }} props
 */
export function SliderNumber(props) {
  const { value, min, max, step, boxStep, ticks, unit, sub, format, disabled, anchor, scale } = props;
  const st = step == null ? 1 : step;
  const log = scale === "log";
  /**
   * @param {string | number | boolean | undefined} v
   * @returns {number}
   */
  const enc = (v) => (log ? Math.log(Number(v)) : Number(v));
  /**
   * @param {string | number} v
   * @returns {string | number}
   */
  const dec = (v) => (log ? Math.exp(Number(v)) : v);
  const lo = Number(min);
  const hi = Number(max);
  const pct = pctOf(enc(value), enc(lo), enc(hi));
  const fill = fillStyle(pct, anchor);
  const { drag, commit, split } = events(props);
  const track = log
    ? { value: s(enc(value)), min: s(enc(lo)), max: s(enc(hi)), step: "any" }
    : { value: s(value), min, max, step: st };
  return html`
    <span class="slidernum">
      <span class="range-wrap">
        <input
          class="rng"
          type="range"
          value=${track.value}
          min=${track.min}
          max=${track.max}
          step=${track.step}
          disabled=${disabled}
          style=${fill}
          onWheel=${wheelGuard}
          onInput=${userEdit(track.value, (/** @type {InputEv} */ e) => drag(dec(e.target.value)))}
          onChange=${split ? userEdit(track.value, (/** @type {InputEv} */ e) => commit(dec(e.target.value))) : null}
          onPointerUp=${split && log ? (/** @type {InputEv} */ e) => commit(dec(e.target.value)) : null}
        />
        ${(ticks || []).map((t) => html`<span class="tick" style=${`left:${pctOf(enc(t), enc(lo), enc(hi))}%`}></span>`)}
      </span>
      <${ReadBox}
        shown=${format ? format(Number(value)) : s(value)}
        min=${min}
        max=${max}
        step=${boxStep || st}
        unit=${unit}
        sub=${sub}
        disabled=${disabled}
        onCommit=${commit}
      />
    </span>
  `;
}

/**
 * @param {{ value: CtrlValue, options: RenderOption[] | undefined, disabled?: boolean, onChange: ValueSink }} props
 */
export function RadioGroup({ value, options, disabled, onChange }) {
  return html`
    <span class="radio-group">
      ${(options || []).map(
        (o) => html`
          <label>
            <input
              type="radio"
              checked=${s(o.value) === s(value)}
              disabled=${disabled}
              onChange=${() => onChange(o.value)}
            />${o.label}
          </label>
        `,
      )}
    </span>
  `;
}
