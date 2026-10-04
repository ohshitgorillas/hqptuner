// Cross-references: a line that names another place as its cause or fix carries a link there (`Name ›`, the Volume
// drawer's `Loudness ›` grammar). Only where the fix lives out of sight: another drawer, another tab, a nested chain section.
// The link label is the place's own name; the line's copy never changes. Targets are wired in main.js (lib/xref.js).
//   to     target id (main.js xrefGo)
//   label  the place's name as the rail / tab / row prints it

import { MATRIX_BYPASS } from "./matrix.js";
import { VOLUME_REASON } from "./volume.js";
import { COPY } from "./scenarios.js";

/** Reason / note text → where it's fixed. */
export const REASON_XREF = new Map([
  // Crossfeed, Loudness, DAC correction, DSP pipelines: the gate is the Matrix engine drawer's Matrix processing row.
  [MATRIX_BYPASS, { to: "matrix", label: "Matrix engine" }],
  // Source meter, DSD source with the matrix bypassed.
  [COPY.meterDsd, { to: "matrix", label: "Matrix engine" }],
  // Volume drawer, Gain and Range tabs: Fixed volume is on the Level tab; min / max on the Range tab.
  [VOLUME_REASON.fixed, { to: "volume-level", label: "Level" }],
  [VOLUME_REASON.zero, { to: "volume-range", label: "Range" }],
  // Speakers drawer under Direct SDM: DSD playback lives in the Resampling · Shaping drawer, SDM chain, DSD sources.
  [COPY.directSpeakers, { to: "dsdplay", label: "DSD playback" }],
]);
