// The apodizing mark: v1 controls/apod.js, the circled A (full) or ½ (half), glyphs as outlines (Inter 400 "A" and
// "onehalf"). One mark wherever apodizing shows: list rows, the facet bar, the Apodizing facet's segments.

import { h, s } from "./dom.js";

const APOD_PATH = {
  full: "M5.61 15.00 9.24 5.00H10.71L14.39 15.00H13.05L10.93 9.07Q10.73 8.52 10.48 7.69Q10.22 6.87 9.85 5.60H10.09Q9.73 6.89 9.46 7.72Q9.20 8.56 9.02 9.07L6.96 15.00ZM7.43 12.21V11.09H12.57V12.21Z",
  half: "M6.98 4.62V10.48H5.82V5.61H5.75L4.36 6.68V5.53L5.54 4.62ZM5.18 15.38 12.57 4.62H13.79L6.40 15.38ZM11.67 15.38V14.60L13.63 12.47Q14.02 12.06 14.23 11.75Q14.44 11.44 14.44 11.11Q14.44 10.77 14.17 10.58Q13.90 10.40 13.56 10.40Q13.20 10.40 12.97 10.59Q12.74 10.79 12.74 11.14H11.62Q11.62 10.35 12.19 9.90Q12.77 9.45 13.60 9.45Q14.48 9.45 15.02 9.93Q15.56 10.40 15.56 11.07Q15.56 11.34 15.44 11.63Q15.33 11.93 15.00 12.36Q14.68 12.79 14.05 13.48L13.29 14.33V14.40H15.64V15.38Z",
};
const APOD_LABEL = { full: "Apodizing", half: "Half apodizing" }; // v1 comborow.js
export const apodMark = (kind) =>
  kind &&
  h(
    "span.amark",
    { role: "img", aria: { label: APOD_LABEL[kind] } },
    s(
      "svg",
      { viewBox: "0 0 20 20", "aria-hidden": "true" },
      s("circle", { cx: 10, cy: 10, r: 9.3 }),
      s("path", { d: APOD_PATH[kind] }),
    ),
  );
