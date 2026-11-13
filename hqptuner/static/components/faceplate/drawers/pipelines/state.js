// The DSP pipelines drawer's view state, which nothing stages: per output tab the input shown, the pipeline, chip and
// band picked, the list page and the plot scope; the strips open in Raw; the crossfeed blocks unfolded in the lists;
// and the Overview's uploads and Import EQ answers. The decisions it is read through are model/shell/pipelines.js's.

import { signal } from "@preact/signals";
import { crosspoint, listItems, pageOf } from "../../../../model/shell/pipelines.js";

/** @typedef {import("../../../../model/shell/pipelines.js").Pipe} Pipe */

/**
 * One output tab's picks.
 *
 * @typedef {object} Sel
 * @property {number | null} src  the input shown
 * @property {number} selPipe  the picked pipeline's place in the set (-1 = none)
 * @property {number} page
 * @property {number} chip
 * @property {number} band
 * @property {string} scope  the plot scope asked for
 */

/** @typedef {{ text: string, error: string }} Raw  a strip in Raw: its process string and why it did not parse */

/** @type {Sel} */
const BLANK = { src: null, selPipe: -1, page: 0, chip: 0, band: 0, scope: "auto" };

const sels = signal(/** @type {Record<number, Sel>} */ ({}));

/** The strips open in Raw, by the pipeline's place in the set. */
export const raws = signal(/** @type {Record<number, Raw>} */ ({}));

/** The crossfeed blocks unfolded in the output lists, by kind. */
export const openBlocks = signal(/** @type {Set<string>} */ (new Set()));

/** The filters uploaded from the Overview this session, by the path the daemon stored them under. */
export const uploaded = signal(/** @type {string[]} */ ([]));

/** What the last upload or Import EQ answered, in words. */
export const note = signal("");

/** Whether Import EQ lands on both sides of the stereo pair. */
export const mirror = signal(true);

/**
 * Output `o`'s picks.
 *
 * @param {number} o
 * @returns {Sel}
 */
export const selOf = (o) => sels.value[o] ?? BLANK;

/**
 * Set output `o`'s picks.
 *
 * @param {number} o
 * @param {Sel} sel
 */
export function putSel(o, sel) {
  sels.value = { ...sels.value, [o]: sel };
}

/**
 * Show input `src` on output `o`'s tab with `pipe` picked (its first pipeline when null), on its page.
 *
 * @param {Pipe[]} pipes
 * @param {number} o
 * @param {number} src
 * @param {number | null} pipe
 */
export function focus(pipes, o, src, pipe) {
  const here = crosspoint(pipes, src, o);
  const selPipe = pipe ?? here[0]?.[1] ?? -1;
  const page = pageOf(listItems(here, openBlocks.value), selPipe);
  putSel(o, { ...selOf(o), src, selPipe, page, chip: 0, band: 0 });
}

/**
 * Open or close pipeline `i`'s strip in Raw.
 *
 * @param {number} i
 * @param {Raw | null} raw  null closes it
 */
export function putRaw(i, raw) {
  const next = { ...raws.value };
  if (raw) next[i] = raw;
  else delete next[i];
  raws.value = next;
}

/** Close every strip in Raw: the set's places have moved. */
export const clearRaws = () => {
  raws.value = {};
};

/**
 * Fold or unfold a crossfeed block in the lists.
 *
 * @param {string} kind
 */
export function toggleBlock(kind) {
  const next = new Set(openBlocks.value);
  if (next.has(kind)) next.delete(kind);
  else next.add(kind);
  openBlocks.value = next;
}
