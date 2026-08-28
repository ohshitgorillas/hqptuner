// Easy Mode's help panel: the block behind the "Still confused?" link in the
// card's subtitle.
//
// It is not part of the card. A card grows to hold what it says, and six
// paragraphs of guidance inside the Easy Mode card would push the tile grid off
// the screen for everyone, including the people who never asked. So the panel
// rises from the page floor instead, the way the pending bar does, and the grid
// stays where it was.
//
// Rendered only while open. There is no collapsed height, no hidden copy in the
// document and nothing to skip past for a reader who is using the tiles.
import { html } from "../../lib/dom.js";
import { easyProse, paragraphs } from "../../store/prose.js";
import { easyHelp, toggleEasyHelp } from "../../store/easyview.js";

/** The help panel, or nothing when it is closed. */
export function EasyHelp() {
  if (!easyHelp.value) return null;
  return html`
    <aside class="easy-help" data-testid="easy-help-panel">
      <div class="easy-help-body">
        ${paragraphs(easyProse("help", "body")).map((para, i) => html`<p class="t-label" data-para=${String(i)}>${para}</p>`)}
      </div>
      <button type="button" class="easy-help-close" data-testid="easy-help-close" onClick=${toggleEasyHelp} aria-label="Close">
        ×
      </button>
    </aside>
  `;
}
