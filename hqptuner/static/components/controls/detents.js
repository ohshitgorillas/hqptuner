// The detented slider: a range input that travels over an option list's
// INDICES, one detent and one tick per option, with a read-only readout.
//
// It exists for a select-typed setting whose options form a scale rather than a
// set of names — FFT filter length, whose eight values run 128 to 16384 and mean
// "gentler roll-off" to "steeper" (manual §4.7). A dropdown makes that scale
// read as eight unrelated tokens; a value-space slider makes illegal positions
// reachable and then has to repair them. Index space has neither problem: the
// native `step="1"` means the thumb cannot rest between options, so what the
// control emits is always an element of the daemon's own option array rather
// than a number this module invented.
//
// There is deliberately no number box. It would be the only path to a value the
// form does not list, and a box that silently rewrites what was typed is worse
// than one that never accepts it. Eight values are seven arrow keys apart.
//
// Option values stay STRINGS end to end — they are the daemon's own tokens, and
// the value that goes back on the wire is the token that came off it, never a
// number this module rounded.
import { html, wheelGuard, userEdit } from "../../lib/dom.js";
import { pctOf, fillStyle, tickLeft } from "./index.js";

/**
 * @typedef {import("../binder.js").FieldOptions} FieldOptions
 */

/**
 * The index of the option carrying `value`, or of the numerically nearest one
 * when the list does not carry it at all — a preset can hold a value the
 * running engine no longer offers, and the thumb has to sit somewhere.
 * @param {string | number | boolean | undefined} value
 * @param {{ value: string | number }[]} options
 * @returns {number}
 */
export function stepIndex(value, options) {
  if (!options.length) return 0;
  const exact = options.findIndex((o) => String(o.value) === String(value));
  if (exact >= 0) return exact;
  const v = Number(value);
  if (!Number.isFinite(v)) return 0;
  let best = 0;
  let dist = Infinity;
  options.forEach((o, i) => {
    const d = Math.abs(Number(o.value) - v);
    if (d < dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}

/**
 * The option token at `index`, clamped into the list — the value that goes back
 * to the daemon, byte-identical to the one it listed.
 * @param {string | number} index
 * @param {{ value: string | number }[]} options
 * @returns {string | number}
 */
export function stepValue(index, options) {
  if (!options.length) return "";
  const i = Math.max(0, Math.min(options.length - 1, Math.round(Number(index))));
  return options[i].value;
}

/**
 * Renders a range input over an option list's indices, one tick per option,
 * with a read-only readout of the current value.
 * @param {{ value: string | number | boolean | undefined, options?: { value: string | number }[],
 *   disabled?: boolean, onChange?: (v: string | number) => void }} props
 */
export function Steps({ value, options, disabled, onChange }) {
  const opts = options || [];
  // A one-option list has no travel and a zero-option list has no positions;
  // both render dead rather than dividing the track by zero.
  const last = Math.max(0, opts.length - 1);
  const idx = stepIndex(value, opts);
  const send = (/** @type {string} */ v) => onChange && onChange(stepValue(v, opts));
  return html`
    <span class="slidernum">
      <span class="range-wrap steps-wrap">
        <input
          class="rng"
          type="range"
          value=${String(idx)}
          min="0"
          max=${String(last)}
          step="1"
          disabled=${disabled || last === 0}
          style=${fillStyle(pctOf(idx, 0, last), "min")}
          onWheel=${wheelGuard}
          onInput=${userEdit(String(idx), (/** @type {{ target: HTMLInputElement }} */ e) => send(e.target.value))}
        />
        ${opts.map((_, i) => html`<span class="tick" style=${tickLeft(pctOf(i, 0, last))}></span>`)}
      </span>
      <span class="slider-val">${value}</span>
    </span>
  `;
}
