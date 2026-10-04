// Signal chain shown on the rail. Order = signal order. level: 0 top stage, 1 child (Matrix engine parts). No category rows: every stage is a real stage.
// on: engaged (lamp lit, section on the page). drawer: id of the stage drawer it opens (every stage but DSP pipelines is
// drawn so far; the Matrix engine family = Matrix engine, Crossfeed, Loudness, DAC correction). DSD Processing, Resampling and Shaping each open their own
// output-mode drawer (components/mode-drawer.js); conversion.js rewrites their values.
// Volume value is live: components/volume.js rewrites it. Loudness value = shelving applied at the live volume
// (`x% applied`), main.js rewrites it. HF filter lamp + value are live too: main.js rewrites them from the drawer.
// Hideable from the rail (Visual settings): DSD Processing, Crossfeed, Loudness, DAC correction, Speakers.
// Mock state: Speakers station, volume active at −12.5 dB, matrix on, crossfeed off (Speakers station), loudness on, HF off, DAC correction off, SDM output.

/**
 * One stage of the signal chain on the rail: level 0 a top stage, 1 a Matrix engine part; `on` lights its lamp;
 * `drawer` is the id of the drawer it opens.
 *
 * @typedef {object} ChainStage
 * @property {string} id
 * @property {number} level
 * @property {boolean} on
 * @property {string} name
 * @property {string} value
 * @property {string} drawer
 */

/** @type {ChainStage[]} */
export const CHAIN = [
  { id: "source", level: 0, on: true, name: "Source", value: "44.1 kHz / 16bit / 2ch", drawer: "source" },
  { id: "hf", level: 0, on: false, name: "HF filter", value: "Inactive", drawer: "hf" },
  // DSD Processing: what a DSD source goes through before anything else (the matrix runs after the conversion to PCM,
  // Jussi). Always shown (its settings are reachable whatever plays); in the path only while a DSD source plays processed,
  // otherwise unlit (conversion.js). Hideable (Visual settings). Value: what it runs for the running mode.
  { id: "dsd", level: 0, on: true, name: "DSD Processing", value: "", drawer: "dsd" },
  { id: "matrix", level: 0, on: true, name: "Matrix engine", value: "[Default]", drawer: "matrix" },
  { id: "pipelines", level: 1, on: true, name: "DSP pipelines", value: "2 active", drawer: "pipelines" },
  { id: "crossfeed", level: 1, on: false, name: "Crossfeed", value: "Off", drawer: "crossfeed" },
  { id: "loudness", level: 1, on: true, name: "Loudness", value: "0% applied", drawer: "loudness" },
  // Source rate | output rate seam: Resampling converts. Everything after it runs at the output rate.
  { id: "resampling", level: 0, on: true, name: "Resampling", value: "poly-sinc-ext2", drawer: "resampling" },
  // DAC correction runs at the output rate ("DAC correction runs at the output rate", Jussi) and needs the matrix engine
  // (its lamp goes dark with it); a matrix-profile setting, the Matrix engine family's drawer.
  { id: "correction", level: 0, on: false, name: "DAC correction", value: "Bypassed", drawer: "correction" },
  // Volume: before Shaping (the dither "has significant impact on quality of this adjustment", manual §2.15). Its order
  // against DAC correction is unconfirmed.
  { id: "volume", level: 0, on: true, name: "Volume", value: "−12.5 dB", drawer: "volume" },
  { id: "shaping", level: 0, on: true, name: "Shaping", value: "AMSDM7EC 512+fs", drawer: "shaping" },
  // Speakers (manual §5): delays at the target rate, applied even to bit-perfect DSD under Direct SDM, so after Shaping.
  { id: "speakers", level: 0, on: true, name: "Speakers", value: "2.0 — stereo", drawer: "speakers" },
  { id: "output", level: 0, on: true, name: "Output", value: "22.579 MHz / 1bit / 2ch", drawer: "output" },
];
