// The LIVE page's lede card: the page's one piece of its own prose, and beside
// it the live presets — named combos of the settings on that page, saved by
// HQPTuner rather than by the daemon (store/live/presets.js). Picking one applies
// it on the spot, like every other control there; there is no Apply on that page
// for it to wait for.
//
// The picker sits beside the lede rather than under it: both are about what LIVE
// is, and a preset is the fastest way to say "put the engine back the way I had
// it", which is the first thing a returning user wants.
//
// Filed apart from View.js because none of it touches the live write path —
// the presets lane speaks to /api/livepresets and to nothing on the page.
import { signal } from "@preact/signals";
import { html } from "../../lib/dom.js";
import {
  livePresets,
  livePresetsBusy,
  livePresetError,
  applyLivePreset,
  saveLivePreset,
  deleteLivePreset,
} from "../../store/live/presets.js";
import { askName, askConfirm } from "../../store/ask.js";
import { Ask } from "../Ask.js";
import { Combobox } from "../controls/Combobox.js";
import { liveEditing, setLiveEditing } from "./Layout.js";
import { Card } from "../common.js";

/**
 * @typedef {{ name: string }} LivePreset
 *   One saved live preset. /api/livepresets serves more per record (chain,
 *   fields, names, compatible) — this card only ever reads the name.
 */

const PRESET_OWNER = "livepresets";
const selectedPreset = signal("");

// Every preset is pickable whatever the engine is running. A preset carries its
// own output mode, so one taken on the other chain applies by switching to it —
// which is the point of saving it.
/** @param {LivePreset[]} presets */
function presetOptions(presets) {
  return [
    { value: "", label: presets.length ? "Select a preset…" : "No live presets saved" },
    ...presets.map((p) => ({ value: p.name, label: p.name })),
  ];
}

/** @param {string} name */
async function pickPreset(name) {
  selectedPreset.value = name;
  if (name) await applyLivePreset(name);
}

// Both questions are asked INLINE in the card (store/ask.js). Backing out of
// either — Escape, Cancel, or an empty name — writes nothing.
/** @param {LivePreset[]} presets */
async function onSavePreset(presets) {
  // askName resolves whatever the prompt collected (store/ask.js types that
  // `unknown`); a name prompt only ever settles a typed string or the cancel null.
  const name = /** @type {string | null} */ (
    await askName(PRESET_OWNER, "Save the engine's current live settings as:")
  );
  if (!name) return;
  const exists = presets.some((p) => p.name === name);
  if (exists && !(await askConfirm(PRESET_OWNER, `Live preset "${name}" already exists. Overwrite it?`))) return;
  await saveLivePreset(name);
  selectedPreset.value = name;
}

/** @param {string} name */
async function onDeletePreset(name) {
  if (!(await askConfirm(PRESET_OWNER, `Delete live preset "${name}"? This cannot be undone.`))) return;
  await deleteLivePreset(name);
  selectedPreset.value = "";
}

// A Combobox rather than a native select, for one reason: a native select fires
// no change event when the option already selected is picked again, and picking
// the current preset again is the card's most useful action — it is how a
// setting changed by hand is put back. The Combobox commits every pick.
function LivePresetPicker() {
  const presets = livePresets.value || [];
  const busy = !!livePresetsBusy.value;
  const name = selectedPreset.value;
  return html`
    <div class="field live-presets">
      <label>Live preset</label>
      <div class="control" data-testid="live-preset">
        <${Combobox} value=${name} options=${presetOptions(presets)} disabled=${busy} onChange=${pickPreset} />
      </div>
      <div class="live-preset-actions">
        <button type="button" onClick=${() => onSavePreset(presets)} disabled=${busy}>Save…</button>
        <button type="button" onClick=${() => onDeletePreset(name)} disabled=${busy || !name}>Delete</button>
      </div>
      <${Ask} owner=${PRESET_OWNER} />
      <div class="field-note">
        Live presets store everything on this page (except filter narrowing settings) for fast switching.
      </div>
      ${livePresetError.value ? html`<div class="live-error">${livePresetError.value}</div>` : null}
    </div>
  `;
}

/**
 * The LIVE page's lede and its presets, in one frame. Bare text floating above
 * the page reads as a stray caption rather than as the thing that explains the
 * whole page.
 */
export function LiveModeCard() {
  const editing = liveEditing.value;
  // The layout toggle rides the head of the card that is locked to the top of
  // the page, which is the one place on LIVE that is always in the same spot.
  // `title` takes markup (components/common.js), so it costs the card no row
  // and no height.
  const title = html`
    LIVE MODE
    <button
      type="button"
      class="live-edit-toggle"
      aria-pressed=${editing ? "true" : "false"}
      onClick=${() => setLiveEditing(!editing)}
    >
      Edit layout
    </button>
  `;
  return html`
    <${Card} id="live-mode" title=${title}>
      <div class="live-mode-cols">
        <${LivePresetPicker} />
        <span class="col-rule" aria-hidden="true"></span>
        <div class="live-mode-lede">
          <div class="t-caption">
            Every control on this page writes to the engine when you select it — no staging, no Apply. Music may be
            interrupted briefly while the engine reorients itself.
          </div>
          <div class="t-caption">
            Note that changing output mode and another setting too quickly may cause the engine to reset itself.
          </div>
        </div>
      </div>
    <//>
  `;
}
