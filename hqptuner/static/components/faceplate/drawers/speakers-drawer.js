// The Speakers drawer's schema: one tab, the speaker-processing switch as a field over the drawer's own form, then the
// block (components/faceplate/drawers/Speakers.js). The switch and the block's edits are held by
// store/faceplate/drawers/speakers.js, never in the staged set: the form's own POST reloads the engine, so the apply
// group runs that form (`own`). Strings verbatim from mockup/scripts/data/stages/speakers.js and matrix.js as cited.

import {
  applyDraft,
  discardDraft,
  setSpeakersGate,
  speakerDraft,
  staged,
} from "../../../store/faceplate/drawers/speakers.js";
import { SpeakersBody } from "./Speakers.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */

/** The switch's paragraphs (mockup speakers.js:39 v1 owner copy, :42 and :45 manual §5). */
const MAN = [
  "Level trims each channel's output; distance delays the nearer speakers so every channel arrives at the listening position together.",
  "This method is suitable for simplest per-channel level adjustment and is processed in simpler and lighter way than full pipeline matrix.",
  "Note! Distance processing is available also for bit-perfect pass-through of DSD when Direct SDM is enabled!",
];

/** The switch's two options, bypass leftmost (mockup matrix.js:94-97). */
const ENGAGE_BYPASS = [
  { value: "0", label: "Bypass" },
  { value: "1", label: "Engage" },
];

/** @type {DrawerSchema} */
export const SPEAKERS_DRAWER = {
  id: "speakers",
  title: "Speakers",
  aria: "Speakers settings",
  tabs: [
    {
      id: "speakers",
      label: "Speakers",
      body: [
        {
          field: {
            id: "spken",
            label: "Speakers",
            man: MAN,
            options: ENGAGE_BYPASS,
            value: () => (speakerDraft().enabled ? "1" : "0"),
            set: (v) => setSpeakersGate(v === "1"),
          },
        },
        { block: "speakers" },
      ],
    },
  ],
  own: { staged: () => staged.value, apply: applyDraft, discard: discardDraft },
};

/** The components the schema's blocks mount, by name. */
export const SPEAKERS_BLOCKS = { speakers: SpeakersBody };
