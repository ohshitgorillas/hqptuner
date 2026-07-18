// Derived enable/gray state for a control. In Phase 4 this is a thin framework:
// a control may declare `grayWhen(ctx)` in the schema and it is consulted here.
// The full behavior graph (mode-dependent graying, rate-aware shaper narrowing,
// filter narrowing, mode-switch coherence — outline §5) lands in Phase 5 and
// slots in here as more rules, with no store or component changes.

import { schema } from "./schema.js";
import { modeName, effective } from "./state.js";

// grayReason(key) -> '' when enabled, else a short human reason (shown inline).
export function grayReason(key) {
  const e = schema[key];
  if (!e || !e.grayWhen) return "";
  return e.grayWhen({ mode: modeName.value, effective }) || "";
}
