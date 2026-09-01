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
import { html } from "../../lib/dom.js";
import { liveModel } from "../../store/live/model.js";
import { liveBusy, liveEnumBusy, liveErrors } from "../../store/live/state.js";
import { writeLive } from "../../store/live/write.js";
import { describe, selectedLabel } from "../../store/prose.js";
import { plainClosedLabel } from "../../store/plainnames.js";
import { notesVisible, descVisible, liveNarrowOpen, livePlaybackOpen, liveHealthOpen } from "../../store/prefs.js";
import { Segment, Checkbox } from "../controls/index.js";
import { widthClasses } from "../Field.js";
import {
  widgetFor,
  tipsFor,
  favFor,
  badgeFor,
  starsFor,
  tierFor,
  collapseFor,
  FavoriteError,
  DescBlock,
} from "../binder.js";
import { ChainPack } from "../ChainPack.js";
import { AutopilotToggle } from "../AutopilotToggle.js";
import { NarrowBar } from "../narrowbar/Bar.js";
import { EasyCard } from "../easy/EasyCard.js";
import { easyMode } from "../../store/easyview.js";
import { PlaybackVolumeBody } from "../volume/Playback.js";
import { EngineHealth } from "../EngineHealth.js";
import { LiveModeCard } from "./Presets.js";
import { LiveBlocks } from "./Layout.js";
import { MatrixProfileCard } from "./MatrixProfile.js";
import { cardCollapse } from "./collapse.js";
import { Section, Card, collapseFrom } from "../common.js";

/**
 * @typedef {import("../Field.js").FieldEntry} FieldEntry
 * @typedef {import("../Field.js").FieldMeta} FieldMeta
 * @typedef {import("../Field.js").NarrowBadge} NarrowBadge
 * @typedef {ReturnType<typeof widgetFor>} Widget
 *   Whatever Field.js's own widget pick resolves to — the LIVE page renders the
 *   identical control, so it takes the identical type.
 * @typedef {{
 *   field: string, key: string, entry: FieldEntry, value: string | number,
 *   options?: OptionItem[], optionsRaw?: OptionItem[], badge?: NarrowBadge | null,
 *   enumBacked?: boolean, disabled?: boolean, reason?: string,
 * }} LiveControl
 *   One control as store/live/model.js `liveModel` builds it: the live write's target
 *   field, the catalog entry it borrows its words from, the engine's current
 *   value, and the list it was chosen out of. The rate columns add `disabled`
 *   and `reason`; the enumeration-backed ones add `enumBacked`.
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
        ? html`<${DescBlock}
          entry=${entry}
          value=${control.value}
          options=${control.optionsRaw || control.options}
          meta=${meta}
        />`
        : null
    }
    ${showNote ? html`<div class="field-note">${meta.tooltip}</div>` : null}
  `;
}

// Hover carries the overall feature description for the controls that render a
// per-selection one instead, for the ones whose note is hover-only, and for
// everyone when the notes are toggled off — the same rule Field applies.
//
// A gray reason outranks all of that and replaces the tooltip outright, which is
// where this parts company with Field's own rule (Field.js hoverTitle: on a
// hoverNote field the tooltip wins and the reason only fills an empty hover).
// This page has one grayed control and it is disabled — what the setting does
// matters less than why it will not take an edit, and appending both puts the
// answer at the end of a paragraph.
const hoverTitle = (/** @type {FieldEntry} */ entry, /** @type {FieldMeta} */ meta, /** @type {string} */ reason) =>
  reason || (entry.desc || entry.hoverNote || !notesVisible.value ? meta.tooltip : "");

// One live control: the widget, its prose, why it is grayed
// if it is, and the reason the last write was refused. Disabled while its OWN
// write is in flight — two overlapping writes to one setting would resolve the
// second against lists the first has already invalidated — and, for a control
// whose options come from an enumeration, while ANY re-enumerating write is in
// flight (store/live/state.js `liveEnumBusy`): its list is the pre-write one for that
// whole window, so an ID picked out of it means something else by the time it
// lands. Both chain cards take edits whichever family is running. Nothing here
// is ever disabled for playing (CLAUDE.md).
//
// A gray reason rides the hover title and prints nowhere on the page
// (`quietGray`, store/schema.js), so hover costs the page nothing in any mode.
/** @param {{ entry: FieldEntry, meta: FieldMeta, badge: NarrowBadge | null | undefined }} props */
function LiveLabel({ entry, meta, badge }) {
  return html`
    <label>
      ${entry.label || meta.label}${entry.sublabel ? html`<span class="label-alt">${entry.sublabel}</span>` : null}
      ${badge ? html`<span class="narrow-count">${badge.n}/${badge.total}</span>` : null}
    </label>
  `;
}

