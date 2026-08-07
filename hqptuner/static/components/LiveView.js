// The LIVE page — one page of only the settings the engine can change right now,
// each written the moment it is changed. No staging, no Apply, and no control on
// it is ever refused because playback is running: what a live change costs
// mid-stream is the user's to spend, so the lede names the cost and the click
// does the thing (CLAUDE.md).
//
// That lede is the page's one piece of its own prose, and it is page-wide on
// purpose: every control here writes the same way and lasts the same length of
// time, so saying it once at the top beats repeating a variant of it under each
// control. Everything else a control says comes from the catalog the tabs read
// (store/prose.js) — same knob, same words.
//
// The controls are hand-rolled rather than `Field`s on purpose. A Field is bound
// to the staged/dirty/Apply model — effective(), edit(), the dirty highlight —
// and none of that exists here: the value a LIVE control shows is what the engine
// reported back after the write, and its only state is "writing" or "this is why
// it was refused".
import { signal, computed, effect } from "@preact/signals";
import { html } from "../lib/dom.js";
import { api } from "../lib/api.js";
import { liveModel } from "../store/live/model.js";
import { liveBusy, liveEnumBusy, liveErrors } from "../store/live/state.js";
import { writeLive } from "../store/live/write.js";
import { describe, selectionDescription } from "../store/prose.js";
import { notesVisible, descVisible } from "../store/prefs.js";
import { refreshConfig } from "../store/sync.js";
import { savedProfiles, matrixActiveProfile, isLiveProfile } from "../store/profiles.js";
import {
  livePresets,
  livePresetsBusy,
  livePresetError,
  applyLivePreset,
  saveLivePreset,
  deleteLivePreset,
} from "../store/livepresets.js";
import { askName, askConfirm } from "../store/ask.js";
import { Ask } from "./Ask.js";
import { Segment, Dropdown, Checkbox } from "./controls/index.js";
import { widgetFor, tipsFor, favFor } from "./Field.js";
import { ChainPack } from "./ChainPack.js";
import { NarrowBar } from "./NarrowBar.js";
import { PlaybackVolumeBody } from "./PlaybackVolume.js";
import { EngineHealth } from "./EngineHealth.js";
import { Section, Card, collapseFrom } from "./common.js";

/**
 * @typedef {import("./Field.js").FieldEntry} FieldEntry
 * @typedef {import("./Field.js").FieldMeta} FieldMeta
 * @typedef {import("./Field.js").NarrowBadge} NarrowBadge
 * @typedef {ReturnType<typeof widgetFor>} Widget
 *   Whatever Field.js's own widget pick resolves to — the LIVE page renders the
 *   identical control, so it takes the identical type.
 * @typedef {{
 *   field: string, key: string, entry: FieldEntry, value: string | number,
 *   options?: OptionItem[], badge?: NarrowBadge | null,
 *   enumBacked?: boolean, disabled?: boolean, reason?: string,
 * }} LiveControl
 *   One control as store/live/model.js `liveModel` builds it: the live write's target
 *   field, the catalog entry it borrows its words from, the engine's current
 *   value, and the list it was chosen out of. The rate columns add `disabled`
 *   and `reason`; the enumeration-backed ones add `enumBacked`.
 * @typedef {{ name: string }} LivePreset
 *   One saved live preset. /api/livepresets serves more per record (chain,
 *   fields, names, compatible) — this page only ever reads the name.
 */

const CHAIN_LABEL = { pcm: "PCM", sdm: "SDM" };

// The prose under a live control, in the tabs' own reading order: the manual's
// description of what is selected right now, then the control's feature note.
// Both come from the catalog (store/prose.js), both obey the same header
// toggles, and neither is written here — a control says the same thing on this
// page as it does on its tab.
/** @param {{ control: LiveControl, meta: FieldMeta }} props */
function LiveProse({ control, meta }) {
  const { entry } = control;
  const showDesc = entry.desc && descVisible.value;
  const showNote = !entry.desc && !entry.hoverNote && meta.tooltip && notesVisible.value;
  return html`
    ${
      showDesc
        ? html`<div class="field-desc">${selectionDescription(entry, control.value, control.options, meta)}</div>`
        : null
    }
    ${showNote ? html`<div class="field-note">${meta.tooltip}</div>` : null}
  `;
}

