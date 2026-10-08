// Colour tokens as canvas painters read them: a hex token as [r, g, b], and the spectrogram ramp's lookup table built
// from the --spec-0..5 stops in force on an element.

import { rampLut } from "../../model/gauges/meter-plot.js";

/**
 * A colour token's value as [r, g, b], or `fallback` when it is not a hex colour.
 *
 * @param {string} value
 * @param {number[]} fallback
 * @returns {number[]}
 */
export function rgb(value, fallback) {
  const m = value.trim().replace("#", "");
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(m)) return fallback;
  const full = m.length === 3 ? [...m].map((c) => c + c).join("") : m;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/**
 * The spectrogram ramp's lookup table from the --spec-* stops in `cs`, a stop that is not a hex colour standing in
 * as a placeholder shade.
 *
 * @param {CSSStyleDeclaration} cs
 * @returns {Uint8ClampedArray}
 */
export function specRamp(cs) {
  const stops = [
    cs.getPropertyValue("--spec-0"),
    cs.getPropertyValue("--spec-1"),
    cs.getPropertyValue("--spec-2"),
    cs.getPropertyValue("--spec-3"),
    cs.getPropertyValue("--spec-4"),
    cs.getPropertyValue("--spec-5"),
  ];
  return rampLut(stops.map((v, i) => rgb(v, [i * 50, i * 40, i * 20])));
}
