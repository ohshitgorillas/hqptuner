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

// adviceNote(key) -> '' when the control's setting is live in the current state,
// else a short note saying which state it belongs to. Same ctx and same shape as
// grayReason, one difference that is the whole point: it never disables. A
// setting that only bites in the OTHER output mode is still one the user may
// want staged correctly before switching modes, so the control stays editable
// and only says where it applies (schema `adviseWhen`).
/**
 * The schema's note saying which state a control's setting belongs to, "" when it is
 * live in the current one. Never disables.
 * @param {string} key
 * @returns {string}
 */
export function adviceNote(key) {
  const e = schema[key];
  if (!e) return "";
  if (!e.adviseWhen) return "";
  return e.adviseWhen({ mode: modeName.value, effective }) || "";
}
