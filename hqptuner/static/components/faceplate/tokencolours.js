// Colour tokens as canvas painters read them: the spectrogram ramp's lookup table built from the --spec-0..5 stops in
// force on an element.

import { rgb } from "../../lib/spectroraster.js";
import { rampLut } from "../../model/gauges/meter-plot.js";

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
