// The stage drawers, by rail stage id in signal order: each stage's schema and the components its blocks mount. A
// stage with no entry draws its bare drawer, title and close alone. Members of a family are registered here, so an edit in one lights
// every member's apply group.

import { registerDrawer } from "../../../store/faceplate/drawer.js";
import { SOURCE_BLOCKS, SOURCE_DRAWER } from "./source-drawer.js";
import { HF_DRAWER } from "./hf.js";
import { DSD_DRAWER, RESAMPLING_DRAWER, SHAPING_DRAWER } from "./modes.js";
import { CORRECTION_DRAWER, MATRIX_DRAWER } from "./matrix.js";
import { PIPELINES_BLOCKS, PIPELINES_DRAWER } from "./pipelines-drawer.js";
import { CROSSFEED_DRAWER, FAMILY_BLOCKS, LOUDNESS_DRAWER } from "./matrix-family.js";
import { VOLUME_BLOCKS, VOLUME_DRAWER } from "./volume.js";
import { SPEAKERS_BLOCKS, SPEAKERS_DRAWER } from "./speakers-drawer.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../drawer/Rows.js").Blocks} Blocks */
/** @typedef {{ schema: DrawerSchema, blocks: Blocks }} StageDrawer */

/** @type {Record<string, StageDrawer>} */
const DRAWERS = {
  source: { schema: SOURCE_DRAWER, blocks: SOURCE_BLOCKS },
  hf: { schema: HF_DRAWER, blocks: {} },
  dsd: { schema: DSD_DRAWER, blocks: {} },
  matrix: { schema: MATRIX_DRAWER, blocks: {} },
  pipelines: { schema: PIPELINES_DRAWER, blocks: PIPELINES_BLOCKS },
  crossfeed: { schema: CROSSFEED_DRAWER, blocks: FAMILY_BLOCKS },
  loudness: { schema: LOUDNESS_DRAWER, blocks: FAMILY_BLOCKS },
  resampling: { schema: RESAMPLING_DRAWER, blocks: {} },
  correction: { schema: CORRECTION_DRAWER, blocks: {} },
  volume: { schema: VOLUME_DRAWER, blocks: VOLUME_BLOCKS },
  shaping: { schema: SHAPING_DRAWER, blocks: {} },
  speakers: { schema: SPEAKERS_DRAWER, blocks: SPEAKERS_BLOCKS },
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
