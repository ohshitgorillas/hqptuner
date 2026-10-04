// DOM-free output arithmetic for the mockup's components: which rate tiers make up a band, how an engine device string
// splits, how a device list falls under its group headers, and where a value sits along a slider's range.

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
 * Split an engine device string on ": ": network `host: card: interface`, ALSA `card: interface`.
 *
 * @param {string} kind  'network' | 'alsa'
 * @param {string} str
 * @returns {DeviceParts}
 */
export function deviceParts(kind, str) {
  const a = str.split(': ');
  return kind === 'network'
    ? { group: a[0], main: a[1] || a[0], detail: a.slice(2).join(': ') }
    : { group: a[0], main: a.slice(1).join(': ') || a[0], detail: '' };
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
