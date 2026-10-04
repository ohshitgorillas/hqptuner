// How much of the maximum loudness shelving the engine applies right now, as a
// whole percent. Loudness is volume-adaptive (manual §7): full shelving at or
// below the range's lower bound, none at or above its upper bound. The figure
// reads what the engine is running, never a staged edit or a knob drag on the
// loudness controls, and follows the volume the page shows, so it moves with a
// dragged volume knob before the engine reports. It is 0 wherever loudness
// cannot reach the output: a bypassed matrix engine (`<post_process>` nests
// inside `<matrix>`, readme §1.11.2), loudness switched off, or a pinned volume.

import { volumeShown } from "../signals.js";
import { runningValue } from "../resolve.js";
import { volumePinned } from "../schema/gray.js";
import { num, truthy } from "../../lib/coerce.js";
import { shelfScale } from "../../vendor/eqlab/core/dsp/curves.js";
import { percentApplied } from "../../model/gauges/loudness.js";

/**
 * The whole percent of the maximum loudness shelving applied at the shown
 * volume, from the running loudness range; 0 while the matrix engine is
 * bypassed, loudness is off or the volume is pinned.
 *
 * @returns {number}
 */
export function loudnessApplied() {
  if (!truthy(runningValue("matrix_enabled"))) return 0;
  if (!truthy(runningValue("loudness_enabled"))) return 0;
  if (volumePinned(runningValue)) return 0;
  const rangeLow = num(runningValue("loudness_range_low"), -60);
  const rangeHigh = num(runningValue("loudness_range_high"), -20);
  return percentApplied(shelfScale(num(volumeShown.value, rangeHigh), rangeLow, rangeHigh));
}
