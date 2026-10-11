// WAV header sniffing: reads the sample rate from a file's fmt chunk.

/**
 * Sniff a WAV header's sample rate (fmt chunk) for the 352.8 kHz recommendation
 * (manual §7). Returns null for non-WAV/undetectable — no warning then.
 *
 * @param {DataView} view
 * @returns {number | null}
 */
export function wavRateFromHeader(view) {
  try {
    if (view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) return null;
    let off = 12;
    while (off + 8 < view.byteLength) {
      if (view.getUint32(off, false) === 0x666d7420) return view.getUint32(off + 12, true);
      off += 8 + view.getUint32(off + 4, true);
    }
  } catch {
    /* a truncated header carries no rate */
  }
  return null;
}