// Hover carries the overall feature description for the controls that render a
// per-selection one instead, for the ones whose note is hover-only, and for
// everyone when the notes are toggled off — the same rule Field applies.
const hoverTitle = (/** @type {FieldEntry} */ entry, /** @type {FieldMeta} */ meta) =>
  entry.desc || entry.hoverNote || !notesVisible.value ? meta.tooltip : "";

// One live control: the widget, its prose, why it is grayed
// if it is, and the reason the last write was refused. Disabled while its OWN
// write is in flight — two overlapping writes to one setting would resolve the
// second against lists the first has already invalidated — and, for a control
// whose options come from an enumeration, while ANY re-enumerating write is in
// flight (store/live/state.js `liveEnumBusy`): its list is the pre-write one for that
// whole window, so an ID picked out of it means something else by the time it
// lands. Otherwise only where the engine has no live route for the setting at
// all, which is the rate pair in auto and nothing else (`AUTO_RATE_REASON`). Both chain
// cards and, under an explicit mode, both rate columns take edits whichever
// family is running, the dormant side's being held and landing when that family
// loads (lanes/livemap.unpinnable_rate). Nothing here is ever disabled for
// playing (CLAUDE.md).
//
// A grayed control ALWAYS carries its reason, never quietly — `quietGray` is the
// tabs' answer to a caption that reflows the row as the mode changes, and this
// page's one gray reason is fixed text shown in one mode only. It is not
// rendered HERE, though: the rate pair grays as a PAIR, both columns carrying
// the identical sentence, so the caption belongs to the card that holds them
// both and `HeroRow` prints it once. A control that ever grays on its own would
// need its own render; none does today.
/** @param {{ entry: FieldEntry, meta: FieldMeta, badge: NarrowBadge | null | undefined }} props */
function LiveLabel({ entry, meta, badge }) {
  return html`
    <label>
      ${entry.label || meta.label}${entry.sublabel ? html`<span class="label-alt">${entry.sublabel}</span>` : null}
      ${badge ? html`<span class="narrow-count">${badge.n}/${badge.total}</span>` : null}
    </label>
  `;
}

/** @param {{ control: LiveControl, widget?: Widget }} props */
function LiveField({ control, widget }) {
  const { entry } = control;
  // Same widget pick as the tabs (Field.js widgetFor): a desc-carrying dropdown
  // is the tip-showing combobox on this page too — same knob, same words.
  const W = widget || widgetFor(entry);
  const meta = describe(entry, control.key);
  const busy = liveBusy.value === control.field || (control.enumBacked && liveEnumBusy.value);
  const error = liveErrors.value[control.field] || "";
  const badge = control.badge;
  const { fav, onFav } = favFor(entry) || {};
  return html`
    <div class="field" title=${hoverTitle(entry, meta)}>
      <${LiveLabel} entry=${entry} meta=${meta} badge=${badge} />
      <div class="control">
        <${W}
          value=${control.value}
          options=${control.options}
          tips=${tipsFor(entry, meta)}
          fav=${fav}
          onFav=${onFav}
          disabled=${busy || !!control.disabled}
          onChange=${(/** @type {string} */ v) => writeLive(control.field, v)}
        />
      </div>
      <${LiveProse} control=${control} meta=${meta} />
      ${error ? html`<div class="live-error">${error}</div>` : null}
    </div>
  `;
}

// Both chains, as the Resampling tab's own pair of collapsibles: the card for
// the mode in use opens, the other collapses, and auto opens both because in
// auto both are reachable. A card the user toggles by hand wins until the mode
// changes, at which point the auto disclosure re-asserts — else a card closed in
// auto would stay shut after switching to the mode that needs it.
//
// The dormant card is NOT disabled. Its edits are held per chain and applied the
// moment that chain loads (lanes/livemap.resolve_live, manager.reassert_chain),
// so setting up the SDM chain while PCM is playing is an ordinary thing to do
// here. This is also what makes auto mode work: neither chain is loaded before
// playback starts, and rather than hiding the controls behind a note until it
// does, both cards take edits and the engine collects them when it picks a chain.
const pcmOpen = computed(() => liveModel.value.mode.value !== "sdm");
const sdmOpen = computed(() => liveModel.value.mode.value !== "pcm");
const pcmOverride = signal(null);
const sdmOverride = signal(null);

