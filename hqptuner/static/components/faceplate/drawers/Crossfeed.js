// The Crossfeed drawer's block. The gate (v1's ENGAGE | BYPASS, acting on whichever line is picked), then the
// Bauer | Structural lines (Volume's choice grammar): the picked line holds its controls under its name and its copy
// beside them, the other folds to one summary line, so the drawer never scrolls. Picking a line is a view choice: it
// switches the implementation off on the line being left and never engages crossfeed by itself. Under the lines,
// filling the height left: Bauer's response plot, or Structural's top-down drawing with its readouts.
//
// The block grays whole, its reason legible, while the matrix engine is bypassed; crossfeed bypassed grays the lines'
// controls while the gate and the pick stay live. The decisions are store/faceplate/drawers/crossfeed.js's.

import { html } from "../../../lib/dom.js";
import { minus } from "../../../model/shell/format.js";
import { rowOptions } from "../../../store/faceplate/drawer.js";
import { crossfeedView, pickLine, setGate, xfRefusal } from "../../../store/faceplate/drawers/crossfeed.js";
import { Seg } from "./loudness/parts.js";
import { BauerControls, BauerCopy, BauerPlot } from "./crossfeed/Bauer.js";
import { Geometry, StructuralControls, StructuralCopy } from "./crossfeed/Structural.js";
import { LABEL, NAME } from "./crossfeed/copy.js";
import { withXref } from "../Xref.js";

/** @typedef {import("../../../store/faceplate/xref.js").XrefHere} XrefHere */
/** @typedef {import("../../../store/faceplate/drawers/crossfeed.js").CrossfeedView} CrossfeedView */
/** @typedef {import("../../../store/faceplate/drawers/crossfeed.js").FoldedLine} FoldedLine */
/** @typedef {"bauer" | "structural"} Line */

/** @type {Line[]} */
const LINES = ["bauer", "structural"];

/**
 * The folded line's one summary line: what it would install, in engine names and numbers.
 *
 * @param {FoldedLine} f
 */
function summary({ v, label, values }) {
  const [a, b, c] = values;
  const parts =
    v === "bauer"
      ? [label, `${a} Hz`, `${minus(b, 1)} dB`, `${c}%`]
      : [label || LABEL.custom, `${minus(a, 1)}°`, `${minus(b, 2)} cm`, `${Math.round(c)}%`];
  return parts.filter(Boolean).join(" · ");
}

/**
 * One implementation line: radio and name, then the picked line's controls and copy or the folded line's summary.
 *
 * @param {{ line: Line, view: CrossfeedView }} props
 */
function ImplLine({ line, view }) {
  const on = line === view.picked;
  const pick = () => (on ? undefined : pickLine(line));
  const Controls = line === "bauer" ? BauerControls : StructuralControls;
  const Copy = line === "bauer" ? BauerCopy : StructuralCopy;
  return html`
    <div class=${on ? "chline xline cur" : "chline xline fold"} data-v=${line}>
      <div class="xleft">
        <div class="chl">
          <button
            type="button"
            class="radio"
            role="radio"
            aria-label=${LABEL[line]}
            aria-checked=${String(on)}
            disabled=${view.live.matrix}
            onClick=${pick}
          ></button>
          <span class="chn" onClick=${view.live.matrix ? undefined : pick}><b>${LABEL[line]}</b></span>
          ${on ? null : html`<span class="xsum">${summary(view.folded)}</span>`}
        </div>
        ${on ? html`<${Controls} live=${view.live} />` : null}
      </div>
      ${on ? html`<${Copy} />` : null}
    </div>
  `;
}

/**
 * The Crossfeed drawer's block.
 *
 * @param {{ schema: import("../../../store/faceplate/drawer.js").DrawerSchema, here: XrefHere }} props  here: where it is drawn
 */
export function CrossfeedBody({ here }) {
  const view = crossfeedView();
  const { live } = view;
  const why = xfRefusal.value || view.gray;
  return html`
    <div class="xgate">
      <b class=${live.matrix ? "grayed" : undefined}>${NAME.gate}</b>
      <${Seg}
        aria=${NAME.gate}
        options=${rowOptions("crossfeed_enabled")}
        value=${view.engaged ? "1" : "0"}
        disabled=${!live.gate}
        onPick=${setGate}
      />
      <span class="gr" hidden=${!why}>${withXref(why, here)}</span>
    </div>
    <div class=${live.matrix ? "chlist xlist grayed" : "chlist xlist"} role="radiogroup" aria-label=${NAME.lines}>
      ${LINES.map((line) => html`<${ImplLine} line=${line} view=${view} />`)}
    </div>
    ${view.picked === "bauer" ? html`<${BauerPlot} grayed=${live.matrix} />` : html`<${Geometry} grayed=${live.matrix} />`}
  `;
}
