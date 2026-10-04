// Connection step (wizard §1.6 Rate detection): how the DAC takes its input; the last two answers fix the limits.

import { STB_IFACES } from "../../../../data/builders/station-builder.js";
import { withConnection } from "../../../../model/builders/station.js";
import { choice } from "../frame/parts.js";

/** @typedef {import('../../station-builder.js').StationState} StationState */

/**
 * The Connection step's rows: a new answer forgets the 48k-family check.
 *
 * @param {StationState} sb
 */
export const ifaceStep = (sb) => [
  choice("", STB_IFACES, sb.e.rec.iface, {
    pick: (v) =>
      sb.set((x) => {
        Object.assign(x, withConnection(x, STB_IFACES, v));
        delete sb.runs.rates;
      }),
  }),
];