// The mode as its own computed, and that is the whole point of it: `liveModel` is
// rebuilt into a FRESH object on every poll (store/live/model.js), signals compare by
// identity, so an effect reading `liveModel.value.mode.value` depends on the poll
// rather than on the mode — `mode` is a plain property, not a signal, and reading
// it subscribes to nothing. That is what dropped the overrides once a second and
// snapped a card the user had just opened straight back shut. A computed over a
// STRING settles: equal value, no notification.
const liveModeValue = computed(() => liveModel.value.mode.value);
effect(() => {
  liveModeValue.value;
  pcmOverride.value = null;
  sdmOverride.value = null;
});

// What the card for a chain that is not loaded says: the edit is real, it is
// simply not what is playing yet.
/**
 * @param {string} chain the card's own family, "pcm" or "sdm"
 * @param {string | null} loaded the family the engine is running, null in auto before playback
 * @returns {string}
 */
function heldNote(chain, loaded) {
  const labels = /** @type {Record<string, string>} */ (CHAIN_LABEL);
  const mine = labels[chain];
  if (loaded) return `The engine is running ${labels[loaded]}. Changes here apply when the ${mine} chain loads.`;
  return `The engine follows the source in auto mode, so no chain is loaded yet. Changes here apply when the ${mine} chain does.`;
}

/** @param {{ chain: string, loaded: string | null, controls: LiveControl[] }} props */
function ChainBody({ chain, loaded, controls }) {
  const live = chain === loaded;
  return html`
    ${live ? null : html`<div class="section-note">${heldNote(chain, loaded)}</div>`}
    <${ChainPack}>${controls.map((c) => html`<${LiveField} control=${c} />`)}<//>
  `;
}

// The narrow bar sits above the cards it narrows, exactly as it does over the
// Resampling tab's filter cards.
function ChainCards() {
  const { chain, pcmChain, sdmChain } = liveModel.value;
  return html`
    <${NarrowBar} />
    <${Card} title="PCM Chain" collapse=${collapseFrom(pcmOpen, pcmOverride)}>
      <${ChainBody} chain="pcm" loaded=${chain} controls=${pcmChain} />
    <//>
    <${Card} title="SDM Chain" collapse=${collapseFrom(sdmOpen, sdmOverride)}>
      <${ChainBody} chain="sdm" loaded=${chain} controls=${sdmChain} />
    <//>
  `;
}

// Mode and Rate lead this page as the same hero cards that lead the Output tab —
// same frame, same centred title, same segment and rate-stack treatment, because
// they are the same two masters. The tab's third box, Backend, has no live twin:
// changing backend rebuilds the audio path, which is a restart rather than a
// live write. .top-row divides itself between however many cards it holds, so
// the pair takes half the row each with no width rule of its own.
function HeroRow() {
  const { mode, pcmRate, sdmRate } = liveModel.value;
  return html`
    <div class="top-row">
      <${Card} title="Mode" center=${true} cardClass="seg-box">
        <${LiveField} control=${mode} widget=${Segment} />
      <//>
      <${Card} title="Rate" center=${true}>
        <div class="rate-stack">
          <${LiveField} control=${pcmRate} quietReason=${true} />
          <${LiveField} control=${sdmRate} quietReason=${true} />
        </div>
        ${
          pcmRate.reason || sdmRate.reason
            ? html`<div class="field-gray-reason rate-gray">${pcmRate.reason || sdmRate.reason}</div>`
            : null
        }
      <//>
    </div>
  `;
}

