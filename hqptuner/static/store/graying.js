// Derived enable/gray state for a control. In Phase 4 this is a thin framework:
// a control may declare `grayWhen(ctx)` in the schema and it is consulted here.
// The full behavior graph (mode-dependent graying, rate-aware shaper narrowing,
// filter narrowing, mode-switch coherence — outline §5) lands in Phase 5 and
// slots in here as more rules, with no store or component changes.

import { schema } from "./schema.js";
import { modeName, effective } from "./state.js";

// Form fields with no grounded XML location in the corrective apply lane
// (mirrors presetconf.UNGROUNDED). The apply refuses them rather than write a
// guessed attribute, so the control is disabled up front — a disabled control
// can't stage an edit the backend would 422, and the reason shows on hover.
const UNGROUNDED = new Set(["idle_time", "alsa_dop", "net_dop", "fixed_volume", "fixed_volume_enabled"]);

// grayReason(key) -> '' when enabled, else a short human reason (the control's
// tooltip when disabled).
export function grayReason(key) {
  const e = schema[key];
  if (!e) return "";
  if (e.field && UNGROUNDED.has(e.field)) return "not yet supported by config apply";
  if (!e.grayWhen) return "";
  return e.grayWhen({ mode: modeName.value, effective }) || "";
}
