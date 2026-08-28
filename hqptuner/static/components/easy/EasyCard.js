// Easy Mode's card — the whole feature's frame. It stands in place of the three
// cards a user reaches Easy Mode from (Narrow filters, PCM Chain, SDM Chain);
// the swap itself belongs to the pages that render those cards, so this
// component knows nothing about what it replaced.
//
// A real `Card`, not a panel of its own: it sits in the same stack as the cards
// it stands in for, and anything painting the card surface under its own class
// name is how a panel drifts to the wrong border token (docs/design-system.md).
//
// The paragraph under the title says what the mode is and states that only a
// few of HQPlayer's filters are reachable through it, which is Signalyst's
// condition for approving the preset set. So unlike the narrow bar's intro it is
// NOT behind the manual-text pref — it is part of the card, not commentary on
// it. It rides the `subtitle` slot, which is exactly "directly under the title,
// above everything else in the body".
//
// The link after it opens the help panel, which is NOT in the card: six
// paragraphs of guidance here would push the grid off the screen for everyone
// who never asked for them (Help.js).
//
// There is exactly ONE grid container and it says which grid it is, so a tile
// has somewhere to land and something to read. Which page's write lane the tiles
// use arrives as a prop, because this same card renders on the Output tab, where
// an edit is staged, and on LIVE, where it is written straight through.
import { html } from "../../lib/dom.js";
import { Card } from "../common.js";
import { Segment } from "../controls/index.js";
import { easyGrid, knobsFor, setEasyGrid, setEasyMode, toggleEasyHelp } from "../../store/easyview.js";
import { easyProse } from "../../store/prose.js";
import { matchPreset, presetsFor } from "../../store/easy.js";
import { easyLane } from "../../store/easylane.js";
import { EasyHelp } from "./Help.js";
import { PresetTile } from "./Tile.js";

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

// Where each knob stands on a tile that is NOT lit: where the user last put it,
// falling back to the knob's own default. The lit tile's positions are read back
// out of the filter values, so they exist only while it is lit — without the
// record, pressing another tile would drop the one you left back to its defaults
// and lose a position you set (store/easyview.js).
//
// Merged over the defaults rather than used raw, so a preset that later gains a
// knob still has a position for the one nothing was recorded for.
/**
 * @param {string} grid
 * @param {import("../../store/easy.js").Preset} preset
 * @returns {Record<string, string>}
 */
const resting = (grid, preset) => ({
  ...Object.fromEntries(preset.knobs.map((k) => [k.id, k.default])),
  ...knobsFor(grid, preset.id),
});

// Which tile is lit is derived end to end: the lane says what the filters are,
// the preset table says which preset that corresponds to, and the tiles paint
// that. Nothing about the marking is stored, so a filter changed by hand in a
// chain card shows up here on the same poll. The only thing remembered is where
// a DARK tile's knobs sit, which the fields cannot say.
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
          knobs=${on ? hit.knobs : resting(grid, preset)}
        />`;
      })}
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
      subtitle=${html`<span data-note="easy-notice">
        ${easyProse("notice")}
        <button type="button" class="easy-help-link" data-testid="easy-help" onClick=${toggleEasyHelp}>
          ${easyProse("help", "link")}
        </button>
      </span>`}
    >
      <div class="easy-switcher" data-testid="easy-switcher">
        <${Segment}
          value=${easyGrid.value}
          options=${GRID_SEGS}
          onChange=${(/** @type {string | number} */ v) => setEasyGrid(String(v))}
        />
      </div>
      <${Grid} lane=${lane} />
      <${EasyHelp} />
    <//>
  `;
}
