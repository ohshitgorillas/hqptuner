export const INTEGRATOR_CATALOG = [
  {
    v: "IIR",
    label: "Conventional · Base",
    group: "Conventional",
    man: "Normal IIR-type integrator structure. 50 kHz audio bandwidth re: DSD64.",
  },
  {
    v: "IIR2",
    label: "Conventional · Low noise",
    group: "Conventional",
    man: "IIR-type integrator structure designed to minimize residual noise. 25 kHz audio bandwidth re: DSD64.",
  },
  {
    v: "IIR3",
    label: "Conventional · Medium bandwidth",
    group: "Conventional",
    man: "High-order IIR-type integrator structure. 30 kHz audio bandwidth re: DSD64.",
  },
  {
    v: "FIR",
    label: "Weighted averaging · Base",
    group: "Weighted averaging",
    man: "Weighted FIR-type integrator structure.",
  },
  {
    v: "FIR2",
    label: "Weighted averaging · Wide",
    group: "Weighted averaging",
    man: "Weighted FIR-type integrator structure. 50 kHz audio bandwidth re: DSD64.",
  },
  {
    v: "FIR-bl",
    label: "Weighted averaging · Narrow",
    group: "Weighted averaging",
    man: "FIR-type integrator structure with band-limiting. 24 kHz audio bandwidth re: DSD64 with complete cut by 45 kHz.",
  },
  {
    v: "FIR-bw",
    label: "Weighted averaging · Brickwall",
    group: "Weighted averaging",
    man: "FIR-type integrator structure with brickwall band-limiting. 21.5 kHz audio bandwidth re: DSD64 with complete cut by 30 kHz.",
  },
  {
    v: "CIC",
    label: "Simple averaging · Base",
    group: "Simple averaging",
    man: "Cascade comb-type integrator structure.",
  },
];
