// The LIVE page's lede card: the page's one piece of its own prose, and beside
// it the live presets — named combos of the settings on that page, saved by
// HQPTuner rather than by the daemon (store/live/presets.js). Picking one applies
// it on the spot, like every other control there; there is no Apply on that page
// for it to wait for.
//
// The lede rides the card head and the picker is the body: both are about what
// LIVE is, and a preset is the fastest way to say "put the engine back the way
// I had it", which is the first thing a returning user wants.
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
import { askChoices, askConfirm, question } from "../../store/ask.js";
import { api } from "../../lib/api.js";
import { errText } from "../../lib/errtext.js";
import { sdmReachableByDevice } from "../../store/narrow/devicecaps.js";
import { Ask } from "../Ask.js";
import { Combobox } from "../controls/Combobox.js";
import { liveEditing, setLiveEditing } from "./Layout.js";
import { Card } from "../common.js";

/**
 * @typedef {{ name: string, chain: string, fields: Record<string, string>, names?: Record<string, string>,
 *   autopilot?: boolean | null }} LivePreset
 *   One saved live preset as /api/livepresets serves it. `fields` is the stored
 *   batch; `names` each field's display name; `autopilot` null when the preset
 *   does not carry the switch.
 * @typedef {{ chain: string, fields: Record<string, { value: string, name: string }>, autopilot: boolean }} Snapshot
 *   What a save would store right now (/api/livepresets/snapshot).
 * @typedef {import("../controls/Combobox.js").TipContent} TipContent
 */

const PRESET_OWNER = "livepresets";
const AUTOPILOT = "autopilot";
const selectedPreset = signal("");

// The popover rows and the picker tip share one label per setting key, in the
// order the rows are listed. Not here: the HF filter, which follows the
// material the way volume does and is no preset's to fix; and output mode,
// which the backend stores beside any chain-scoped setting without asking.
/** @type {[string, string][]} */
const LABELS = [
  ["filter1x", "1x filter"],
  ["oversampling1x", "1x filter"],
  ["filter", "Nx filter"],
  ["oversampling", "Nx filter"],
  ["dither", "Dither"],
  ["modulator", "Modulator"],
  [AUTOPILOT, "HF auto-pilot"],
  ["adaptive_volume", "Adaptive volume"],
];

// A stored value in the words the LIVE page uses for it: the two switches as
// the schema's ON/OFF; everything else carries its enumeration name.
/**
 * @param {string} key
 * @param {string | boolean} value the stored value or its display name
 * @returns {string}
 */
function shown(key, value) {
  if (key === AUTOPILOT || key === "adaptive_volume") return value === true || value === "1" ? "ON" : "OFF";
  return String(value);
}

// One checkbox row per setting the engine reports, all checked.
/**
 * @param {Snapshot} snap
 * @returns {ChoiceOption[]}
 */
function choiceRows(snap) {
  /** @param {string} key */
  const detail = (key) => shown(key, key === AUTOPILOT ? snap.autopilot : snap.fields[key].name);
  return LABELS.filter(([key]) => key === AUTOPILOT || key in snap.fields).map(([key, label]) => ({
    value: key,
    label,
    checked: true,
    disabled: false,
    detail: detail(key),
  }));
}

// Why the device cannot play a preset, "" when it can. A preset that stores no
// output mode switches nothing, so there is nothing for the device to refuse;
// one that does is judged on the mode it would switch TO, not on whatever the
// engine happens to be running now. The answer comes from the same capability
// the LIVE page's own mode control already grays against
// (store/narrow/devicecaps.js).
const NO_MODE = "No support for this output mode from the current device.";

/**
 * @param {LivePreset} record
 * @returns {string}
 */
function unplayable(record) {
  const mode = record.fields.mode;
  if (mode !== "pcm" && mode !== "sdm") return "";
  if (mode === "sdm" && !sdmReachableByDevice()) return NO_MODE;
  return "";
}

// The picker's per-option tip: the settings the preset carries, with their
// values; a setting the preset omits is simply not listed. A preset the device
// cannot play leads with why — the row itself is grayed, and a gray row with no
// reason on it is the failure this whole path exists to stop.
/**
 * @param {LivePreset[]} presets
 * @returns {(o: { value: string | number }) => TipContent}
 */
