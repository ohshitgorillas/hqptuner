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
import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import { api } from "../lib/api.js";
import { liveModel, liveBusy, liveErrors, liveReloading, writeLive } from "../store/live.js";
import { describe, selectionDescription } from "../store/prose.js";
import { notesVisible, descVisible } from "../store/prefs.js";
import { stagedCount, refreshConfig } from "../store/state.js";
import { savedProfiles, matrixActiveProfile, isLiveProfile } from "../store/profiles.js";
import { Segment, Dropdown, Checkbox } from "./controls/index.js";
import { NarrowBar } from "./NarrowBar.js";
import { ApodNarrow } from "./ApodNarrow.js";
import { PlaybackVolume } from "./PlaybackVolume.js";
import { Section, Card } from "./tabs/common.js";

const CHAIN_TITLE = { pcm: "PCM chain", sdm: "SDM chain" };

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

// The chain card. Which chain is loaded decides which three controls exist at
// all, and in auto mode before playback starts neither chain is knowably the
// live one — so the card says so rather than guessing one (livemap.active_chain
// answers null there, and the backend would refuse the write anyway).
function ChainCard() {
  const { chain, chainControls } = liveModel.value;
  if (!chain) {
    return html`
      <${Card} title="Filters">
        <div class="section-note">
          Auto mode — the engine follows the source, so which filter chain is loaded is not known until playback
          starts. These controls appear once it does.
        </div>
      <//>
    `;
  }
  // The narrow bar sits above the card it narrows, exactly as it does over the
  // Resampling tab's filter cards — and only when a chain is loaded, since with
  // no filter dropdowns on the page there is nothing for it to act on.
  return html`
    <${NarrowBar} />
    <${Card} title=${CHAIN_TITLE[chain]}>
      ${liveReloading.value ? html`<div class="section-note">Reloading the engine's lists…</div>` : null}
      <div class="pack chain">${chainControls.map((c) => html`<${LiveField} control=${c} />`)}</div>
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
      <div class="t-caption">
        Nothing on this page is saved. Every control writes to the running engine the moment you change it — no Apply,
        and nothing waits for playback to stop — and what it writes lasts until the daemon next restarts, including the
        restart an Apply in the tabs view performs. After that the engine is back to its configured settings.
      </div>
      <${HeroRow} />
      <${ChainCard} />
      <${ProcessingCard} />
      <${PlaybackVolume} />
      <${MatrixProfileCard} />
    <//>
  `;
}
