export const DITHER_CATALOG = [
  {
    v: "none",
    label: "Rounding only",
    group: "None",
    man: "No noise-shaping or dithering, only rounding. Mostly suitable for testing cases together with none filter selection, where bit-perfect output is needed. Not recommended.",
  },
  {
    v: "NS1",
    label: "Noise shaping · 1st order, ≥4x",
    group: "Noise shaping",
    man: 'Simple first order noise-shaping. Sample values are rounded and the quantization error is shaped in such a way that the error energy is pushed to the higher frequencies. Suitable mostly for 176.4/192 kHz upsampling. Use of "NS1" with equipment sensitive to ultrasonic noise is not recommended.',
  },
  {
    v: "NS4",
    label: "Noise shaping · 4th order, ≥2x",
    group: "Noise shaping",
    man: 'Fourth order noise-shaping. Similar in shape to the "shaped" dither. Suitable for all rates ≥ 88.2 kHz.',
  },
  {
    v: "NS5",
    label: "Noise shaping · 5th order, ≥8x",
    group: "Noise shaping",
    man: "Fifth order noise-shaping. Fairly aggressive noise-shaping designed for 8x and 16x rates (352.8/384/705.6/768 kHz). Not recommended for rates below 192 kHz. Especially good for PCM1704 at those highest rates.",
  },
  {
    v: "NS9",
    label: "Noise shaping · 9th order, ≥4x",
    group: "Noise shaping",
    man: "Ninth order noise-shaping. Very aggressive noise-shaping designed especially for 4x rates (176.4/192 kHz) and recommended for these rates. Especially good for older 16-bit, 4x-rate-capable multibit DACs like TDA154x etc.",
  },
  {
    v: "LNS15",
    label: "Noise shaping · 15th order linear, ≥16x",
    group: "Noise shaping",
    man: "15th order linear noise-shaping. Smooth noise-shaping slope designed especially for 16x rates (705.6/768 kHz) and recommended for these higher PCM rates. Can be also used at 8x rates (352.8/384 kHz), but not recommended for rates below.",
  },
  {
    v: "RPDF",
    label: "Additive · Rectangular, ≥24-bit output",
    group: "Additive",
    man: "Rectangular Probability Density Function. White noise dither. Computationally lightweight, but only suitable for 24-bit or higher output hardware.",
  },
  {
    v: "TPDF",
    label: "Additive · Triangular, any rate",
    group: "Additive",
    man: "Triangular Probability Density Function. This is the industry standard simple dither mechanism. Suitable for any rate and recommended if the playback rate is 44.1/48 kHz. Recommended for general purpose use.",
  },
  {
    v: "Gauss1",
    label: "Additive · Gauss, ≤2x",
    group: "Additive",
    man: "Gaussian Probability Density Function. High quality flat frequency dither recommended for rates ≤ 96 kHz where noise-shaping is not suitable.",
  },
  {
    v: "shaped",
    label: "Additive · Frequency shaped, ≥2x",
    group: "Additive",
    man: "Shaped dither. Noise used in this dither has a shaped frequency distribution to lower the audibility of the dither noise. Suitable for playback rates ≥ 88.2/96 kHz.",
  },
];
