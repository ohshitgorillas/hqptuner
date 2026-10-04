// DOM-free derivations for the conversion page (components/conversion.js): which field of which chain runs on a
// playback path, what the page opens on, which rows a section shows, the rail value per stage, and how far the page
// runs past the plate and which copy gives that height back.

/**
 * @typedef {object} Play
 * @property {string} run    the running chain: 'pcm' | 'sdm'
 * @property {string} path   the scenario path (data/scenarios.js pathOf)
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
 * @typedef {object} Rail
 * @property {boolean} dsdInPath       the DSD Processing stage is in this track's path
 * @property {string} dsd              the DSD Processing stage's value
 * @property {boolean} offChain        Resampling and Shaping leave the chain (Direct)
 * @property {boolean} rateConversion  Resampling's slot carries the SDM → SDM conversion
 * @property {string} resampling       the Resampling stage's value
 * @property {string} shaping          the Shaping stage's value
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
  if (ch !== play.run || play.path === 'idle') return false;
  const p = play.path;
  if (p === 'direct') return false;
  // The modulator runs whatever the source (official config page: Output defaults); on DSD → SDM the
  // filters don't.
  if (p === 'sdm-sdm') return k === 'sh';
  return k === 'sh' || k === (p === 'dsd-pcm' ? 'nx' : play.stage);
}

/**
 * What a new mode or scene opens on: the chain's running filter (Nx where it runs, else 1x) and its shaper.
 *
 * @param {Play} play
 * @param {string} chain
 * @returns {Open}
 */
export function openOn(play, chain) {
  return { rs: { chain, field: fieldRuns(play, chain, 'nx') ? 'nx' : '1x' }, sh: chain };
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
  return chains.flatMap((ch) => (ch === open.chain
    ? keys.map((k) => /** @type {Row} */ ({ kind: k === open.field ? 'field' : 'line', ch, k }))
    : [/** @type {Row} */ ({ kind: 'chain', ch, k: keys[0] })]));
}

/**
 * Resampling with room for both filters: the open chain's 1x and Nx both open, every other chain folded.
 *
 * @param {string[]} chains
 * @param {string} chain  the open chain
 * @returns {{ fields: { ch: string, k: string }[], others: string[] }}
 */
export function bothRows(chains, chain) {
  return { fields: ['1x', 'nx'].map((k) => ({ ch: chain, k })), others: chains.filter((ch) => ch !== chain) };
}

/**
 * The rail's values for what plays. DSD Processing names what it runs for the running mode: PCM out = noise filter ·
 * decimation; SDM out = the integrator, or Direct. On DSD → SDM processed nothing resamples, so Resampling's slot
 * carries the SDM → SDM conversion.
 *
 * @param {Play} play
 * @param {boolean} direct  DSD playback as applied (Direct SDM)
 * @param {Record<string, string>} vals
 * @returns {Rail}
 */
export function railValues(play, direct, vals) {
  const { run, path: p } = play;
  const remod = p === 'sdm-sdm';
  return {
    dsdInPath: ['dsd-pcm', 'sdm-sdm'].includes(p),
    dsd: run === 'pcm' ? `${vals.noise} · ${vals.decim}` : direct ? 'Direct' : vals.integ,
    offChain: p === 'direct',
    rateConversion: remod,
    resampling: remod ? vals.sdmconv : vals[run + (fieldRuns(play, run, 'nx') || p === 'dsd-pcm' ? 'nx' : '1x')],
    shaping: vals[run + 'sh'],
  };
}

/**
 * How far the page's lowest child runs past the page's bottom, in layout px. The plate is scaled below 1080×810 (screen
 * px = layout px × scale), so screen rects are divided by the scale before the padding (layout px) is added.
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
