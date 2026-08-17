// The narrow bar's facet list, as the suites that sweep it read it.
//
// Every facet that NARROWS A DROPDOWN, against one in-domain value that is not
// that facet's own default. The default table it is stated against is
// `NARROWING_DEFAULTS` in tests/js/support/narrowingwire.js, which is the shape
// GET/PUT /api/narrowing actually serves.
//
// Two facets are deliberately absent. The genre and focus MODE switches narrow
// nothing with nothing picked and are pinned as not active narrowing
// (tests/js/store/narrowing-mode.test.js). Source format narrows no dropdown at
// all — it discloses the chain cards' "DSD Sources" subsections
// (tests/js/store/srcformat.test.js) — and is the one term
// `filterNarrowingActive` drops, so a sweep of the narrowing facets is a sweep
// of exactly this list.
//
// `nFavOnly` is the favorites store's own signal rather than the narrowing
// module's, and it is client-only and unpersisted, which is why it carries no
// wire key here.

import { nFavOnly } from "../../../hqptuner/static/store/narrow/favorites.js";
import {
  nGenre,
  nQuality,
  nFocus,
  nPhase,
  nLength,
  nHideLimited,
  nOddRateOnly,
  nDownsafeOnly,
  nApod1x,
  nApodNx,
  nLossy1x,
} from "../../../hqptuner/static/store/narrow/state.js";

/**
 * One row: the facet's name as a failure should read it, the signal carrying
 * it, and a value that is not its default.
 *
 * @typedef {[string, { value: never }, never]} MovedFacet
 */

/** @type {MovedFacet[]} */
export const MOVED_FACETS = /** @type {MovedFacet[]} */ ([
  ["genre", nGenre, ["classical"]],
  ["quality", nQuality, 4],
  ["focus", nFocus, ["timbre"]],
  ["phase", nPhase, ["linear"]],
  ["length", nLength, ["long"]],
  ["hide_limited", nHideLimited, "on"],
  ["odd_rate_only", nOddRateOnly, true],
  ["downsafe_only", nDownsafeOnly, true],
  ["apod_1x", nApod1x, "only"],
  ["apod_nx", nApodNx, "only"],
  ["lossy_1x", nLossy1x, "lossless"],
  ["favorites_only", nFavOnly, true],
]);
