// Resampling · Shaping: one drawer for both rail stages. The engine keeps one chain per output mode, each persistent
// on the /config form whatever mode is running; the drawer mirrors the official Embedded config page's own sections:
//   SDM chain  PCM sources (1x / Nx oversampling) | DSD sources (Direct SDM, integrator, SDM→SDM) | Output defaults (modulator)
//   PCM chain  DSD sources (gain, noise filter, SDM→PCM) | Output defaults (1x / Nx filter, dither)
// The modulator is its own section: it runs whatever the source (official page). Rates and bit rate
// stay in the Output drawer's rate dial (one home per setting).
// Field labels + sublabels: v1 store/schema/dsp.js. Section names: the official page. Option lists + per-option prose:
// data/conversion-catalog.js (generated from the repo, verbatim). Setting copy: settings.json tooltips (MAN).
// pageDup: in the running chain, a section drops every row the page already holds (cut the redundant
// settings entirely); a section with nothing left loses its tab. So the running chain keeps DSD sources, plus FFT length
// while an FFT filter is picked. The idle chain keeps every section (the page doesn't show it outside Auto).
// solo: a section's head title when it is the only one left (owner copy: `DSD sources only`).
// Lanes: filters, dither and modulator are live (Control API setters, never stage); FFT length and DSD sources restart.
// Mock state: SDM output, 44.1k/16 PCM source playing (Nx idle), PCM chain values from the 6.0.4 config-form capture.

import { CATALOG, MAN } from "./conversion-catalog.js";

export { CATALOG };

/** Mock values by control id. Filters/shapers/decoding by engine name; FFT by length; booleans '0'/'1'. */
export const CONV = {
  mode: "sdm", // output mode: 'pcm' | 'sdm' | 'auto'
  source: { family: "pcm", playing: true }, // 44.1 kHz PCM source playing: 1x filter runs, Nx idle
  values: {
    pcm1x: "poly-sinc-gauss-long",
    pcmnx: "poly-sinc-gauss-hires-lp",
    pcmsh: "NS9",
    sdm1x: "poly-sinc-ext2",
    sdmnx: "poly-sinc-ext2-hires-mp",
    sdmsh: "AMSDM7EC 512+fs",
    fft: "512",
    dacr2r: "0",
    dacess: "0",
    noise: "medium",
    decim: "poly-ext2",
    sgain: "0",
    integ: "FIR2",
    sdmconv: "XFi",
    dsdplay: "0",
  },
};

/**
 * The chain a mode runs, which the drawer opens on: SDM → SDM, PCM → PCM; Auto → the playing source's family, PCM when
 * nothing plays.
 */
export const runningChain = (mode, source) =>
  mode === "auto" ? (source.playing && source.family === "dsd" ? "sdm" : "pcm") : mode;

/** Field metadata shared by drawer rows and page fields. */
export const FIELDS = {
  "1x": { label: "1x filter", sub: "Sources up to 50 kHz", man: MAN.filter_1x },
  nx: { label: "Nx filter", sub: "Sources above 50 kHz", man: MAN.filter_nx },
  pcmsh: { label: "Dither", sub: "Low-level noise treatment", man: MAN.pcm_dither },
  sdmsh: { label: "Sigma-delta modulator", sub: "Builds the 1-bit stream", man: MAN.sdm_modulator },
};

export const CHAIN_LISTS = {
  pcm: { filters: CATALOG.pcmFilters, shapers: CATALOG.dithers },
  sdm: { filters: CATALOG.sdmFilters, shapers: CATALOG.modulators },
};

export const CHAIN_NAMES = { pcm: "PCM", sdm: "SDM (DSD)" }; // the output Mode segment's own labels

export const isFft = (name) => /\bFFT\b/.test(String(name));

// Row: {id, label, sub?, man, live?|restart?, control: {type: 'select'|'seg', options, aria}}. `fft: chain` = the FFT
// length row, rendered only while that chain's 1x or Nx filter is FFT-family (one daemon field; each chain shows it).
const filter = (ch, k) => ({
  id: ch + k,
  label: FIELDS[k].label,
  sub: FIELDS[k].sub,
  man: FIELDS[k].man,
  live: true,
  control: { type: "select", aria: `${CHAIN_NAMES[ch]} ${FIELDS[k].label}`, options: CHAIN_LISTS[ch].filters },
});
const shaper = (ch) => ({
  id: ch + "sh",
  label: FIELDS[ch + "sh"].label,
  sub: FIELDS[ch + "sh"].sub,
  man: FIELDS[ch + "sh"].man,
  live: true,
  control: { type: "select", aria: FIELDS[ch + "sh"].label, options: CHAIN_LISTS[ch].shapers },
});
const fft = (ch) => ({
  id: "fft",
  fft: ch,
  label: "FFT filter length",
  man: MAN.fft_length,
  restart: true,
  control: { type: "select", aria: "FFT filter length", options: CATALOG.fftSizes.map((v) => ({ v, label: v })) },
});
const dsdSel = (id, label, sub, man, options) => ({
  id,
  label,
  sub,
  man,
  restart: true,
  control: { type: "select", aria: label, options },
});

