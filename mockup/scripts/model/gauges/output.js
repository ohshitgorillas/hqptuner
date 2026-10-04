// DOM-free output arithmetic for the mockup's components: which rate tiers make up a band, where tiers, bands and the
// seam sit on the rate dial and where its needles settle, which rates the output tuner marks, how an engine device string
// splits, how a device list falls under its group headers, and where a value sits along a slider's range.

/**
 * @typedef {object} DialScale
 * @property {number} x0    x of the first tier
 * @property {number} dx    distance between neighbouring tiers
 * @property {number[]} xs  x of each tier, in tier order
 */

/**
 * @typedef {object} TierSpan
 * @property {number} lo  position of the band's first tier
 * @property {number} hi  position of the band's last tier
 */

/**
 * @typedef {object} TunerCell  one exact rate of a tier
 * @property {string} fam       the rate's family key
 * @property {boolean} pinned   the pin sits on this rate
 * @property {boolean} playing  this rate is playing now
 */

/**
 * @typedef {object} TunerColumn  one tier of the running band
 * @property {number} i             the tier's position
 * @property {boolean} unavailable  the device cannot carry the tier
 * @property {TunerCell[]} cells    one per family, in the order given
 */

/**
 * @typedef {object} DeviceParts
 * @property {string} group   network: the host; ALSA: the card
 * @property {string} main    network: the card; ALSA: the interface
 * @property {string} detail  network: the interface; ALSA: empty
 */

/**
 * @typedef {DeviceParts & { i: number, str: string }} DeviceRow  one device with its position in the list
 */

/**
 * @typedef {object} DeviceGroup
 * @property {string} group       the header's name
 * @property {DeviceRow[]} rows   the devices under it, in list order
 */

/**
 * The positions of the tiers in one rate family, in tier order.
 *
 * @param {{ family: string }[]} tiers
 * @param {string} family  'pcm' | 'sdm'
 * @returns {number[]}
 */
export function tierIndex(tiers, family) {
  return tiers.map((t, i) => (t.family === family ? i : -1)).filter((i) => i >= 0);
}

/**
 * The rate dial's horizontal scale: `count` tiers evenly spaced from `x0` to `width - x0`.
 *
 * @param {number} count  number of tiers
 * @param {number} width  the dial's width
 * @param {number} x0     x of the first tier
 * @returns {DialScale}
 */
export function dialScale(count, width, x0) {
  const dx = (width - 2 * x0) / (count - 1);
  return { x0, dx, xs: Array.from({ length: count }, (_, i) => x0 + i * dx) };
}

/**
 * The first and last tier of one rate family.
 *
 * @param {{ family: string }[]} tiers
 * @param {string} family  'pcm' | 'sdm'
 * @returns {TierSpan}
 */
export function bandSpan(tiers, family) {
  const idx = tierIndex(tiers, family);
  return { lo: idx[0], hi: idx[idx.length - 1] };
}

/**
 * The x of the seam between the bands: half way from the last PCM tier to the first SDM tier.
 *
 * @param {DialScale} scale
 * @param {{ family: string }[]} tiers
 * @returns {number}
 */
export function seamX(scale, tiers) {
  return (scale.xs[bandSpan(tiers, "pcm").hi] + scale.xs[bandSpan(tiers, "sdm").lo]) / 2;
}

/**
 * Where a band's legend and rule start and end: `inset` inside the outer edges of its first and last tier's cells.
 *
 * @param {DialScale} scale
 * @param {TierSpan} span
 * @param {number} inset
 * @returns {{ x1: number, x2: number }}
 */
export function bandEdges(scale, span, inset) {
  return { x1: scale.xs[span.lo] - scale.dx / 2 + inset, x2: scale.xs[span.hi] + scale.dx / 2 - inset };
}

/**
 * The x of each quarter-step minor tick of a band: past the rule's start, short of its end, and off every tier.
 *
 * @param {DialScale} scale
 * @param {TierSpan} span
 * @param {{ x1: number, x2: number }} edges  the band's rule ends
 * @returns {number[]}
 */
export function minorTicks(scale, span, edges) {
  const out = [];
  for (let x = scale.xs[span.lo] - scale.dx / 2 + scale.dx / 4; x < edges.x2; x += scale.dx / 4) {
    if (x > edges.x1 && !scale.xs.some((t) => Math.abs(t - x) < 1)) out.push(x);
  }
  return out;
}

/**
 * The tier nearest the dial position `x`. Not clamped to any band.
 *
 * @param {DialScale} scale
 * @param {number} x
 * @returns {number}
 */
export function nearestTier(scale, x) {
  return Math.round((x - scale.x0) / scale.dx);
}

/**
 * Where a needle at `cur` settles when sent to `target`: clamped into its band, and whether that differs from `cur`.
 *
 * @param {TierSpan} span
 * @param {number} cur
 * @param {number} target
 * @returns {{ i: number, moved: boolean }}
 */
export function moveNeedle(span, cur, target) {
  const i = Math.max(span.lo, Math.min(span.hi, target));
  return { i, moved: i !== cur };
}

/**
 * The output tuner's columns: one per tier of the running band, each rate marked pinned where the pin sits and playing
 * where the running tier plays in the pin's family (unpinned: the source's). An unavailable tier is never marked.
 *
 * @param {{ family: string, unavailable?: boolean }[]} tiers
 * @param {{ run: string, tier: number | null, src: number | null, fam: string }} now  what runs
 * @param {{ tier: number, fam: string } | null} pin
 * @param {string[]} fams  family keys, in display order
 * @returns {TunerColumn[]}
 */
export function tunerColumns(tiers, now, pin, fams) {
  const playing = now.src != null && now.tier != null;
  const playFam = pin ? pin.fam : now.fam;
  return tierIndex(tiers, now.run).map((i) => {
    const unavailable = Boolean(tiers[i].unavailable);
    const cells = fams.map((fam) => ({
      fam,
      pinned: !unavailable && pin?.tier === i && pin.fam === fam,
      playing: !unavailable && playing && now.tier === i && playFam === fam,
    }));
    return { i, unavailable, cells };
  });
}

/**
 * Split an engine device string on ": ": network `host: card: interface`, ALSA `card: interface`.
 *
 * @param {string} kind  'network' | 'alsa'
 * @param {string} str
 * @returns {DeviceParts}
 */
export function deviceParts(kind, str) {
  const a = str.split(": ");
  return kind === "network"
    ? { group: a[0], main: a[1] || a[0], detail: a.slice(2).join(": ") }
    : { group: a[0], main: a.slice(1).join(": ") || a[0], detail: "" };
}

/**
 * A device list under its group headers: a new header wherever the group differs from the row before it.
 *
 * @param {string} kind  'network' | 'alsa'
 * @param {string[]} list
 * @returns {DeviceGroup[]}
 */
export function groupDevices(kind, list) {
  /** @type {DeviceGroup[]} */
  const groups = [];
  list.forEach((str, i) => {
    const p = deviceParts(kind, str);
    const last = groups[groups.length - 1];
    if (last && last.group === p.group) last.rows.push({ ...p, i, str });
    else groups.push({ group: p.group, rows: [{ ...p, i, str }] });
  });
  return groups;
}

/**
 * Where `v` sits along `min` … `max`, as a percentage of the range. Not clamped.
 *
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function percentOf(v, min, max) {
  return ((v - min) / (max - min)) * 100;
}
