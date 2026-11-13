// The VU model's state as a painter is handed it, for the suites that paint VU needles. No test() and no assert lives
// here.

/** @typedef {import("../../../../hqptuner/static/model/gauges/meter/vu.js").VuState} VuState */

/**
 * A VuState whose readings are `readings`, its deflections and speeds consistent with them.
 *
 * @param {number[]} readings  per channel, VU
 * @returns {VuState}
 */
export const vuReading = (readings) => ({
  vu: [...readings],
  deflection: readings.map((v) => 10 ** (v / 20)),
  speed: readings.map(() => 0),
});
