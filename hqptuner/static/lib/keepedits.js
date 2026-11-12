/**
 * Which value each setting shows once a reading lands: the user's, for a setting
 * they moved while the read was out, and the reported one for every other.
 *
 * @param {Record<string, string>} before the settings as they stood when the read went out
 * @param {Record<string, string>} now the settings as they stand when it lands
 * @param {Record<string, string>} reported what the read reported
 * @returns {Record<string, string>}
 */
export function keepEdits(before, now, reported) {
  const shown = { ...reported };
  for (const k of Object.keys(reported)) {
    if (now[k] !== before[k]) shown[k] = now[k];
  }
  return shown;
}
