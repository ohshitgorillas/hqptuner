// The Volume drawer's schema. Level: Fixed volume as one choice, Off, Manual with the dBFS level as its detail, or Auto
// (Auto headroom) with its −3 | −6 dB level as its detail. Gain: Adaptive volume (live), Playlist album gain and PCM
// gain compensation. Range: the range bar, a block staging Min, Startup and Max. The playback level itself lives in the
// engine row, never here.
//
// The choice's label and paragraphs come from the settings metadata, read when the drawer draws, since the metadata
// arrives after this module loads; the strings written here are the ones the metadata does not hold, verbatim from the
// mockup's Volume drawer (mockup/scripts/data/stages/volume.js).

import { schema as catalog } from "../../../store/schema.js";
import { ISO_LEVELS } from "../../../store/schema/options.js";
import { describe } from "../../../store/prose.js";
import { fixedMode, pickFixedMode, RANGE_KEYS } from "../../../store/faceplate/drawers/volume.js";
import { VolumeRangeBody } from "./VolumeRange.js";

/**
 * A setting's label and paragraph from the settings metadata.
 *
 * @param {string} key
 */
const prose = (key) => describe(catalog[key], key);

/** @type {import("../../../store/faceplate/drawer.js").ChoiceSpec} */
const FIXED = {
  id: "fixed_mode",
  get label() {
    return prose("fixed_volume_enabled").label;
  },
  get man() {
    return [prose("fixed_volume_enabled").tooltip];
  },
  value: fixedMode,
  pick: pickFixedMode,
  lines: [
    { v: "off", label: "Off", man: "Volume is adjustable live." },
    {
      v: "manual",
      label: "Manual",
      get man() {
        return prose("fixed_volume").tooltip;
      },
      key: "fixed_volume",
    },
    {
      v: "auto",
      label: "Auto",
      sub: catalog.optimal_iso?.sublabel,
      get man() {
        return prose("optimal_iso").tooltip;
      },
      key: "optimal_iso",
      options: ISO_LEVELS.filter((o) => o.value !== "0"),
    },
  ],
};

/** @type {import("../../../store/faceplate/drawer.js").DrawerSchema} */
export const VOLUME_DRAWER = {
  id: "volume",
  title: "Volume",
  aria: "Volume settings",
  tabs: [
    { id: "level", label: "Level", body: [{ choice: FIXED }] },
    {
      id: "gain",
      label: "Gain",
      body: [
        { row: { key: "adaptive_volume" } },
        { row: { key: "playlist_album_gain" } },
        { row: { key: "gain_comp" } },
      ],
    },
    {
      id: "range",
      label: "Range",
      body: [{ block: "range", keys: [RANGE_KEYS.min, RANGE_KEYS.startup, RANGE_KEYS.max] }],
    },
  ],
};

/** The components the Volume drawer's block items mount, by name. */
export const VOLUME_BLOCKS = { range: VolumeRangeBody };
