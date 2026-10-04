// Source stage drawer: schema + meter mock config.
// The engine's metering stream taps the SOURCE: rate = source rate (DSD decimated to its base rate),
// bins to source Nyquist, before pre-processing unless "Pre-process before metering" moves the tap after it.
// So the meter lives on the Source stage. The drawer holds the meter only: no settings, nothing stages.
// "Pre-process before metering" belongs to the HF filter drawer; UPnP freewheel to System settings.
//
// Tab body items (see drawer.js):
//   {row}          one setting row: control column | manual copy
//   {block: name}  a non-setting instrument mounted from deps.blocks[name] (never marks the tab dirty)

/** @type {import('./output.js').DrawerSchema} */
export const SOURCE_DRAWER = {
  id: "source",
  title: "Source",
  aria: "Source meter",
  restart: false,
  tabs: [{ id: "meter", label: "Meter", body: [{ block: "meter" }] }],
};

// Meter view prefs + mock source. Frequency axes are linear (0 to source Nyquist) only.
export const METER = {
  channels: 2,
  nyquist: 22050, // 44.1k source; DSD64 reports the same after decimation
  floors: [-48, -60, -90],
  floor: -60, // level meters, dBFS
  ranges: [60, 90, 120, 200, 300],
  range: 90, // spectrum y span and spectrogram colour span, dB
  pageRanges: [60, 90, 120],
  pageRange: 90, // the page's one Range: spectrum span and level floor (−range), dB
  channel: "sum", // '0' | '1' | 'sum'
  /** @type {{ v: number | "all", label: string }[]} */
  windows: [
    // spectrogram + apodizing strip time axis; 'all' = since track start
    { v: 30, label: "30 s" },
    { v: 60, label: "1 min" },
    { v: 120, label: "2 min" },
    { v: 300, label: "5 min" },
    { v: "all", label: "All" },
  ],
  window: 60,
  colsPerSec: 10,
  trackElapsedSec: 200, // mock: 3:20 into the track; history starts at track start
};
