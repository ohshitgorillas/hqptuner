// Dropdown option builders. Live-lane dropdowns take their options from the
// engine enumeration lists (the sole authority for names/IDs/order — outline
// §2); the control value is the list *index* (State/Set* use indices). Static
// prose is already merged onto each item by the backend.

import { enums, configByName } from "./state.js";

function rateLabel(item) {
  const hz = Number(item.rate);
  if (!hz) return "Auto";
  if (hz >= 2822400) return `DSD${Math.round(hz / 44100)}`; // SDM rates
  return hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`;
}

// Mode display: fixed order + friendly labels keyed on the live index (the mode
// indices are documented-stable — 0=[source], 1=PCM, 2=SDM — outline §5), not on
// the engine's name string (which is not what we sort against). Order is
// PCM · SDM (DSD) · Auto; only modes the engine actually reports are shown.
// index is a string on the wire ("0"/"1"/"2"); compare as strings.
const MODE_DISPLAY = [
  { index: "1", label: "PCM" },
  { index: "2", label: "SDM (DSD)" },
  { index: "0", label: "Auto" },
];

function orderedModes(list) {
  const present = new Set(list.map((it) => String(it.index)));
  return MODE_DISPLAY.filter((d) => present.has(d.index)).map((d) => ({
    value: d.index,
    label: d.label,
    disabled: false,
    reason: "",
  }));
}

// optionsFor(kind) -> [{value, label, disabled, reason}]
// kind: 'filters' | 'shapers' | 'rates' | 'modes' (live) or 'config' (a form field).
// The rate + backend menus are NOT here — they're fixed lists in schema.js.
export function optionsFor(kind, field) {
  const e = enums.value;
  if (kind === "config") {
    const f = configByName.value[field];
    return ((f && f.options) || []).map((o) => ({ value: o.value, label: o.label, disabled: false, reason: "" }));
  }
  const list = (e && e[kind]) || [];
  if (kind === "modes") return orderedModes(list);
  return list.map((it) => ({
    value: String(it.index),
    label: kind === "rates" ? rateLabel(it) : it.name,
    disabled: false, // per-option graying (rate constraints) lands in Phase 5
    reason: "",
  }));
}
