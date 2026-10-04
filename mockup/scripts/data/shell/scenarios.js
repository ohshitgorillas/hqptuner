// Mock scenarios: what is playing. A viewing tool for the mockup, not part of the app (the switch sits
// above the plate, outside it). A scenario sets the source only; the output mode, DSD playback (Direct SDM) and the matrix
// gate stay the user's settings, so the signal path falls out of config exactly as the engine's does:
//   idle      nothing plays
//   pcm-pcm   PCM source, PCM output: 1x or Nx filter (by source rate) + dither
//   pcm-sdm   PCM source, SDM output: 1x or Nx filter + modulator
//   dsd-pcm   DSD source, PCM output: noise filter + SDM → PCM conversion, then the Nx filter + dither
//   sdm-sdm   DSD source, SDM output, Processed: remodulator (integrator) + SDM → SDM conversion; no filter, no modulator
//   direct    DSD source, SDM output, Direct: nothing runs (bit-perfect); volume fixed at −3 dBFS, speaker distances still apply
// Sources: v1 SignalPath.js (manual §4.4–4.6), v1 gray.js / speakers Card.js (Direct SDM), protocol.md §7 (DSD metering
// streams only while the matrix is engaged; a DSD source is decimated to its base rate).
// Where the engine's behaviour isn't documented (matrix on with a processed DSD → SDM path; 1x vs Nx after decimation),
// the mock draws one plausible state: the matrix family runs as configured, decimated DSD plays through the Nx filter.

// tier: where the source sits on the rate scale (RATE_TIERS index: 44.1k = 1x, 192k = 4x of 48k, DSD64 = 64x).
export const SCENES = [
  { id: "idle", label: "Not playing", playing: false },
  {
    id: "pcm1x",
    label: "PCM 44.1 kHz",
    playing: true,
    family: "pcm",
    fam: "f44",
    stage: "1x",
    tier: 0,
    source: "44.1 kHz / 16bit / 2ch",
    nyquist: 22050,
    brick: 19600,
  },
  {
    id: "pcmnx",
    label: "PCM 192 kHz",
    playing: true,
    family: "pcm",
    fam: "f48",
    stage: "nx",
    tier: 2,
    source: "192 kHz / 24bit / 2ch",
    nyquist: 96000,
    brick: 46000,
  },
  {
    id: "dsd64",
    label: "DSD64",
    playing: true,
    family: "dsd",
    fam: "f44",
    stage: "nx",
    tier: 6,
    source: "2.822 MHz / 1bit / 2ch",
    nyquist: 22050,
    brick: 21000,
  }, // metered at its base rate (decimated by 64)
];
export const SCENE0 = "pcm1x";

// Engine-row zones (buffers and the speed figure read the gauge's red | amber | green). Speed seams are the
// gauge's own arcs (main.js gaugeSet: 1× at the warn | ok seam, 0.87× at bad | warn). Buffer seams: HQPlayer documents no thresholds.
export const ZONES = { speed: [0.87, 1], buffer: [25, 50] };

// Engine-row mock readouts per path (process speed ×, input / output buffer %).
export const ENGINE = {
  idle: null,
  "pcm-pcm": { speed: 3.4, in: 88, out: 81 },
  "pcm-sdm": { speed: 1.62, in: 82, out: 74 },
  "dsd-pcm": { speed: 2.15, in: 85, out: 79 },
  "sdm-sdm": { speed: 1.44, in: 80, out: 71 },
  direct: { speed: 9.8, in: 96, out: 93 },
};

// What the output carries per family (the rate dial's limit tier: PCM 8x, SDM 512x), and Direct (the DSD64 source as is).
export const OUT = {
  pcm: { tier: 3, rate: { f44: "352.8 kHz", f48: "384 kHz" }, bits: "24bit" },
  sdm: { tier: 9, rate: { f44: "22.579 MHz", f48: "24.576 MHz" }, name: "DSD512", bits: "1bit" },
  direct: { tier: 6, rate: { f44: "2.822 MHz" }, name: "DSD64", bits: "1bit" },
};

/** The path a source takes through the engine, from the running chain and DSD playback (Direct SDM, as applied). */
export function pathOf(scene, run, direct) {
  if (!scene.playing) return "idle";
  if (scene.family === "pcm") return run === "sdm" ? "pcm-sdm" : "pcm-pcm";
  if (run === "pcm") return "dsd-pcm";
  return direct ? "direct" : "sdm-sdm";
}

// v1 copy (owner): gray reasons and meter states.
export const COPY = {
  directVolume: "Direct SDM bypasses the volume control and sets PCM volume to a fixed -3 dBFS value.", // v1 gray.js
  directSpeakers: "Direct SDM bypasses the volume control, so the level trims have no effect. Distances still apply.", // v1 speakers Card.js
  meterIdle: "Start playback to see the meter.", // v1 meter View.js
  meterDsd: "Engage the matrix engine to see DSD metering.", // v1 meter View.js
};
