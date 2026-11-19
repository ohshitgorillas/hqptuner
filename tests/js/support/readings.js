// Served field readings for tests, and the one place a test sets a field's value.
import { refreshReadings } from "../../../hqptuner/static/store/core/readings.js";
import { generation } from "../../../hqptuner/static/store/signals.js";
import { ok } from "./wire/wire.js";

/** @typedef {import("../../../hqptuner/static/model/store/reading.js").FieldReading} FieldReading */
/** @typedef {import("../../../hqptuner/static/store/faceplate/chain.js").Running} Running */

/** The engine's name for each conversion the running pictures carry. */
export const CONV = {
  filter1x: "poly-sinc-gauss-long",
  filterNx: "sinc-Mx",
  shaper: "NS9",
  noise: "standard-fir",
  decim: "poly-sinc-short-mp",
  integ: "IIR2",
  sdmconv: "XFi",
};

/**
 * A running picture: a CD source playing to a PCM rate with the matrix engine on and nothing else engaged, overridden by
 * `over`.
 *
 * @param {Partial<Running>} [over]
 * @returns {Running}
 */
export const running = (over = {}) => ({
  path: "pcm-pcm",
  chain: "pcm",
  stage: "1x",
  direct: false,
  metadata: { samplerate: "44100", bits: "16" },
  status: { active_rate: "352800", active_bits: "32" },
  hf: "none",
  conv: CONV,
  matrix: true,
  profile: "Desk nearfield",
  pipelines: 2,
  working: false,
  crossfeed: null,
  loudness: false,
  applied: 0,
  correction: false,
  model: "",
  volume: "-20",
  speakers: false,
  hidden: [],
  ...over,
});

/**
 * One served field reading (`model/store/reading.js` FieldReading) showing `value`: `engine` carries it unless `over.show` is "file", then `file` does; `lane` "form", `restarts` and `diverges` false, `staged` null, `bounds` null unless `over` sets them; stamped with `over.generation`, else the current `generation` of `store/signals.js`.
 *
 * @param {unknown} value
 * @param {Partial<FieldReading> & { generation?: number, name?: string }} [over]
 * @returns {FieldReading}
 */
export function fieldReading(value, over = {}) {
  const { generation: stamp = generation.value, name = String(value), ...rest } = over;
  const fromFile = rest.show === "file";
  return /** @type {FieldReading} */ ({
    engine: fromFile ? null : { value, name, generation: stamp },
    file: fromFile ? { value, generation: stamp } : null,
    staged: null,
    lane: "form",
    show: fromFile ? "file" : "engine",
    restarts: false,
    diverges: false,
    bounds: null,
    ...rest,
  });
}

/**
 * Whether `entry` is already a served reading: a FieldReading, or a read-only field's `{ value, readonly: true }`.
 *
 * @param {unknown} entry
 */
function served(entry) {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return false;
  return ("show" in entry && "lane" in entry) || ("readonly" in entry && entry.readonly === true);
}

/**
 * Load `{ generation, fields }` into `readings` the way production does, through `refreshReadings`: a plain value in `fields` becomes `fieldReading(value)`, a FieldReading is kept as given; `generation` defaults to the current `generation` of `store/signals.js`. The seed's own `/api/config` request is answered with that body, and `globalThis.fetch` is back to what it held before the call before the seed first yields, so a test's own wire never answers the seed and the seed never answers the test. The returned promise resolves once `readings` has adopted the body.
 *
 * @param {Record<string, unknown>} fields
 * @param {number} [stamp]
 */
export async function seedReadings(fields, stamp = generation.value) {
  /** @type {Record<string, unknown>} */
  const entries = {};
  for (const [key, entry] of Object.entries(fields)) entries[key] = served(entry) ? entry : fieldReading(entry);
  const body = { generation: stamp, fields: entries };
  const held = globalThis.fetch;
  globalThis.fetch = /** @type {typeof fetch} */ (/** @type {unknown} */ (async () => ok(body)));
  let adopted;
  try {
    adopted = refreshReadings();
  } finally {
    globalThis.fetch = held;
  }
  await adopted;
}

/**
 * A wire answer the test settles by hand: `reply` is what a route returns, `answer(response)` is the moment the engine answers.
 *
 * @returns {{ reply: Promise<ReturnType<typeof ok>>, answer: (response: ReturnType<typeof ok>) => void }}
 */
export function heldReply() {
  /** @type {(value: ReturnType<typeof ok>) => void} */
  let answer = () => {};
  const reply = new Promise((resolve) => {
    answer = resolve;
  });
  return { reply, answer };
}
