// Easy Mode's card — the whole feature's frame. It stands in place of the three
// cards a user reaches Easy Mode from (Narrow filters, PCM Chain, SDM Chain);
// the swap itself belongs to the pages that render those cards, so this
// component knows nothing about what it replaced.
//
// A real `Card`, not a panel of its own: it sits in the same stack as the cards
// it stands in for, and anything painting the card surface under its own class
// name is how a panel drifts to the wrong border token (docs/design-system.md).
//
// The notice under the title is Signalyst's condition for approving the preset
// set, so unlike the narrow bar's intro it is NOT behind the manual-text pref —
// it is part of the card, not commentary on it. It rides the `subtitle` slot,
// which is exactly "directly under the title, above everything else in the body".
//
// The grid container is empty here. The tiles that fill it are a later phase;
// what this phase settles is that there is exactly ONE of them and it says which
// grid it is, so the tiles have somewhere to land and something to read.
import { html } from "../../lib/dom.js";
import { Card } from "../common.js";
import { Segment } from "../controls/index.js";
import { easyGrid, setEasyGrid, setEasyMode } from "../../store/easyview.js";
import { easyProse } from "../../store/prose.js";
import { matchPreset, presetsFor } from "../../store/easy.js";
import { easyLane } from "../../store/easylane.js";
import { AddTile, PresetTile } from "./Tile.js";

// Album and Playlist are the two grids, and the switcher is a plain `Segment` at
// the app's ONE segment size. The Matrix banner's size exemption is named for
// that banner and does not extend here (docs/design-system.md).
const GRID_SEGS = [
  { value: "album", label: "Album" },
  { value: "playlist", label: "Playlist" },
];

// The way out sits in this card's head, at the same top-right corner the way in
// occupies in the Narrow filters head. Going in and coming out are one control
// in two states as far as the user is concerned, so they are in the same place;
// a link at the bottom of the card is somewhere else entirely, and the card
// grows a grid of tiles between the two in the next phase.
function ExitLink() {
  return html`<button
    type="button"
    class="easy-exit"
    data-testid="easy-exit"
    onClick=${() => setEasyMode(false)}
  >
    Back to full control
  </button>`;
}

// Where each knob stands on a tile that is NOT lit: its own default. There is no
// third answer, because nothing remembers a position a user left on a preset
// they then moved away from — the lit tile's positions are read back out of the
// filter values, and every other tile shows where it would start.
/**
 * @param {import("../../store/easy.js").Preset} preset
 * @returns {Record<string, string>}
 */
const defaults = (preset) => Object.fromEntries(preset.knobs.map((k) => [k.id, k.default]));

// The grid is derived end to end: the lane says what the filters are, the preset
// table says which preset that corresponds to, and the tiles paint that. Nothing is
// stored and nothing is remembered, so a filter changed by hand in a chain card
// shows up here on the same poll.
/** @param {{ lane: string }} props */
function Grid({ lane }) {
  const grid = easyGrid.value;
  const l = easyLane(lane);
  const hit = matchPreset(l.values, l.mode);
  return html`
    <div class="easy-grid" data-grid=${grid}>
      ${presetsFor(grid).map((preset) => {
        const on = !!hit && hit.grid === grid && hit.presetId === preset.id;
        return html`<${PresetTile}
          grid=${grid}
          preset=${preset}
          lane=${lane}
          active=${on}
          knobs=${on ? hit.knobs : defaults(preset)}
        />`;
      })}
      <${AddTile} />
    </div>
  `;
}

/**
 * The Easy Mode card: the way out, the simplification notice, the Album/Playlist switcher and its grid.
 * @param {{ lane?: string }} props which page's write lane the tiles use
 */
export function EasyCard({ lane = "config" }) {
  return html`
    <${Card}
      id="easy-mode"
      title=${html`Easy Mode<${ExitLink} />`}
      subtitle=${html`<span data-note="easy-notice">${easyProse("notice")}</span>`}
    >
      <div class="easy-switcher">
        <${Segment}
          value=${easyGrid.value}
          options=${GRID_SEGS}
          onChange=${(/** @type {string | number} */ v) => setEasyGrid(String(v))}
        />
      </div>
      <${Grid} lane=${lane} />
    <//>
  `;
}
