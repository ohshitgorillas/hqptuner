// Connection step (wizard §1.5 Rate detection): how the DAC takes its input; the last two answers fix the limits.

import { STB_IFACES } from "../../data/station-builder.js";
import { withConnection } from "../../model/station.js";
import { choice } from "./parts.js";

/** The Connection step's rows: a new answer forgets the 48k-family check. */
export const ifaceStep = (sb) => [
  choice("", STB_IFACES, sb.e.rec.iface, (v) =>
    sb.set((x) => {
      Object.assign(x, withConnection(x, STB_IFACES, v));
      delete sb.runs.rates;
    }),
  ),
];
