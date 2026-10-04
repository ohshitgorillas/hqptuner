// The schemas of the Matrix engine and DAC correction drawers, members of the `matrix` family: both edit the matrix
// profile, so a staged edit in either lights both drawers' apply groups. Matrix engine is Basic (an intro naming the
// drawers the engine runs, printed plain, then the gate and Expand HF) and Advanced (the convolution engine and IIR to
// FIR, each option's line under its row); DAC correction is its gate and the DAC model.

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

/** The family's gates, each reading bypass first. */
const BYPASS_ENGAGE = [
  { value: "0", label: "Bypass" },
  { value: "1", label: "Engage" },
];

/** @type {DrawerSchema} */
export const MATRIX_DRAWER = {
  id: "matrix",
  family: "matrix",
  title: "Matrix engine",
  aria: "Matrix engine settings",
  tabs: [
    {
      id: "basic",
      label: "Basic",
      body: [
        {
          intro: [
            "The matrix engine runs your matrix profile: ",
            { label: "DSP pipelines" },
            ", ",
            { label: "Crossfeed" },
            ", ",
            { label: "Loudness" },
            " and ",
            { label: "DAC correction" },
            ". Bypassing it stops them all; their settings are kept for when you engage it again.",
          ],
        },
        { row: { key: "matrix_enabled", options: BYPASS_ENGAGE } },
        { row: { key: "matrix_expand_hf" } },
      ],
    },
    {
      id: "advanced",
      label: "Advanced",
      body: [{ row: { key: "matrix_engine", optMan: true } }, { row: { key: "matrix_iir2fir", optMan: true } }],
    },
  ],
};

/** @type {DrawerSchema} */
export const CORRECTION_DRAWER = {
  id: "correction",
  family: "matrix",
  title: "DAC correction",
  aria: "DAC correction settings",
  tabs: [
    {
      id: "correction",
      label: "DAC correction",
      body: [
        { row: { key: "dac_correction_enabled", options: BYPASS_ENGAGE } },
        { row: { key: "dac_correction_profile", label: "DAC model" } },
      ],
    },
  ],
};
