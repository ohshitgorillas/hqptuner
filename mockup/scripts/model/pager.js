// Paging decisions, free of the DOM: how many pages a list fills, which page is shown, which items it holds, and whether
// ‹ and › are live. ‹ and › wrap, so either goes somewhere whenever there is more than one page. lib/pager.js draws
// what it gets back; a test drives it from a table.

/**
 * A list's paging at one asked-for page.
 *
 * @typedef {object} Paging
 * @property {number} pages  pages the list fills, never fewer than one
 * @property {number} page   the page shown: the one asked for, clamped into range
 * @property {number} start  the first item the page shows
 * @property {number} end    one past the last item it shows
 * @property {boolean} prev  ‹ is live
 * @property {boolean} next  › is live
 */

/**
 * Paging for n items at per a page, showing page (clamped into range).
 *
 * @param {number} n
 * @param {number} per
 * @param {number} page
 * @returns {Paging}
 */
export function paging(n, per, page) {
  const pages = Math.max(1, Math.ceil(n / per));
  const shown = Math.max(0, Math.min(page, pages - 1));
  const more = pages > 1;
  return { pages, page: shown, start: shown * per, end: Math.min(n, (shown + 1) * per), prev: more, next: more };
}

/**
 * The page a step of `by` lands on from `page`, wrapping past either end.
 *
 * @param {number} page
 * @param {number} by
 * @param {number} pages
 * @returns {number}
 */
export const stepPage = (page, by, pages) => (((page + by) % pages) + pages) % pages;
