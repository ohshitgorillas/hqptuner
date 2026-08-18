// The LIVE page's card disclosure, as a collapse handle.
//
// The four cards that are neither Mode, Rate nor a chain fold away, and their
// disclosure is a stored preference rather than an override over an automatic
// one: nothing about the engine says whether the narrowing bar or the health
// readout should be on screen, only the user does. A folded card leaves its head
// behind, so the page keeps its shape while losing its height.
//
// Filed on its own because the page's cards no longer live in one module: the
// matrix picker is its own file and reaching into the page module for the
// handle would point an import back up at its own caller.
import { setLiveCardOpen } from "../../store/prefs.js";

/**
 * One LIVE card's collapse handle, backed by its stored disclosure pref.
 *
 * @param {"narrow" | "playback" | "health" | "matrix"} card
 * @param {{ value: boolean }} open
 * @returns {import("../common.js").CollapseHandle}
 */
export const cardCollapse = (card, open) => ({
  open: open.value,
  onToggle: () => setLiveCardOpen(card, !open.value),
});
