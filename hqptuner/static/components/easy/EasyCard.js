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
// There is exactly ONE grid container, so a tile has somewhere to land. Which
// page's write lane the tiles use arrives as a prop, because this same card
// renders on the Output tab, where an edit is staged, and on LIVE, where it is
// written straight through.
import { html } from "../../lib/dom.js";
import { Card } from "../common.js";
import { knobsFor, setEasyMode, toggleEasyHelp } from "../../store/easyview.js";
import { easyProse } from "../../store/prose.js";
import { matchPreset, presetsFor } from "../../store/easy.js";
import { presetOffered } from "../../store/easyoffer.js";
import { easyLane, easyRunning } from "../../store/easylane.js";
import { EasyHelp } from "./Help.js";
import { PresetTile } from "./Tile.js";

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
 * @param {import("../../store/easy.js").Preset} preset
 * @returns {Record<string, string>}
 */
const resting = (preset) => ({
  ...Object.fromEntries(preset.knobs.map((k) => [k.id, k.default])),
  ...knobsFor(preset.id),
});

// Which tiles are marked is derived end to end: a lane says what the filters
// are, the preset table says which preset that corresponds to, and the tiles
// paint that. Nothing about a marking is stored, so a filter changed by hand in
// a chain card shows up here on the same poll. The only thing remembered is
// where a DARK tile's knobs sit, which the fields cannot say.
//
// The roster itself is not the whole table: a preset the engine's current state
// gives no working path to is left out (store/easyoffer.js says which and why).
//
// TWO markings, from two readings of the same four fields. SELECTED is what the
// grid has picked, staged edits folded in; ACTIVE is what the engine is running,
// staged edits left out (store/easylane.js). On LIVE nothing stages and the two
// always land on one tile. On the Output tab they part the moment a preset is
// staged, and that parting is the point: with one marking, staging a preset
// takes the only mark off the tile the engine is still running and the page has
// nothing left that says what is playing.
/** @param {{ lane: string }} props */
function Grid({ lane }) {
  const l = easyLane(lane);
  const r = easyRunning(lane);
  const picked = matchPreset(l.values, l.mode);
  const running = matchPreset(r.values, r.mode);
  return html`
    <div class="easy-grid">
      ${presetsFor()
        .filter((preset) => presetOffered(preset, l.mode))
        .map((preset) => {
          const selected = !!picked && picked.presetId === preset.id;
          const active = !!running && running.presetId === preset.id;
          // Knobs follow the marking a tile carries: the selected tile shows
          // where the staged filters put them, a tile that is only active shows
          // where the running ones do, and a dark tile falls back to its record.
          let knobs = resting(preset);
          if (selected && picked) knobs = picked.knobs;
          else if (active && running) knobs = running.knobs;
          return html`<${PresetTile}
            preset=${preset}
            lane=${lane}
            selected=${selected}
            active=${active}
            knobs=${knobs}
          />`;
        })}
    </div>
  `;
}

/**
 * The Easy Mode card: the way out, the simplification notice and the grid.
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
      <${Grid} lane=${lane} />
      <${EasyHelp} />
    <//>
  `;
}
