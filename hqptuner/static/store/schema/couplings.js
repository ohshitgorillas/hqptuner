// The fields one staged edit drags along with it. edit() (store/actions.js) runs
// each coupling over the stage POST it is building, so a coupled field moves in
// the same request as the edit that moved it.

import { fixedVolumeMode } from "./gray.js";

// Bauer crossfeed preset <-> params coupling: selecting a named preset loads its
// frequency/level (so the graph shows that preset); adjusting either param
// switches the preset to "custom". Values are the libbs2b canonical parameter
// sets HQPlayer's Bauer plugin is built on. Applied within the same stage POST
// as the primary edit, so the coupled fields move together.
/** @type {Record<string, [string, string]>} */
const BAUER_PRESETS = { default: ["700", "4.5"], cmoy: ["700", "6.0"], jmeier: ["650", "9.5"] };

/**
 * Load a named Bauer preset's frequency and level, or switch the preset to custom on a frequency or level edit.
 *
 * @param {string} key
 * @param {string | number | boolean} value
 * @param {Record<string, string>} http the same POST's http lane, written in place
 * @returns {void}
 */
export function applyBauerCoupling(key, value, http) {
  if (key === "crossfeed_preset" && BAUER_PRESETS[String(value)]) {
    const [f, l] = BAUER_PRESETS[String(value)];
    http.post_bauer_frequency = f;
    http.post_bauer_level = l;
  } else if (key === "crossfeed_frequency" || key === "crossfeed_level") {
    http.post_bauer_preset = "custom";
  }
}

// Fixed volume and Auto headroom (volume_fixed) are mutually exclusive fixed-
// volume modes, and either one on bypasses the live volume control. Graying one
// from the other would leave a grayed-but-nonzero Auto headroom locking the
// volume control with no reachable control to clear it. So enabling either mode
// CLEARS the other, as a visible staged edit in the same POST: both moves show
// as staged, nothing happens silently.
/**
 * Clear the other fixed-volume mode when an edit turns one of them on.
 *
 * @param {string} key
 * @param {string | number | boolean} value
 * @param {Record<string, string>} http the same POST's http lane, written in place
 * @returns {void}
 */
export function applyFixedVolumeCoupling(key, value, http) {
  const mode = fixedVolumeMode((k) => (k === key ? value : undefined));
  if (key === "fixed_volume_enabled" && mode === "manual") http.volume_fixed = "0";
  else if (key === "optimal_iso" && mode === "auto") http.fixed_volume_enabled = "0";
}
