// The stage drawers, by rail stage id in signal order: each stage's schema and the components its blocks mount. A
// stage with no entry draws its bare drawer, title and close alone. Members of a family are registered here, so an edit in one lights
// every member's apply group.

import { registerDrawer } from "../../../store/faceplate/drawer.js";
import { SOURCE_BLOCKS, SOURCE_DRAWER } from "./source-drawer.js";
import { HF_DRAWER } from "./hf.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../drawer/Rows.js").Blocks} Blocks */
/** @typedef {{ schema: DrawerSchema, blocks: Blocks }} StageDrawer */

/** @type {Record<string, StageDrawer>} */
const DRAWERS = {
  source: { schema: SOURCE_DRAWER, blocks: SOURCE_BLOCKS },
  hf: { schema: HF_DRAWER, blocks: {} },
};

for (const d of Object.values(DRAWERS)) registerDrawer(d.schema);

/**
 * A rail stage's drawer: its registered schema and blocks, or a bare drawer of its name.
 *
 * @param {{ id: string, name: string }} stage
 * @returns {StageDrawer}
 */
export const stageDrawer = ({ id, name }) =>
  DRAWERS[id] ?? { schema: { id, title: name, aria: name, tabs: [{ id: "main", label: name, body: [] }] }, blocks: {} };
