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
import { Apod } from "../controls/apod.js";
import { easyProse, paragraphs } from "../../store/prose.js";
import { easyHelp, toggleEasyHelp } from "../../store/easyview.js";
import { MARK_LABEL, markRuns } from "./marks.js";

// A paragraph that names a mark shows the mark, not a description of it: the
// glyphs are drawn geometry and there is no circled one-half to type, so the
// approved sentence carries a stand-in and the real mark is swapped in here.
/** @param {{ para: string }} props */
function Para({ para }) {
  return html`${markRuns(para).map((run) =>
    run.kind === undefined ? run.text : html`<${Apod} kind=${run.kind} label=${MARK_LABEL[run.kind]} />`,
  )}`;
}

/** The help panel, or nothing when it is closed. */
export function EasyHelp() {
  if (!easyHelp.value) return null;
  return html`
    <aside class="easy-help" data-testid="easy-help-panel">
      <div class="easy-help-body t-label">
        <span class="easy-help-title t-head">${easyProse("help", "title")}</span>
        ${paragraphs(easyProse("help", "body")).map(
          (para, i) => html`<span data-para=${String(i)}><${Para} para=${para} /></span>`,
        )}
      </div>
      <button type="button" class="easy-help-close" data-testid="easy-help-close" onClick=${toggleEasyHelp} aria-label="Close">
        ×
      </button>
    </aside>
  `;
}
