// The circled apodizing mark, shared by the filter dropdowns and Easy Mode's
// preset tiles. Inert everywhere it appears: it is part of the thing it sits
// beside, not a control, so it never commits, never toggles, and reads out
// through its label alone.
//
// The label arrives from the caller rather than living here, because the two
// call sites do not share a vocabulary. A dropdown row is a filter and says
// "Apodizing"; a preset tile is the thing Easy Mode exists to state in plain
// words and says "Error Correction". One mark, two ways of naming it, and a
// single map here would have had to pick one and be wrong at the other site.
import { html } from "../../lib/dom.js";

/** @typedef {"full" | "half" | "none"} ApodKind */

// The glyphs as baked outlines, not font text: where the glyph was a <text>
// node its position depended on which font the viewer's browser resolved, the
// weight it rendered at and the engine's dominant-baseline mapping — different
// in every environment, so no anchor held everywhere.
// Outlines are Inter 400's own "A" and "onehalf" (fonts/inter-400.woff2,
// extracted with fontTools), each ink bounding box centered on the circle at
// (10,10) in viewBox units, per-glyph ink height 10 (A) and 10.75 (the
// fraction's digits go illegible smaller; any bigger crowds the circle).
const A =
  "M5.61 15.00 9.24 5.00H10.71L14.39 15.00H13.05L10.93 9.07Q10.73 8.52 10.48 7.69Q10.22 6.87 " +
  "9.85 5.60H10.09Q9.73 6.89 9.46 7.72Q9.20 8.56 9.02 9.07L6.96 15.00ZM7.43 12.21V11.09H12.57V12.21Z";
const ONE_HALF =
  "M6.98 4.62V10.48H5.82V5.61H5.75L4.36 6.68V5.53L5.54 4.62ZM5.18 15.38 12.57 4.62H13.79L6.40 " +
  "15.38ZM11.67 15.38V14.60L13.63 12.47Q14.02 12.06 14.23 11.75Q14.44 11.44 14.44 11.11Q14.44 " +
  "10.77 14.17 10.58Q13.90 10.40 13.56 10.40Q13.20 10.40 12.97 10.59Q12.74 10.79 12.74 " +
  "11.14H11.62Q11.62 10.35 12.19 9.90Q12.77 9.45 13.60 9.45Q14.48 9.45 15.02 9.93Q15.56 10.40 " +
  "15.56 11.07Q15.56 11.34 15.44 11.63Q15.33 11.93 15.00 12.36Q14.68 12.79 14.05 13.48L13.29 " +
  "14.33V14.40H15.64V15.38Z";

// The strike, drawn as a filled bar rather than a stroked line: a mark is ONE
// path, so the three forms are three different `d` strings and telling them
// apart never depends on how many elements happen to be inside the svg. Corners
// are the 1.7-wide band around the diagonal from (4.6,15.4) to (15.4,4.6), each
// end offset by half that width along the perpendicular; every corner falls
// inside the circle.
const STRIKE = "M5.20 16.00L16.00 5.20L14.80 4.00L4.00 14.80Z";

// "None" is the bare struck circle rather than a struck letter: nothing is being
// corrected, so there is no quantity to letter, and the empty circle-slash is
// the mark every reader already reads as "none".
/** @type {Record<ApodKind, string>} */
const APOD_PATH = { full: A, half: ONE_HALF, none: STRIKE };

/**
 * The circled apodizing mark. Renders nothing without a kind, so a caller with
 * no facet metadata for its filter shows no mark rather than a guessed one.
 *
 * @param {{ kind: ApodKind | undefined, label: string }} props
 */
export function Apod({ kind, label }) {
  if (!kind) return null;
  return html`<span class="apod-mark" role="img" aria-label=${label}>
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="9.3" />
      <path d=${APOD_PATH[kind]} />
    </svg>
  </span>`;
}
