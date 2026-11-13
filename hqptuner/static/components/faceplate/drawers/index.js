// The stage drawers, by rail stage id in signal order: each stage's schema and the components its blocks mount. A
// stage with no entry draws its bare drawer, title and close alone. Every drawer takes its title from the stage's
// current rail name. The stages whose drawer holds a staged edit are one signal, so the rail does not walk every
// drawer's keys on each status frame.

import { computed } from "@preact/signals";
import { stageMarked } from "../../../store/faceplate/drawer.js";
import { SOURCE_BLOCKS, SOURCE_DRAWER } from "./source-drawer.js";
import { HF_DRAWER } from "./hf.js";
import { DSD_DRAWER, RESAMPLING_DRAWER, SHAPING_DRAWER } from "./modes.js";
import { CORRECTION_DRAWER, MATRIX_DRAWER } from "./matrix.js";
import { PIPELINES_BLOCKS, PIPELINES_DRAWER } from "./pipelines-drawer.js";
import { CROSSFEED_DRAWER, FAMILY_BLOCKS, LOUDNESS_DRAWER } from "./matrix-family.js";
import { VOLUME_BLOCKS, VOLUME_DRAWER } from "./volume.js";
import { SPEAKERS_BLOCKS, SPEAKERS_DRAWER } from "./speakers-drawer.js";
import { OUTPUT_BLOCKS, OUTPUT_DRAWER } from "./output.js";

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
  speakers: { schema: SPEAKERS_DRAWER, blocks: SPEAKERS_BLOCKS },
  correction: { schema: CORRECTION_DRAWER, blocks: {} },
  volume: { schema: VOLUME_DRAWER, blocks: VOLUME_BLOCKS },
  shaping: { schema: SHAPING_DRAWER, blocks: {} },
  output: { schema: OUTPUT_DRAWER, blocks: OUTPUT_BLOCKS },
};

/**
 * A rail stage's drawer: its registered schema and blocks titled by the stage's current name, or a bare drawer of its
 * name. A registered drawer keeps its schema's `aria` while the name is its title, and reads `<name> settings` where
 * the rail renames the stage.
 *
 * @param {{ id: string, name: string }} stage
 * @returns {StageDrawer}
 */
export function stageDrawer({ id, name }) {
  const drawer = DRAWERS[id];
  if (!drawer) {
    return { schema: { id, title: name, aria: name, tabs: [{ id: "main", label: name, body: [] }] }, blocks: {} };
  }
  if (drawer.schema.title === name) return drawer;
  return { ...drawer, schema: { ...drawer.schema, title: name, aria: `${name} settings` } };
}

/**
 * The ids of the stages whose drawer holds a staged edit that marks its rail stage, re-derived only when staged state
 * changes: a drawer's keys and own form do not follow the stage's name.
 */
export const markedStages = computed(() => Object.keys(DRAWERS).filter((id) => stageMarked(DRAWERS[id].schema)));
