// Cross-references: a line naming another place as its cause or fix carries a link there, `Name ›`, the place's own
// name. Each place is a drawer, the tab it shows and the name the link prints. A reason line names its place by its
// text; a link shows only while that place is out of sight, so a line on the tab it names carries none, while one on
// another tab of that drawer links there. Never on an alert line. The DOM half is components/faceplate/Xref.js.

import { FIXED_VOLUME_REASON, MATRIX_BYPASS_REASON, ZERO_RANGE_REASON } from "../schema/gray.js";
import { DIRECT_SDM_NOTE } from "./drawers/speakers.js";
import { METER_NOTES } from "./drawers/source.js";
import { showTab } from "./drawer/tabs.js";
import { openList, openPopover, openStage } from "./view.js";

/**
 * A place a link goes: the drawer that opens, the tab it shows and the name the link prints.
 *
 * @typedef {object} XrefTarget
 * @property {string} drawer
 * @property {string} [tab]
 * @property {string} label
 */

/**
 * Where a line is drawn: its drawer and the tab it sits on.
 *
 * @typedef {{ drawer: string, tab?: string }} XrefHere
 */

/** Every place a link goes, by link id. @type {Record<string, XrefTarget>} */
export const TARGETS = {
  matrix: { drawer: "matrix", tab: "basic", label: "Matrix engine" },
  pipelines: { drawer: "pipelines", tab: "overview", label: "DSP pipelines" },
  crossfeed: { drawer: "crossfeed", tab: "crossfeed", label: "Crossfeed" },
  loudness: { drawer: "loudness", tab: "loudness", label: "Loudness" },
  correction: { drawer: "correction", tab: "correction", label: "DAC correction" },
  "volume-level": { drawer: "volume", tab: "level", label: "Level" },
  "volume-range": { drawer: "volume", tab: "range", label: "Range" },
  dsdplay: { drawer: "dsd", tab: "sdm", label: "DSD playback" },
  output: { drawer: "output", tab: "format", label: "Output" },
};

/** Reason lines naming their place whole. */
const WHOLE = new Map([
  [MATRIX_BYPASS_REASON, "matrix"],
  [METER_NOTES.matrix, "matrix"],
  [DIRECT_SDM_NOTE, "dsdplay"],
]);

/** Reason lines naming their place by how they begin; the gated-loudness line begins with one of these. */
const OPENING = [
  [FIXED_VOLUME_REASON, "volume-level"],
  [ZERO_RANGE_REASON, "volume-range"],
];

/**
 * Open a place: its drawer in place of any other, on its tab. The open list and popover close.
 *
 * @param {string} id  a TARGETS id
 */
export function goTo(id) {
  const t = TARGETS[id];
  if (!t) return;
  openStage.value = t.drawer;
  openList.value = null;
  openPopover.value = null;
  if (t.tab !== undefined) showTab(t.drawer, t.tab);
}

/**
 * The place a reason line names, or null for none or for the place the line already sits in: the target's drawer
 * and, where the target names a tab, that tab.
 *
 * @param {string} text
 * @param {XrefHere | null} here  where the line is drawn; null off any drawer
 * @returns {string | null}
 */
export function reasonXref(text, here) {
  const to = WHOLE.get(text) ?? OPENING.find(([start]) => text.startsWith(start))?.[1];
  if (!to) return null;
  const t = TARGETS[to];
  const inSight = t.drawer === here?.drawer && (t.tab === undefined || t.tab === here.tab);
  return inSight ? null : to;
}
