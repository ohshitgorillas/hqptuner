// The Volume drawer's schema. Level: Fixed volume as one choice, Off, Manual with the dBFS level as its detail, or Auto
// (Auto headroom) with its −3 | −6 dB level as its detail. Gain: Adaptive volume (live), Playlist album gain and PCM
// gain compensation. Range: the range bar, a block staging Min, Startup and Max. The playback level itself lives in the
// engine row, never here. The Fixed volume choice is a local control (store/schema/local.js).

import { local } from "../../../store/schema/local.js";
import { RANGE_KEYS } from "../../../store/faceplate/drawers/volume.js";
import { VolumeRangeBody } from "./VolumeRange.js";

/** @type {import("../../../store/faceplate/drawer.js").DrawerSchema} */
export const VOLUME_DRAWER = {
  id: "volume",
  title: "Volume",
  aria: "Volume settings",
  tabs: [
    { id: "level", label: "Level", body: [{ choice: local.fixed_mode }] },
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