const presetTips = (presets) => (o) => {
  const record = presets.find((p) => p.name === o.value);
  /** @type {TipContent} */
  const tip = { name: "", text: "", rows: [], chips: [] };
  if (!record) return tip;
  tip.text = unplayable(record);
  const names = record.names || {};
  for (const [key, label] of LABELS) {
    const value = key === AUTOPILOT ? record.autopilot : names[key] || record.fields[key];
    if (key === AUTOPILOT ? record.autopilot != null : key in record.fields) {
      tip.rows.push([key, label, shown(key, /** @type {string | boolean} */ (value)), []]);
    }
  }
  return tip;
};

// Which chain the engine is running never gates a preset: a preset carries its
// own output mode, so one taken on the other chain applies by switching to it,
// which is the point of saving it. The DEVICE does gate it. A preset holding a
// mode the open device cannot take applies as silence or as a dropped
// stream, and unlike every other control on this page the picker had no way to
// say so before the user picked it.
/** @param {LivePreset[]} presets */
function presetOptions(presets) {
  return [
    { value: "", label: presets.length ? "Select a preset…" : "No live presets saved" },
    ...presets.map((p) => ({ value: p.name, label: p.name, disabled: !!unplayable(p) })),
  ];
}

/** @param {string} name */
async function pickPreset(name) {
  selectedPreset.value = name;
  if (name) await applyLivePreset(name);
}

// Both questions are asked in the card (store/ask.js): the choices popover
// carries the name field and the setting rows, then the overwrite confirm.
// Backing out of either — Escape, Cancel, or an empty name — writes nothing.
// The rows come from the engine's snapshot; a snapshot the backend refuses
// (chain unknown) is the card's error, and no popover opens.
/** @param {LivePreset[]} presets */
async function onSavePreset(presets) {
  /** @type {Snapshot} */
  let snap;
  try {
    snap = await api.liveSnapshot();
  } catch (e) {
    livePresetError.value = errText(e);
    return;
  }
  // askChoices resolves whatever the prompt collected (store/ask.js types that
  // `unknown`); a named choices prompt settles {name, values} or the cancel null.
  const picked = /** @type {{ name: string, values: string[] } | null} */ (
    await askChoices(PRESET_OWNER, "Select the settings to attach to the new preset.", choiceRows(snap), {
      name: true,
    })
  );
  if (!picked) return;
  const { name, values } = picked;
  const exists = presets.some((p) => p.name === name);
  if (exists && !(await askConfirm(PRESET_OWNER, `Live preset "${name}" already exists. Overwrite it?`))) return;
  await saveLivePreset(name, values);
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
  // Locked while this card has a question open: the popover lives in the top
  // layer and the page under it stays clickable, so without this the picker
  // could apply a preset in the middle of saving one.
  const busy = !!livePresetsBusy.value || (!!question.value && question.value.owner === PRESET_OWNER);
  const name = selectedPreset.value;
  return html`
    <div class="field live-presets">
      <label>Live preset</label>
      <div class="control" data-testid="live-preset">
        <${Combobox}
          value=${name}
          options=${presetOptions(presets)}
          tips=${presetTips(presets)}
          disabled=${busy}
          onChange=${pickPreset}
        />
      </div>
      <div class="live-preset-actions">
        <button type="button" data-testid="live-preset-save" onClick=${() => onSavePreset(presets)} disabled=${busy}>
          Save…
        </button>
        <button type="button" onClick=${() => onDeletePreset(name)} disabled=${busy || !name}>Delete</button>
      </div>
      <${Ask} owner=${PRESET_OWNER} />
      <div class="field-note">
        Live presets optionally store everything on this page (except filter narrowing settings) for fast switching.
      </div>
      ${livePresetError.value ? html`<div class="live-error">${livePresetError.value}</div>` : null}
    </div>
  `;
}

/**
 * The LIVE page's lede and its presets, in one frame. Bare text floating above
 * the page reads as a stray caption rather than as the thing that explains the
 * whole page. The lede rides the card head as its subtitle and the picker is
 * the body; the Mode card sits beside this one in the locked row
 * (components/live/View.js LockedRow).
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
  const lede = html`Every control on this page writes to the engine when you select it — no staging, no Apply. Music
    may be interrupted briefly while the engine reorients itself. Note that changing output mode and another setting
    too quickly may cause the engine to reset itself.`;
  return html`
    <${Card} id="live-mode" title=${title} subtitle=${lede}>
      <${LivePresetPicker} />
    <//>
  `;
}
