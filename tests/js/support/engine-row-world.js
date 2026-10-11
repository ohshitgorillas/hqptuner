// One browser's view of the engine row's counter lamps, loaded in a worker of its own so that what the browser's
// localStorage held at page load is the only thing that differs between two views.
//
// The UI prefs are read from storage once, when their module loads, so two browsers holding different storage cannot
// share one module graph. Each call to `lampsIn` starts a worker on this same file; the worker installs the fake
// localStorage with the entries it was handed, only then imports the app's modules, plays a fixed run of Status
// frames into `engineStatus` the way the poll does, and posts back each counter lamp's attributes after every frame.
// Nothing of HQPTuner's is stubbed.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

/** A Status frame while playing, as the daemon sends it: strings. @type {Record<string, string>} */
const PLAYING = {
  state: "2",
  process_speed: "1.62",
  input_fill: "0.82",
  output_fill: "0.74",
  track_serial: "7",
};

/** The counters' totals frame by frame: the track starts, both counters rise, then they hold for two frames. */
const COUNTS = [
  { clips: "3", apod: "5398" },
  { clips: "5", apod: "5410" },
  { clips: "5", apod: "5410" },
  { clips: "5", apod: "5410" },
];

/** Seconds of playback each frame moves the position on. */
const STEP = 2;

/** The counters the engine row draws a lamp for, by their `data-k`. */
const COUNTERS = ["clips", "apod"];

/**
 * The attribute run of every counter lamp after each frame, one string per lamp, frames in order and the counters in
 * COUNTERS order within a frame, as a browser whose localStorage held `stored` at page load renders them.
 *
 * @param {Record<string, string>} stored
 * @returns {Promise<string[]>}
 */
export function lampsIn(stored) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: stored });
    worker.once("message", resolve);
    worker.once("error", reject);
  });
}

async function play() {
  const { useStorage } = await import("./storage.js");
  const storage = useStorage();
  for (const [key, value] of Object.entries(/** @type {Record<string, string>} */ (workerData))) {
    storage.setItem(key, value);
  }
  const { render } = await import("preact-render-to-string");
  const { html } = await import("../../../hqptuner/static/lib/dom.js");
  const { EngineRow } = await import("../../../hqptuner/static/components/faceplate/EngineRow.js");
  const { engineStatus } = await import("../../../hqptuner/static/store/signals.js");
  const { initHealth } = await import("../../../hqptuner/static/store/health.js");
  const { initApodHistory } = await import("../../../hqptuner/static/store/apodhistory.js");
  const { elements, attr, classes } = await import("./markup.js");
  initHealth();
  initApodHistory();
  /** @type {string[]} */
  const lamps = [];
  COUNTS.forEach((counts, i) => {
    engineStatus.value = { status: { ...PLAYING, ...counts, position: String((i + 1) * STEP) } };
    const all = elements(render(html`<${EngineRow} />`));
    for (const k of COUNTERS) {
      const counter = all.find((e) => attr(e, "data-k") === k);
      const lamp = counter ? elements(counter.html).find((e) => classes(e).includes("lamp")) : undefined;
      // A missing lamp raises: two browsers that both drew none would otherwise read as drawing the same lamps.
      if (!lamp) throw new Error(`the engine row drew no lamp for the ${k} counter`);
      lamps.push(lamp.attrs);
    }
  });
  parentPort?.postMessage(lamps);
}

if (!isMainThread) await play();
