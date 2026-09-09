// The Setting Switcher card — two values for one setting, and one switch that
// puts either of them on the engine while it plays.
//
// The controls are hand-rolled here for the reason the rest of the LIVE page's
// are (./View.js): a Field is bound to the staged/dirty/Apply model and none of
// that exists on this page. The two slot dropdowns take the SAME widget the
// setting's chain-card dropdown takes, so a filter keeps its tips, its stars and
// its narrowing here — it is the same list, reached a second way.
//
// Picking in a slot writes nothing. The switch is the only thing on the card
// that touches the engine, which is what makes the pick safe to change while
// something is playing.
import { html } from "../../lib/dom.js";
import {
  abRows,
  abTarget,
  abField,
  abSlots,
  abLit,
  abChain,
  setAbTarget,
  setAbSlot,
  flipAb,
} from "../../store/live/ab.js";
import { liveModel } from "../../store/live/model.js";
import { liveBusy, liveEnumBusy, liveErrors } from "../../store/live/state.js";
import { liveAbOpen } from "../../store/prefs.js";
import { RadioGroup, Segment } from "../controls/index.js";
import { widgetFor, tipsFor, badgeFor, starsFor, tierFor, collapseFor } from "../binder.js";
import { describe } from "../../store/prose.js";
import { Card } from "../common.js";
import { cardCollapse } from "./collapse.js";

/** @typedef {import("./View.js").LiveControl} LiveControl */

// The target's control on whichever chain it belongs to — the same object the
// chain card renders, so its list and its current value are the chain card's.
/** @returns {LiveControl | null} */
function targetControl() {
  const field = abField.value;
  if (!field) return null;
  const { pcmChain, sdmChain } = liveModel.value;
  return [...pcmChain, ...sdmChain].find((c) => c.field === field) || null;
}

// The name an ID carries in the list it was picked from. Stored beside the ID,
// so a slot can still say what it holds after the engine re-enumerates.
/**
 * @param {LiveControl} control
 * @param {string} id
 * @returns {string}
 */
function nameOf(control, id) {
  const listed = (control.optionsRaw || control.options || []).find((o) => String(o.value) === String(id));
  return listed ? String(listed.label) : String(id);
}

/** @param {{ side: "a" | "b", control: LiveControl }} props */
function Slot({ side, control }) {
  const W = widgetFor(control.entry);
  const meta = describe(control.entry, control.key);
  const slot = abSlots.value[side];
  const value = slot ? slot.id : "";
  const listed = (control.optionsRaw || control.options || []).some((o) => String(o.value) === value);
  return html`
    <div class="field ab-slot">
      <label>${side.toUpperCase()}</label>
      <div class="control">
        <${W}
          value=${value}
          options=${control.options}
          valueLabel=${slot && !listed ? slot.name : undefined}
          tips=${tipsFor(control.entry, meta)}
          badge=${badgeFor(control.entry)}
          stars=${starsFor(control.entry)}
          tier=${tierFor(control.entry)}
          collapse=${collapseFor(control.entry)}
          disabled=${liveEnumBusy.value}
          onChange=${(/** @type {string} */ v) => setAbSlot(side, v, nameOf(control, v))}
        />
      </div>
    </div>
  `;
}

// The switch. A side with nothing in it takes no click, and a side whose stored
// ID the current list no longer offers takes none either: the value it would
// write is gone, and writing an ID the engine has dropped is not a comparison.
// Neither side lit is the ordinary reading when the setting was last changed
// somewhere else.
/** @param {{ control: LiveControl }} props */
function Switch({ control }) {
  const { a, b } = abSlots.value;
  const lit = abLit.value;
  const offered = (/** @type {import("../../store/live/ab.js").AbSlot | null} */ slot) =>
    !!slot && (control.optionsRaw || control.options || []).some((o) => String(o.value) === String(slot.id));
  const busy = liveBusy.value === control.field || liveEnumBusy.value;
  return html`
    <div class="ab-switch seg-box">
      <${Segment}
        value=${lit}
        options=${[
          { value: "a", label: "A", disabled: busy || !offered(a) },
          { value: "b", label: "B", disabled: busy || !offered(b) },
        ]}
        onChange=${(/** @type {string} */ v) => flipAb(/** @type {"a" | "b"} */ (v))}
      />
    </div>
  `;
}

function AbBody() {
  const rows = abRows.value;
  const picked = abField.value;
  const control = targetControl();
  const error = control ? liveErrors.value[control.field] || "" : "";
  return html`
    <div class="ab-card">
      <div class="field ab-target">
        <label>Setting<span class="label-alt">Select the setting for fast switching.</span></label>
        <div class="control">
          <${RadioGroup}
            value=${picked}
            options=${rows.map((/** @type {import("../../store/live/ab.js").AbRow} */ r) => ({
              value: r.field,
              label: r.label,
            }))}
            onChange=${(/** @type {string} */ v) => setAbTarget(v)}
          />
        </div>
      </div>
      ${
        control
          ? html`
            <div class="ab-slots">
              <${Slot} side="a" control=${control} />
              <${Slot} side="b" control=${control} />
            </div>
            <${Switch} control=${control} />
          `
          : null
      }
      ${error ? html`<div class="live-error">${error}</div>` : null}
      <div class="field-note">Choose two settings to switch between with the A and B buttons.</div>
    </div>
  `;
}

/** The LIVE page's Setting Switcher card. */
export function AbCard() {
  // Read so the card re-renders when the loaded chain changes under it: the row
  // set and the stored pair both belong to the chain.
  abChain.value;
  abTarget.value;
  return html`
    <${Card} id="live-ab" title="Setting Switcher" collapse=${cardCollapse("ab", liveAbOpen)}>
      <${AbBody} />
    <//>
  `;
}
