// The DSP pipelines drawer's filter upload, on v1's path (components/matrix/StageEditor.js ConvEditor): the file goes
// to the daemon's filter route, is registered so a convolution stage naming it plots, and a WAV off the recommended
// 352.8 kHz says so.

import { api } from "../../../../lib/api.js";
import { errText } from "../../../../lib/errtext.js";
import { hz } from "../../../../lib/units.js";
import { registerIr } from "../../../../vendor/eqlab/core/dsp/impulse.js";
import { wavRateFromHeader } from "../../../matrix/StageEditor.js";

/** The rate a convolution filter is best made at (manual §7), Hz. */
const BEST_RATE = 352800;

/**
 * Upload a filter file. Answers the path the daemon stored it under ('' when refused) and what happened, in words.
 *
 * @param {File} file
 * @returns {Promise<{ path: string, note: string }>}
 */
export async function uploadFilter(file) {
  try {
    const r = /** @type {{ path: string }} */ (await api.uploadFilter(file));
    const buf = await file.arrayBuffer();
    const sr = wavRateFromHeader(new DataView(buf.slice(0, 64)));
    registerIr(r.path, buf);
    const off = sr && sr !== BEST_RATE;
    return {
      path: r.path,
      note: off ? `uploaded · ${hz(sr, 1)} — 352.8 kHz is recommended for full-band use` : "uploaded",
    };
  } catch (err) {
    return { path: "", note: `upload failed: ${errText(err)}` };
  }
}
