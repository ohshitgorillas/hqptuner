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
import { liveModel, liveBusy, liveErrors, liveReloading, writeLive } from "../store/live.js";
import { describe, selectionDescription } from "../store/prose.js";
import { notesVisible, descVisible } from "../store/prefs.js";
import { stagedCount, refreshConfig } from "../store/state.js";
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
import { NarrowBar } from "./NarrowBar.js";
import { ApodNarrow } from "./ApodNarrow.js";
import { PlaybackVolume } from "./PlaybackVolume.js";
import { EngineHealth } from "./EngineHealth.js";
import { Section, Card, collapseFrom } from "./tabs/common.js";

const CHAIN_LABEL = { pcm: "PCM", sdm: "SDM" };

// The prose under a live control, in the tabs' own reading order: the manual's
// description of what is selected right now, then the control's feature note.
// Both come from the catalog (store/prose.js), both obey the same header
// toggles, and neither is written here — a control says the same thing on this
// page as it does on its tab.
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
// everyone when the notes are toggled off — the same rule Field applies, minus
// the gray reason, which is a staged-value concept this page has no equivalent of.
const hoverTitle = (entry, meta) => (entry.desc || entry.hoverNote || !notesVisible.value ? meta.tooltip : "");

// One live control: the widget, its in-flight mark, its prose, and the reason
// the last write was refused. Disabled while its OWN write is in flight — two
// overlapping writes to one setting would resolve the second against lists the
// first has already invalidated — or when the control carries no live setting at
// all: the rate column for the family the engine is not running is the tab's
// grayed column, showing the configured default (store/live.js). Nothing here is
// ever disabled for playing (CLAUDE.md).
function LiveField({ control, widget }) {
  const W = widget || Dropdown;
  const { entry } = control;
  const meta = describe(entry, control.key);
  const busy = liveBusy.value === control.field;
  const error = liveErrors.value[control.field] || "";
  return html`
    <div class="field" title=${hoverTitle(entry, meta)}>
      <label>
        ${entry.label || meta.label}${entry.sublabel ? html`<span class="label-alt">${entry.sublabel}</span>` : null}
      </label>
      <div class="control">
        <${W}
          value=${control.value}
          options=${control.options}
          disabled=${busy || !!control.disabled}
          onChange=${(v) => writeLive(control.field, v)}
        />
        ${busy ? html`<span class="t-micro">writing…</span>` : null}
      </div>
      <${LiveProse} control=${control} meta=${meta} />
      ${entry.apodNarrow ? html`<${ApodNarrow} field=${control.key} />` : null}
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

// No previous-value guard, unlike the Resampling twin: this reads one computed
// rather than the whole staged map, and a computed notifies only when its value
// actually changes — so an unrelated live write cannot slam a card shut here.
effect(() => {
  liveModel.value.mode.value;
  pcmOverride.value = null;
  sdmOverride.value = null;
});

// What the card for a chain that is not loaded says: the edit is real, it is
// simply not what is playing yet.
function heldNote(chain, loaded) {
  const mine = CHAIN_LABEL[chain];
  if (loaded) return `The engine is running ${CHAIN_LABEL[loaded]}. Changes here apply when the ${mine} chain loads.`;
  return `The engine follows the source in auto mode, so no chain is loaded yet. Changes here apply when the ${mine} chain does.`;
}

function ChainBody({ chain, loaded, controls }) {
  const live = chain === loaded;
  return html`
    ${live && liveReloading.value ? html`<div class="section-note">Reloading the engine's lists…</div>` : null}
    ${live ? null : html`<div class="section-note">${heldNote(chain, loaded)}</div>`}
    <div class="pack chain">${controls.map((c) => html`<${LiveField} control=${c} />`)}</div>
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
          <${LiveField} control=${pcmRate} />
          <${LiveField} control=${sdmRate} />
        </div>
      <//>
    </div>
  `;
}

function ProcessingCard() {
  const { junk, adaptive } = liveModel.value;
  return html`
    <${Card} title="Processing">
      <div class="pack">
        <${LiveField} control=${junk} />
        <${LiveField} control=${adaptive} widget=${Checkbox} />
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
          ${profileBusy.value ? html`<span class="t-micro">switching…</span>` : null}
        </div>
        <div class="field-note">
          Switches the running matrix immediately — no engine reload, and your crossfeed, DAC correction and loudness
          settings are left alone. A live switch alone is dropped at the next daemon restart; save it from the DSP tab
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
function presetOptions(presets) {
  return [
    { value: "", label: presets.length ? "Select a preset…" : "No live presets saved" },
    ...presets.map((p) => ({ value: p.name, label: p.name })),
  ];
}

async function pickPreset(name) {
  selectedPreset.value = name;
  if (name) await applyLivePreset(name);
}

// Both questions are asked INLINE in the card (store/ask.js). Backing out of
// either — Escape, Cancel, or an empty name — writes nothing.
async function onSavePreset(presets) {
  const name = await askName(PRESET_OWNER, "Save the engine's current live settings as:");
  if (!name) return;
  const exists = presets.some((p) => p.name === name);
  if (exists && !(await askConfirm(PRESET_OWNER, `Live preset "${name}" already exists. Overwrite it?`))) return;
  await saveLivePreset(name);
  selectedPreset.value = name;
}

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
        ${busy ? html`<span class="t-micro">working…</span>` : null}
      </div>
      <div class="live-preset-actions">
        <button type="button" onClick=${() => onSavePreset(presets)} disabled=${busy}>Save…</button>
        <button type="button" onClick=${() => onDeletePreset(name)} disabled=${busy || !name}>Delete</button>
      </div>
      <${Ask} owner=${PRESET_OWNER} />
      <div class="field-note">
        Saves what the engine is running right now: output mode, both filters, the dither or modulator, the
        high-frequency filter, adaptive volume and the rate. Picking one puts all of it back, switching the output mode
        first if it has to — which can interrupt playback, like every other control here.
      </div>
      ${livePresetError.value ? html`<div class="live-error">${livePresetError.value}</div>` : null}
    </div>
  `;
}

// The page's lede and its presets, in one frame. The lede used to float above
// the page as bare text with no card of its own, which read as a stray caption
// rather than as the thing that explains the whole page.
function LiveModeCard() {
  return html`
    <${Card} title="LIVE MODE">
      <div class="live-mode-cols">
        <${LivePresetPicker} />
        <span class="col-rule" aria-hidden="true"></span>
        <div class="live-mode-lede">
          <div class="t-caption">
            Nothing on this page is saved. Every control writes to the running engine the moment you change it — no
            Apply, and nothing waits for playback to stop — and what it writes lasts until the daemon next restarts,
            including the restart an Apply in the tabs view performs. After that the engine is back to its configured
            settings.
          </div>
          <div class="t-caption">
            Live presets are this page's own: they hold what the engine is playing, not a configuration. The presets in
            the header are whole settings files and restart the daemon; the matrix profiles further down are a
            different thing again.
          </div>
        </div>
      </div>
    <//>
  `;
}

// The tabs view's staged edits are none of this page's business, but leaving
// them invisible is how a user forgets an Apply is still owed. Informational
// only: LIVE never flushes the pending buffer and never blocks on it.
function StagedChip() {
  const n = stagedCount.value;
  if (!n) return null;
  return html`<div class="live-chip">${n} staged change${n === 1 ? "" : "s"} waiting in the tabs view</div>`;
}

export function LiveView() {
  return html`
    <${Section}>
      <${StagedChip} />
      <${LiveModeCard} />
      <${HeroRow} />
      <!-- The same card the System tab carries, second on the page because on
           LIVE it is the instrument you judge a write by: change the rate or the
           filter and the needle is what tells you the engine took it. Both this
           and PlaybackVolume drop their "quick updates" checkbox here — LIVE
           polls at 500 ms unconditionally (store/ui.js). -->
      <${Card} title="Engine health">
        <${EngineHealth} showQuick=${false} />
      <//>
      <${ChainCards} />
      <${ProcessingCard} />
      <${PlaybackVolume} showQuick=${false} />
      <${MatrixProfileCard} />
    <//>
  `;
}
