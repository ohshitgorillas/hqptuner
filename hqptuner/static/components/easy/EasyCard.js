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

// Album and Playlist are the two grids, and the switcher is a plain `Segment` at
// the app's ONE segment size. The Matrix banner's size exemption is named for
// that banner and does not extend here (docs/design-system.md).
const GRID_SEGS = [
  { value: "album", label: "Album" },
  { value: "playlist", label: "Playlist" },
];

/** The Easy Mode card: the simplification notice, the Album/Playlist switcher, its grid, and the way out. */
export function EasyCard() {
  return html`
    <${Card}
      id="easy-mode"
      title="Easy Mode"
      subtitle=${html`<span data-note="easy-notice">${easyProse("notice")}</span>`}
    >
      <div class="easy-switcher">
        <${Segment}
          value=${easyGrid.value}
          options=${GRID_SEGS}
          onChange=${(/** @type {string | number} */ v) => setEasyGrid(String(v))}
        />
      </div>
      <div class="easy-grid" data-grid=${easyGrid.value}></div>
      <button type="button" class="easy-exit" data-testid="easy-exit" onClick=${() => setEasyMode(false)}>
        Back to full control
      </button>
    <//>
  `;
}
