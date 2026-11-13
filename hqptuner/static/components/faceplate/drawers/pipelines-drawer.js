// The DSP pipelines drawer's schema: the Overview, then one tab per output the pipeline set feeds, named as
// store/faceplate/drawers/pipelines.js `pipelinesView` names them. Every tab is one block staging the whole set
// (`matrix_pipelines`), so a staged set dots the tab it shows. The blocks are pipelines/Overview.js and
// pipelines/Output.js; every output tab mounts the same output block, which draws the output its tab names.

import { pipelinesView } from "../../../store/faceplate/drawers/pipelines.js";
import { PipelinesOverview } from "./pipelines/Overview.js";
import { PipelinesOutput } from "./pipelines/Output.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/drawer.js").DrawerTab} DrawerTab */

const KEYS = ["matrix_pipelines"];

/** @type {DrawerSchema} */
export const PIPELINES_DRAWER = {
  id: "pipelines",
  family: "matrix",
  title: "DSP pipelines",
  aria: "DSP pipelines settings",
  /** @returns {DrawerTab[]} */
  get tabs() {
    return [
      { id: "overview", label: "Overview", body: [{ block: "overview", keys: KEYS }] },
      ...pipelinesView().outputs.map((t) => ({ id: t.id, label: t.label, body: [{ block: "output", keys: KEYS }] })),
    ];
  },
};

/** The components the DSP pipelines drawer's block items mount, by name. */
export const PIPELINES_BLOCKS = { overview: PipelinesOverview, output: PipelinesOutput };
