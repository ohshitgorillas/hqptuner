// Derived enable/gray state for a control. In Phase 4 this is a thin framework:
// a control may declare `grayWhen(ctx)` in the schema and it is consulted here.
// The full behavior graph (mode-dependent graying, rate-aware shaper narrowing,
// filter narrowing, mode-switch coherence — architecture §5) lands in Phase 5 and
// slots in here as more rules, with no store or component changes.

import { schema } from "./schema.js";
import { modeName } from "./signals.js";
import { effective } from "./resolve.js";

// grayReason(key) -> '' when enabled, else a short human reason (the control's
// tooltip when disabled). Every field is applyable now; graying is purely the
// schema's own mode/state rules (grayWhen).
export function grayReason(key) {
  const e = schema[key];
  if (!e) return "";
  if (!e.grayWhen) return "";
  return e.grayWhen({ mode: modeName.value, effective }) || "";
}
