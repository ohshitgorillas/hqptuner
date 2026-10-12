// The settings a daemon restart dropped: one engine alert while the health report lists any, one row per setting.
// Tapping its line clears the report.
//
// Each row reads the setting's UI label and the engine's name for its value. Where the engine names no value, the row
// reads the label the setting's control gives that value, else the value itself; a pinned rate, given in Hz, reads as
// the page prints a rate.
import { computed } from "@preact/signals";
import { api } from "../../lib/api.js";
import { health } from "../signals.js";
import { refreshHealth } from "../sync.js";
import { hz } from "../../lib/units.js";
import { wireLabel } from "../ui/wirelabels.js";
import { rowOptions } from "../faceplate/drawer/rows.js";

/** @typedef {{ field: string, value: string, name: string | null }} WrittenSetting */
/** @typedef {import("../../model/shell/alerts.js").AlertItem} AlertItem */

const DROPPED_MESSAGE = "HQPlayer restarted unexpectedly and some settings were lost:";

/**
 * How a value the engine names nothing for reads: a rate as the page prints one, any other as its control labels it,
 * else as itself.
 *
 * @param {WrittenSetting} s
 * @returns {string}
 */
function unnamed(s) {
  if (s.field === "rate") return hz(Number(s.value), 3);
  return rowOptions(s.field).find((o) => String(o.value) === s.value)?.label ?? s.value;
}

/**
 * One dropped setting's row.
 *
 * @param {WrittenSetting} s
 * @returns {AlertItem}
 */
function droppedItem(s) {
  return { label: wireLabel(s.field), value: s.name ?? unnamed(s) };
}

/** The dropped-settings alert, or null while the health report lists none. */
export const droppedAlert = computed(() => {
  /** @type {WrittenSetting[]} */
  const dropped = (health.value || {}).dropped_settings || [];
  if (!dropped.length) return null;
  return {
    kind: "dropped-settings",
    sev: "warn",
    text: DROPPED_MESSAGE,
    items: dropped.map(droppedItem),
    act: clearDropped,
  };
});

/**
 * Forget the dropped settings, then take a health reading, so the alert goes once that reading lists none. A refused
 * clear leaves the alert up, to be cleared again.
 *
 * @returns {Promise<void>}
 */
async function clearDropped() {
  try {
    await api.clearDroppedSettings();
  } catch {
    return;
  }
  await refreshHealth();
}