// The label the closed control wears, read off the pre-narrow list the same way
// the tabs read theirs (Field.js valueLabel), routed through the simplified
// short name when the entry carries `plainNames`.
/** @param {LiveControl} control */
function closedLabel(control) {
  const label = selectedLabel(control.optionsRaw || control.options, control.value);
  return control.entry.plainNames ? plainClosedLabel(control.entry.plainNames, label) : label;
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
    <div
      class="field ${widthClasses(entry)}"
      data-k=${control.key}
      title=${hoverTitle(entry, meta, control.reason || "")}
    >
      <${LiveLabel} entry=${entry} meta=${meta} badge=${badge} />
      <div class="control">
        <${W}
          value=${control.value}
          options=${control.options}
          valueLabel=${closedLabel(control)}
          tips=${tipsFor(entry, meta)}
          fav=${fav}
          onFav=${onFav}
          badge=${badgeFor(entry)}
          stars=${starsFor(entry)}
          tier=${tierFor(entry)}
          collapse=${collapseFor(entry)}
          disabled=${busy || !!control.disabled}
          onChange=${(/** @type {string} */ v) => writeLive(control.field, v)}
        />
      </div>
      <${LiveProse} control=${control} meta=${meta} />
      ${error ? html`<div class="live-error">${error}</div>` : null}
      <${FavoriteError} entry=${entry} />
    </div>
  `;
}

// Both chains, as the Output tab's own pair of collapsibles: the card for
// the mode in use opens, the other collapses, and auto opens both because in
// auto both are reachable. A card the user toggles by hand wins until the mode
// changes, at which point the auto disclosure re-asserts — else a card closed in
// auto would stay shut after switching to the mode that needs it.
//
// The dormant card is NOT disabled. Its edits are held per chain and applied the
// moment that chain loads (lanes/live/routing.resolve_live, manager.reassert_chain),
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

// The narrow bar sits above the cards it narrows, as over the Output tab's filter
// cards. Source format is dropped: it opens a DSD Sources subsection these lack.
function ExpertChainCards() {
  const { chain, pcmChain, sdmChain } = liveModel.value;
  return html`
    <${NarrowBar} srcFormat=${false} collapse=${cardCollapse("narrow", liveNarrowOpen)} />
    <${Card} id="live-pcm-chain" title="PCM Chain" collapse=${collapseFrom(pcmOpen, pcmOverride)}>
      <${ChainBody} chain="pcm" loaded=${chain} controls=${pcmChain} />
    <//>
    <${Card} id="live-sdm-chain" title="SDM Chain" collapse=${collapseFrom(sdmOpen, sdmOverride)}>
      <${ChainBody} chain="sdm" loaded=${chain} controls=${sdmChain} />
    <//>
  `;
}

// Easy Mode stands in for all three, exactly as it does on the Output tab, and
// the group wrapper stays either way: it is this block's slot in the LIVE layout
// (./Layout.js), not decoration on the cards inside it.
function ChainCards() {
  return html`
    <div class="live-chain-group">
      ${easyMode.value ? html`<${EasyCard} lane="live" />` : html`<${ExpertChainCards} />`}
    </div>
  `;
}

// Mode leads this page as the same hero card that leads the Output tab — same
// frame, same centered title, same segment treatment, because it is the same
// master. The tab's other boxes have no live twin: changing backend rebuilds
// the audio path, and the rate limits are config fields with no live route, so
// both are restarts rather than live writes. .top-row divides itself between
// however many cards it holds, so a lone card takes the full row.
function HeroRow() {
  const { mode } = liveModel.value;
  return html`
    <div class="top-row">
      <${Card} id="live-output-mode" title="Mode" center=${true} cardClass="seg-box">
        <${LiveField} control=${mode} widget=${Segment} />
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
    <${Card} id="live-playback" title="Playback" collapse=${cardCollapse("playback", livePlaybackOpen)}>
      <div class="playback-cols">
        <div class="pack">
          <${LiveField} control=${adaptive} widget=${Checkbox} />
          <${LiveField} control=${junk} />
          <${AutopilotToggle} />
        </div>
        <span class="col-rule" aria-hidden="true"></span>
        <${PlaybackVolumeBody} showName=${true} />
      </div>
    <//>
  `;
}

// The same card the System tab carries, high on the page because on LIVE it is
// the instrument you judge a write by: change the filter and the
// needle is what tells you the engine took it. This card drops its "quick
// updates" checkbox here — LIVE polls at 1 s unconditionally (store/ui.js).
function HealthCard() {
  return html`
    <${Card} id="live-engine-health" title="Engine health" collapse=${cardCollapse("health", liveHealthOpen)}>
      <${EngineHealth} showQuick=${false} />
    <//>
  `;
}

/**
 * LIVE page: the locked LIVE MODE card, then the five movable blocks in the
 * user's own order (components/live/Layout.js). The keys are the stored order's
 * vocabulary — a key added here needs the same key in `LIVE_BLOCK_ORDER`
 * (store/prefs.js), which is what keeps a stored order from stranding a block.
 */
export function LiveView() {
  return html`
    <${Section}>
      <${LiveBlocks}
        locked=${html`<${LiveModeCard} />`}
        blocks=${{
          hero: html`<${HeroRow} />`,
          health: html`<${HealthCard} />`,
          chains: html`<${ChainCards} />`,
          playback: html`<${PlaybackCard} />`,
          matrix: html`<${MatrixProfileCard} />`,
        }}
      />
    <//>
  `;
}