// Three stage drawers, one per rail stage, each with the same head grammar: PCM out | SDM out tabs (the output modes:
// the engine keeps one chain per mode, persistent whatever runs), opening on the running mode; the other reads `idle`.
// Rows the page also holds (the running mode's filters and shaper) show here too: two homes, one state (the page is the
// quick pick, the drawer the full stage). Rows: as before; `fft: mode` = FFT length, shown only with an FFT-family filter.
//   dsd         DSD Processing (rail stage after HF filter): what a DSD source goes through, per output mode.
//   resampling  Resampling: the filters (PCM sources) and, on SDM out, Rate conversion (DSD sources).
//   shaping     Shaping: dither | modulator. DAC bits (the dithering level) is a fact about the DAC, so it stays in the
//               Output drawer; the PCM tab reads it under the dither, read-only, with `Output ›` (notes).

export const MODE_DRAWERS = {
  dsd: {
    id: "dsd",
    title: "DSD Processing",
    aria: "DSD Processing settings",
    stages: ["dsd"],
    modes: {
      pcm: [
        {
          id: "sgain",
          label: "Source gain",
          man: MAN.dsd_gain_6db,
          restart: true,
          control: {
            type: "seg",
            aria: "Source gain",
            options: [
              { v: "0", label: "0", unit: "dB" },
              { v: "1", label: "+6", unit: "dB" },
            ],
          },
        },
        dsdSel("noise", "Noise filter", "Removes ultrasonic noise", MAN.pdm_filter, CATALOG.noiseFilters),
        dsdSel("decim", "Decimation filter", "SDM → PCM conversion", MAN.pdm_conversion, CATALOG.decimation),
      ],
      sdm: [
        {
          id: "dsdplay",
          label: "DSD playback",
          sub: "Direct SDM",
          man: MAN.direct_sdm,
          restart: true,
          control: {
            type: "seg",
            aria: "DSD playback",
            options: [
              { v: "0", label: "Processed" },
              { v: "1", label: "Direct" },
            ],
          },
        },
        dsdSel("integ", "Remodulator structure", "Integrator", MAN.sdm_integrator, CATALOG.integrators),
      ],
    },
  },
  resampling: {
    id: "resampling",
    title: "Resampling",
    aria: "Resampling settings",
    stages: ["resampling"],
    modes: {
      pcm: [filter("pcm", "1x"), filter("pcm", "nx"), fft("pcm")],
      // SDM out: the official config page's two source sections, as headers.
      sdm: [
        { head: "PCM sources" },
        filter("sdm", "1x"),
        filter("sdm", "nx"),
        fft("sdm"),
        { head: "DSD sources" },
        dsdSel("sdmconv", "Rate conversion", "SDM → SDM conversion", MAN.sdm_conversion, CATALOG.sdmConversion),
      ],
    },
  },
  shaping: {
    id: "shaping",
    title: "Shaping",
    aria: "Shaping settings",
    stages: ["shaping"],
    modes: {
      pcm: [
        {
          id: "dacr2r",
          label: "DAC type",
          live: true,
          man: [
            "Also when a suitable noise-shaper, such as LNS15, NS9 or NS5 is used in combination with high output rates, linearity errors inherent to all R2R DACs can be corrected. This will lower distortion of especially low level signals and reduce zero-crossing distortions.", // manual §4 (Bits)
            "R-2R collapses the Additive family in the dither list.",
          ], // DRAFT (agent)
          control: {
            type: "seg",
            aria: "DAC type",
            options: [
              { v: "0", label: "Other" },
              { v: "1", label: "R-2R" },
            ],
          },
        },
        shaper("pcm"),
      ],
      sdm: [
        {
          id: "dacess",
          label: "DAC chip",
          live: true,
          man: [
            "For ESS Sabre based DACs, fifth order modulators are recommended. For most other DACs, seventh order modulators are optimal.", // manual §4.6
            "ESS Sabre collapses the seventh order variants in the modulator list.",
          ], // DRAFT (agent)
          control: {
            type: "seg",
            aria: "DAC chip",
            options: [
              { v: "0", label: "Other" },
              { v: "1", label: "ESS Sabre" },
            ],
          },
        },
        shaper("sdm"),
      ],
    },
    notes: { pcm: [{ id: "dithto", link: { to: "output-format", label: "Output" } }] },
  },
};
/** Output modes as the drawers' tabs name them. */
export const MODE_TABS = { pcm: "PCM out", sdm: "SDM out" };