// Everything about how loud the engine plays, in one card: the two live
// settings that shape the level on the left, the master volume on the right.
//
// The dial comes in as PlaybackVolumeBody, not as the Volume tab's whole card —
// a card inside a card is a frame nobody asked for, and the volume-disabled
// state belongs to that column alone. Adaptive volume and the high-frequency
// filter stay live whatever the engine is doing to the volume control: the junk
// filter is switchable during playback (manual §2.8) and is never grayed.
function PlaybackCard() {
  const { junk, adaptive } = liveModel.value;
  return html`
    <${Card} title="Playback">
      <div class="playback-cols">
        <div class="pack">
          <${LiveField} control=${adaptive} widget=${Checkbox} />
          <${LiveField} control=${junk} />
        </div>
        <span class="col-rule" aria-hidden="true"></span>
        <${PlaybackVolumeBody} showQuick=${false} showName=${true} />
      </div>
    <//>
  `;
}

// The matrix profile picker is its own lane: MatrixSetProfile is a live 4321
// switch, not a config field, so it never goes through POST /api/config/live. It
// also never stages here — the tabs view's card is where a profile is saved to
// the configuration; this one only switches the running matrix. A profile saved
// in this session and not applied yet is therefore unreachable: the daemon knows
// only the profiles it read at startup.
const profileBusy = signal(false);
const profileError = signal("");

/** @param {string} name */
async function switchProfile(name) {
  profileBusy.value = true;
  profileError.value = "";
  try {
    await api.matrixProfile("switch", name);
    await refreshConfig();
  } catch (e) {
    profileError.value = e.message;
  } finally {
    profileBusy.value = false;
  }
}

/** @param {string[]} saved */
function profileOptions(saved) {
  return [
    { value: "", label: "[Default]" },
    ...saved.map((n) => ({
      value: n,
      label: n,
      disabled: !isLiveProfile(n),
      reason: isLiveProfile(n) ? "" : "not loaded by the engine",
    })),
  ];
}

function MatrixProfileCard() {
  const active = matrixActiveProfile.value;
  return html`
    <${Card} title="Matrix profile">
      <div class="field">
        <label>Profile</label>
        <div class="control">
          <${Dropdown}
            value=${active === "[Default]" ? "" : active}
            options=${profileOptions(savedProfiles.value)}
            disabled=${profileBusy.value}
            onChange=${switchProfile}
          />
        </div>
        <div class="field-note">
          Switches the running matrix immediately — no engine reload, and your crossfeed, DAC correction and loudness
          settings are left alone. A live switch alone is dropped at the next daemon restart; save it from the Matrix tab
          to keep it.
        </div>
        ${profileError.value ? html`<div class="live-error">${profileError.value}</div>` : null}
      </div>
    <//>
  `;
}

// --- live presets ------------------------------------------------------------
// Named combos of the settings on this page, saved by HQPTuner rather than by
// the daemon (store/livepresets.js). Picking one applies it on the spot, like
// every other control here — there is no Apply on this page for it to wait for.
//
// The picker deliberately sits beside the page's lede rather than under it: both
// are about what LIVE is, and a preset is the fastest way to say "put the engine
// back the way I had it", which is the first thing a returning user wants.
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

function LivePresetPicker() {
  const presets = livePresets.value || [];
  const busy = !!livePresetsBusy.value;
  const name = selectedPreset.value;
  return html`
    <div class="field live-presets">
      <label>Live preset</label>
      <div class="control">
        <${Dropdown} value=${name} options=${presetOptions(presets)} disabled=${busy} onChange=${pickPreset} />
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

// The page's lede and its presets, in one frame. Bare text floating above the
// page reads as a stray caption rather than as the thing that explains the
// whole page.
function LiveModeCard() {
  return html`
    <${Card} title="LIVE MODE">
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

export function LiveView() {
  return html`
    <${Section}>
      <${LiveModeCard} />
      <${HeroRow} />
      <!-- The same card the System tab carries, second on the page because on
           LIVE it is the instrument you judge a write by: change the rate or the
           filter and the needle is what tells you the engine took it. Both this
           and the volume dial drop their "quick updates" checkbox here — LIVE
           polls at 500 ms unconditionally (store/ui.js). -->
      <${Card} title="Engine health">
        <${EngineHealth} showQuick=${false} />
      <//>
      <${ChainCards} />
      <${PlaybackCard} />
      <${MatrixProfileCard} />
    <//>
  `;
}
