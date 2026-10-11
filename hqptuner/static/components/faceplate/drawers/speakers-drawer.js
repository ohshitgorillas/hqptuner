// The Speakers drawer's schema: one tab, the speaker-processing switch as the catalog's row (`spken`,
// store/schema/speakers.js), then the block (components/faceplate/drawers/Speakers.js). The switch and the block's edits
// are held by store/faceplate/drawers/speakers.js, never in the staged set: the form's own POST reloads the engine, so
// the apply group runs that form (`own`).

import { applyDraft, discardDraft, staged } from "../../../store/faceplate/drawers/speakers.js";
import { SpeakersBody } from "./Speakers.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

/** @type {DrawerSchema} */
export const SPEAKERS_DRAWER = {
  id: "speakers",
  title: "Speakers",
  aria: "Speakers settings",
  tabs: [
    {
      id: "speakers",
      label: "Speakers",
      body: [{ row: { key: "spken" } }, { block: "speakers" }],
    },
  ],
  own: { staged: () => staged.value, apply: applyDraft, discard: discardDraft },
};

/** The components the schema's blocks mount, by name. */
export const SPEAKERS_BLOCKS = { speakers: SpeakersBody };
