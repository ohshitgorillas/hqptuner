// Which option-list groups are folded. A user's fold is v1's collapsed-group preference, keyed `<kind>|<family>` or
// `<kind>|<family>|<variant>`, so a group folded in either shell is folded in both. The DAC preferences fold the groups
// the manual calls the wrong fit: R-2R the Additive dither family (noise shaping corrects "linearity errors inherent to
// all R2R DACs", manual §4), ESS Sabre each modulator family's Seventh order variant ("For ESS Sabre based DACs, fifth
// order modulators are recommended", §4.6). A tap still opens such a group, and the taps are dropped whenever either
// preference changes.

import { effect, signal } from "@preact/signals";
import { collapsedGroups, toggleCollapsedGroup } from "../../ui/prefs.js";
import { dacChip, dacType } from "../../ui/faceplate.js";

/** @typedef {import("./open.js").ListKind} ListKind */

const MODULATOR_FAMILIES = ["Fixed", "Adaptive", "Hybrid"];

/** The DAC-folded groups the user tapped open since the preferences last changed. @type {{ value: string[] }} */
const opened = signal(/** @type {string[]} */ ([]));

effect(() => {
  void dacType.value;
  void dacChip.value;
  opened.value = [];
});

/**
 * A group's fold key: the family's own for a group without a variant.
 *
 * @param {ListKind} kind
 * @param {string} fam
 * @param {string} variant  '' for none
 */
const foldKey = (kind, fam, variant) => (variant ? `${kind}|${fam}|${variant}` : `${kind}|${fam}`);

/**
 * Whether the DAC preferences fold a group.
 *
 * @param {string} key
 * @returns {boolean}
 */
function dacFolded(key) {
  if (dacType.value === "r2r" && key === "dithers|Additive") return true;
  return dacChip.value === "ess" && MODULATOR_FAMILIES.some((f) => key === `modulators|${f}|Seventh order`);
}

/**
 * Whether a group of a list kind is folded.
 *
 * @param {ListKind} kind
 * @param {string} fam
 * @param {string} variant  '' for a family's rows without a variant
 * @returns {boolean}
 */
export function isFolded(kind, fam, variant) {
  const key = foldKey(kind, fam, variant);
  if (dacFolded(key)) return !opened.value.includes(key);
  return !!collapsedGroups.value[key];
}

/**
 * A group head's tap: a DAC-folded group opens or folds again for as long as the preferences stand; any other is v1's
 * persisted fold.
 *
 * @param {ListKind} kind
 * @param {string} fam
 * @param {string} variant
 */
export function toggleFold(kind, fam, variant) {
  const key = foldKey(kind, fam, variant);
  if (!dacFolded(key)) {
    toggleCollapsedGroup(key);
    return;
  }
  const now = opened.value;
  opened.value = now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
}
