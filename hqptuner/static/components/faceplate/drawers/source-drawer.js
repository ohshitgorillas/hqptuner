// The Source drawer's schema: one tab holding the meter alone, no settings, so nothing stages and the apply group never
// shows. The meter is the block Source.js draws.

import { SourceMeter } from "./Source.js";

/** @type {import("../../../store/faceplate/drawer.js").DrawerSchema} */
export const SOURCE_DRAWER = {
  id: "source",
  title: "Source",
  aria: "Source meter",
  tabs: [{ id: "meter", label: "Meter", body: [{ block: "meter" }] }],
};

/** The components the Source drawer's block items mount, by name. */
export const SOURCE_BLOCKS = { meter: SourceMeter };
