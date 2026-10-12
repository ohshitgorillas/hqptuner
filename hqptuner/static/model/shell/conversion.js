// DOM-free derivations for the conversion page: which field of which chain runs on a playback path, what the page
// opens on, which rows a section shows, the rail's rate stage, and how far the page runs past the plate and which copy
// gives that height back.

/**
 * @typedef {object} Play
 * @property {string} run    the running chain: 'pcm' | 'sdm'
 * @property {string} path   the scenario path
 * @property {string} stage  the filter stage the source rate selects: '1x' | 'nx'
 */

/**
 * @typedef {object} Open
 * @property {{ chain: string, field: string }} rs  Resampling: the open chain and its open filter
 * @property {string} sh                             Shaping: the open chain
 */

/**
 * @typedef {object} Row
 * @property {'field' | 'line' | 'chain'} kind  the open field, a folded field, or a folded chain
 * @property {string} ch                        its chain
 * @property {string} k                         its field: '1x' | 'nx' | 'sh'
 */

/**
 * @typedef {object} RateFilters  the running filters by engine name and the running SDM to SDM conversion by label
 * @property {string} filter1x
 * @property {string} filterNx
 * @property {string} sdmconv
 */

/**
 * @typedef {object} RateStage
 * @property {boolean} rateOn      the rate stage is lit
 * @property {boolean} resamples   a resampling filter lights it
 * @property {string} resampling   what it runs: the SDM to SDM conversion on a remodulated DSD source, else the
 *   running filter
 */

/** A page whose overrun stays at or under this many layout px fits. */
const FIT_SLACK = 0.5;

/** How many copies give height back before the page stops trying. */
export const FIT_PASSES = 4;

/**
 * Field k of chain ch runs for this track.
 *
 * @param {Play} play
 * @param {string} ch
 * @param {string} k
 * @returns {boolean}
 */
export function fieldRuns(play, ch, k) {
  if (ch !== play.run || play.path === "idle") return false;
  const p = play.path;
  if (p === "direct") return false;
  // The modulator runs whatever the source (official config page: Output defaults); on DSD → SDM the
  // filters don't.
  if (p === "sdm-sdm") return k === "sh";
  return k === "sh" || k === (p === "dsd-pcm" ? "nx" : play.stage);
}

/**
 * What a new mode or scene opens on: the chain's running filter (Nx where it runs, else 1x) and its shaper.
 *
 * @param {Play} play
 * @param {string} chain
 * @returns {Open}
 */
export function openOn(play, chain) {
  return { rs: { chain, field: fieldRuns(play, chain, "nx") ? "nx" : "1x" }, sh: chain };
}

/**
 * A section's rows with one field open: the open chain's fields (the open one open, the rest folded), every other
 * chain one folded row on its first field.
 *
 * @param {string[]} chains
 * @param {{ chain: string, field: string }} open
 * @param {string[]} keys  the section's fields, in order
 * @returns {Row[]}
 */
export function sectionRows(chains, open, keys) {
  return chains.flatMap((ch) =>
    ch === open.chain
      ? keys.map((k) => /** @type {Row} */ ({ kind: k === open.field ? "field" : "line", ch, k }))
      : [/** @type {Row} */ ({ kind: "chain", ch, k: keys[0] })],
  );
}

/**
 * Resampling with room for both filters: the open chain's 1x and Nx both open, every other chain folded.
 *
 * @param {string[]} chains
 * @param {string} chain  the open chain
 * @returns {{ fields: { ch: string, k: string }[], others: string[] }}
 */
export function bothRows(chains, chain) {
  return { fields: ["1x", "nx"].map((k) => ({ ch: chain, k })), others: chains.filter((ch) => ch !== chain) };
}

/** The paths a PCM resampling filter converts the rate on. */
const RESAMPLING_PATHS = ["pcm-pcm", "pcm-sdm", "dsd-pcm"];

/**
 * Whether the output rate differs from the source rate, both of them known.
 *
 * @param {string | undefined} from  the source rate as the engine reports it
 * @param {string | undefined} to    the output rate as the engine reports it
 * @returns {boolean}
 */
function rateDiffers(from, to) {
  const a = Number(from);
  const b = Number(to);
  return !!a && !!b && a !== b;
}

/**
 * The rate stage for what plays: what it runs, whether it is lit and whether a resampling filter lights it. It is lit
 * while the rate changes through the SDM to SDM conversion, or through a running resampling filter other than none; an
 * unknown filter counts as none.
 *
 * @param {Play} play
 * @param {{ from: string | undefined, to: string | undefined }} rates  the source and output rates as reported
 * @param {RateFilters} conv
 * @returns {RateStage}
 */
export function rateStage(play, rates, conv) {
  const remod = play.path === "sdm-sdm";
  const filter = fieldRuns(play, play.run, "nx") ? conv.filterNx : conv.filter1x;
  const filtered = RESAMPLING_PATHS.includes(play.path) && filter !== "" && filter !== "none";
  const rateOn = rateDiffers(rates.from, rates.to) && (remod || filtered);
  return { rateOn, resamples: rateOn && filtered, resampling: remod ? conv.sdmconv : filter };
}

/**
 * How far the page's lowest child runs past the page's bottom, in layout px. The plate is scaled in a window smaller
 * than its format (screen px = layout px × scale), so screen rects are divided by the scale before the padding (layout
 * px) is added.
 *
 * @param {{ bottoms: number[], pageBottom: number, scale: number, padding: number }} m  measured in screen px
 * @returns {number}
 */
export function overrunOf(m) {
  return (Math.max(...m.bottoms) - m.pageBottom) / m.scale + m.padding;
}

/**
 * The page runs past the plate.
 *
 * @param {number} overrun  layout px
 * @returns {boolean}
 */
export function overruns(overrun) {
  return overrun > FIT_SLACK;
}

/**
 * Which copy gives the overrun back, and the height it is cut to. A copy can only give back what it stands above its
 * own left column (the section is as tall as the taller one); the sparest copy gives, first on a tie.
 *
 * @param {{ height: number, left: number }[]} copies  each copy's height and its left column's
 * @param {number} overrun
 * @returns {{ index: number, height: number } | null}  null when no copy stands above its left column
 */
export function fitStep(copies, overrun) {
  let index = -1;
  copies.forEach((c, i) => {
    if (index < 0 || c.height - c.left > copies[index].height - copies[index].left) index = i;
  });
  if (index < 0) return null;
  const c = copies[index];
  if (c.height - c.left <= 0) return null;
  return { index, height: Math.max(c.left, c.height - overrun) };
}
