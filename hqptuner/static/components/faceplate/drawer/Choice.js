// A choice: vertical radio lines spanning the row under its label and paragraphs. Each line is its radio and name
// (both pick it), its detail control when it names a catalog key, and its paragraph. A detail is grayed and disabled
// unless its line is picked; the picked line's detail prints its gray reason in the choice's control column.

import { html } from "../../../lib/dom.js";
import { schema as catalog } from "../../../store/schema.js";
import { describe } from "../../../store/prose.js";
import { grayReason } from "../../../store/ui/graying.js";
import { grayLine, keyControl, labelHead } from "./controls.js";

/** @typedef {import("../../../store/faceplate/drawer.js").ChoiceSpec} ChoiceSpec */
/** @typedef {import("../../../store/faceplate/drawer.js").ChoiceLine} ChoiceLine */

/**
 * A line's detail: its key's control, live only while the line is picked.
 *
 * @param {ChoiceLine} l
 * @param {boolean} on
 */
function detail(l, on) {
  const key = /** @type {string} */ (l.key);
  const entry = catalog[key];
  if (!entry) return null;
  const { label } = describe(entry, key);
  return keyControl({ key, entry, label, off: !on || !!grayReason(key), options: l.options });
}

/**
 * One radio line; tapping its radio or name picks it unless it is picked.
 *
 * @param {ChoiceSpec} c
 * @param {ChoiceLine} l
 * @param {boolean} on
 */
function line(c, l, on) {
  const pick = () => (on ? undefined : c.pick(l.v));
  return html`
    <div class=${on ? "chline cur" : "chline"} data-v=${l.v}>
      <div class="chl">
        <button
          type="button"
          class="radio"
          role="radio"
          aria-checked=${String(on)}
          aria-label=${l.label}
          onClick=${pick}
        ></button>
        <span class="chn" onClick=${pick}><b>${l.label}</b>${l.sub ? html`<span class="s">${l.sub}</span>` : null}</span>
        ${l.key ? detail(l, on) : null}
      </div>
      <div class="man"><p>${l.man}</p></div>
    </div>
  `;
}

/**
 * One choice.
 *
 * @param {ChoiceSpec} c
 */
export function choice(c) {
  const cur = String(c.value());
  const picked = c.lines.find((l) => String(l.v) === cur);
  const why = picked?.key ? grayReason(picked.key) : "";
  return html`
    <div class="drow" data-choice=${c.id}>
      <div class="ctl">${labelHead(c.label)} ${grayLine(why)}</div>
      <div class="man">${c.man.map((p) => html`<p>${p}</p>`)}</div>
      <div class="chlist" role="radiogroup" aria-label=${c.label}>
        ${c.lines.map((l) => line(c, l, l === picked))}
      </div>
    </div>
  `;
}
