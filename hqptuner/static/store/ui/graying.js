// Derived enable/gray state for a control: a control may declare `grayWhen(ctx)`
// in the schema and it is consulted here. Further rules (mode-dependent graying,
// rate-aware shaper narrowing, filter narrowing, mode-switch coherence —
// architecture §7) slot in here with no store or component changes.

import { schema } from "../schema.js";
import { modeName } from "../signals.js";
import { effective } from "../resolve.js";

// grayReason(key) -> '' when enabled, else a short human reason (the control's
// tooltip when disabled). Every field is applyable now; graying is purely the
// schema's own mode/state rules (grayWhen).
/**
 * The schema's own reason for disabling a control, "" when it is enabled.
 * @param {string} key
 * @returns {string}
 */
export function grayReason(key) {
  const e = schema[key];
  if (!e) return "";
  if (!e.grayWhen) return "";
  return e.grayWhen({ mode: modeName.value, effective }) || "";
}
