// Filter narrowing bar — a card ABOVE the PCM/SDM filter cards, holding the
// genre / quality / focus / phase / length / ratio facets (all multi- or
// single-select popovers) on one row, and the per-stage apodizing / hi-res
// segmented switches on a second row (global across PCM and SDM, separate for
// 1x and Nx — user decision). Presentational only.
//
// It is a real `Card`, not a panel of its own: painting the card frame itself —
// card surface, card radius, a hand-rolled heading — under its own class name
// is how a panel drifts to the wrong border token and a doubled bottom margin
// without any gate noticing. A card that reads as a card IS a Card
// (docs/design-system.md).
import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { html } from "../lib/dom.js";
import { effective } from "../store/resolve.js";
import { optionsFor } from "../store/options.js";
import { metadata } from "../store/signals.js";
import { Card } from "./tabs/common.js";
import { Segment } from "./controls/index.js";
import {
  nGenre,
  nQuality,
  nFocus,
  nPhase,
  nLength,
  nRatio,
  nUpsampleOnly,
  nFavOnly,
  nApod1x,
  nApodNx,
  nHires1x,
  nHiresNx,
  narrowingActive,
  resetNarrowing,
  previewCount,
} from "../store/narrowing.js";
import { favoriteFilters } from "../store/favorites.js";

const GENRES = [
  ["pop", "Pop"],
  ["rock", "Rock"],
  ["jazz", "Jazz"],
  ["blues", "Blues"],
  ["classical", "Classical"],
  ["electronic", "Electronic"],
  // the manual's genre-agnostic tag — a real facet value ("this filter suits
  // ALL genres"), distinct from the empty selection the button calls "Any
  // genre", which means "not narrowed by genre at all"
  ["any", "All genres"],
];
const QUALITY = [
  [0, "Any quality"],
  [3, "Quality ≥ 3"],
  [4, "Quality ≥ 4"],
  [5, "Quality 5"],
];
const FOCUS = [
  ["transients", "Transients"],
  ["timbre", "Timbre"],
  ["space", "Space"],
];
const PHASES = [
  ["", "Any phase"],
  ["linear", "Linear"],
  ["minimum", "Minimum"],
  ["intermediate", "Intermediate"],
];
const LENGTHS = [
  ["", "Any length"],
  ["short", "Short"],
  ["medium", "Medium"],
  ["long", "Long"],
  ["xlong", "Extra long"],
];
// The manual's own "any" ratio class is an escape hatch, not a pick: a filter it
// marks any-ratio survives every ratio selection. The "" row here is the
// separate "not narrowed by ratio at all". Upsample-only ("up" in the manual)
// rides in the popover as an extra checkbox.
const RATIOS = [
  ["", "Any ratio"],
  ["integer", "Integer"],
  ["2x", "2x"],
  ["1:1", "1:1"],
];

const focusOpen = signal(false);
const genreOpen = signal(false);
const qualityOpen = signal(false);
const phaseOpen = signal(false);
const lengthOpen = signal(false);
const ratioOpen = signal(false);

// Every popover, keyed by the `data-multi` its wrapper carries. A pointerdown
// anywhere on the page closes each one whose own wrapper wasn't the target —
// clicking the page, or another facet's button, retracts what's open.
const POPOVERS = {
  genre: genreOpen,
  quality: qualityOpen,
  focus: focusOpen,
  phase: phaseOpen,
  length: lengthOpen,
  ratio: ratioOpen,
};

function closeExcept(target) {
  const box = target && target.closest ? target.closest(".multi") : null;
  const keep = box ? box.dataset.multi : null;
  for (const [name, sig] of Object.entries(POPOVERS)) {
    if (name !== keep && sig.value) sig.value = false;
  }
}

// toggle a value in a multi-select signal (add if absent, remove if present)
function toggleIn(sig, v) {
  const cur = sig.value;
  sig.value = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
}

function focusLabel() {
  const sel = nFocus.value;
  if (!sel.length) return "Any focus";
  if (sel.length === 1) return (FOCUS.find(([v]) => v === sel[0]) || [])[1];
  return `${sel.length} focuses`;
}

function genreLabel() {
  const sel = nGenre.value;
  if (!sel.length) return "Any genre";
  if (sel.length === 1) return oneLabel(GENRES, sel[0], sel[0]);
  return `${sel.length} genres`;
}

// The ratio button also reports the upsample-only extra: "Integer", "Upsample
// only", or "Integer + upsample-only" when both are set.
function ratioLabel() {
  const sel = nRatio.value;
  const parts = [];
  if (sel) parts.push(oneLabel(RATIOS, sel, sel));
  if (nUpsampleOnly.value) parts.push("upsample-only");
  if (!parts.length) return "Any ratio";
  return parts.join(" + ");
}

const oneLabel = (items, v, fallback) => (items.find(([iv]) => String(iv) === String(v)) || [null, fallback])[1];

// The selection a click on this row would PRODUCE: picked values drop out,
// unpicked ones join. Same transform `toggleIn` performs, so the count a row
// shows is the count the click actually lands on — an already-picked row
// previews its own removal, not the state it is already in.
const toggleVal = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

// Per-option result counts hang off the ACTIVE chain only (user decision): PCM
// unless the output mode is SDM. The two numbers are that chain's 1x / Nx list
// sizes for the selection CLICKING THAT ROW WOULD PRODUCE — so with Transients
// already on, the Space row reads how many filters carry both. Reads each
// dropdown's own field key so the preview honours that chain's apod / hi-res
// toggles too.
function chainCounts(overrides) {
  const sdm = effective("output_mode") === "sdm";
  const one = previewCount(
    optionsFor("config", sdm ? "oversampling1x" : "filter1x"),
    "1x",
    sdm ? "sdm_filter_1x" : "pcm_filter_1x",
    overrides,
  );
  const nx = previewCount(
    optionsFor("config", sdm ? "oversampling" : "filter"),
    "nx",
    sdm ? "sdm_filter_nx" : "pcm_filter_nx",
    overrides,
  );
  return { one, nx };
}

// Column head for the count chips, the popover's first row. The bare pair
// ("17/47") reads as a fraction and is not one, so the column says what its two
// numbers are: the active chain's 1x list size and its Nx list size.
const CountHead = () => html`<div class="multi-head t-label">1x / Nx</div>`;

// The count chip shown right-aligned in each popover row. A pair that zeroes out
// both stages reads `dead` — a dead-end pick, dimmed so it is visible before
// clicking.
function CountChip({ overrides }) {
  const { one, nx } = chainCounts(overrides);
  const dead = one + nx === 0;
  return html`<span class="opt-count ${dead ? "dead" : ""}">${one}/${nx}</span>`;
}

// single-select twin of MultiSelect — same button + popover chrome so every
// facet renders as one identical control (no native <select> chrome mixed in).
// Picking a value closes the popover. Quality, phase, length and ratio use it:
// each is a facet a filter carries exactly one of, so two picks could only
// intersect to nothing. `extra` matches MultiSelect's — the ratio popover hangs
// its orthogonal upsample-only checkbox there.
function SingleSelect({ open, name, label, value, items, onPick, active, count, extra }) {
  return html`
    <div class="multi" data-multi=${name}>
      <button type="button" class="multi-btn ${active ? "active" : ""}" onClick=${() => (open.value = !open.value)}>
        ${label} <span class="multi-caret">▾</span>
      </button>
      ${
        open.value
          ? html`<div class="multi-pop">
              ${count ? html`<${CountHead} />` : null}
              ${items.map(
                ([v, l]) => html`
                  <label>
                    <input
                      type="radio"
                      checked=${String(v) === String(value)}
                      onChange=${() => {
                        onPick(v);
                        open.value = false;
                      }}
                    />
                    <span class="opt-label">${l}</span>
                    ${count ? html`<${CountChip} overrides=${count(v)} />` : null}
                  </label>
                `,
              )}
              ${extra || null}
            </div>`
          : null
      }
    </div>
  `;
}

// a checkbox-dropdown multi-select (the shared genre/focus pattern): a button
// showing the summary label, a popover of checkboxes toggling `sig`'s array.
// `extra` is an optional element appended below the item rows, divided off — the
// ratio popover uses it for the orthogonal upsample-only checkbox.
function MultiSelect({ open, name, label, items, sig, extra, active, count }) {
  return html`
    <div class="multi" data-multi=${name}>
      <button type="button" class="multi-btn ${active ? "active" : ""}" onClick=${() => (open.value = !open.value)}>
        ${label} <span class="multi-caret">▾</span>
      </button>
      ${
        open.value
          ? html`<div class="multi-pop">
              ${count ? html`<${CountHead} />` : null}
              ${items.map(
                ([v, l]) => html`
                  <label>
                    <input type="checkbox" checked=${sig.value.includes(v)} onChange=${() => toggleIn(sig, v)} />
                    <span class="opt-label">${l}</span>
                    ${count ? html`<${CountChip} overrides=${count(v)} />` : null}
                  </label>
                `,
              )}
              ${extra || null}
            </div>`
          : null
      }
    </div>
  `;
}

// Per-stage segmented switches: every segment names the LIST YOU GET, never an
// action — "All" is uniformly "narrowing off", so any switch not on its
// leftmost/neutral value reads as narrowing at a glance. `ov` is the selection
// override that segment stands for, merged onto the live facets to preview how
// many filters the pick would leave (the count inside each button).
const APOD_SEGS = [
  { value: "all", label: "All", ov: { apod: false, half: false } },
  { value: "only", label: "Only", ov: { apod: true, half: false } },
  { value: "half", label: "+½", ov: { apod: true, half: true } },
];
const HIRES_1X_SEGS = [
  { value: "show", label: "Show", ov: { hideHires: false } },
  { value: "hide", label: "Hide", ov: { hideHires: true } },
];
const HIRES_NX_SEGS = [
  { value: "all", label: "All", ov: { hiresOnly: false } },
  { value: "only", label: "Only", ov: { hiresOnly: true } },
];

// The manual's apodizing explainer (data/settings.json dsp.apodizing tooltip) —
// stays a VISIBLE caption under the switch row (user decision), as it was under
// the 1x dropdowns.
function apodTip() {
  const s = (metadata.value && metadata.value.settings) || {};
  const e = s.dsp && s.dsp.apodizing;
  return (e && e.tooltip) || "";
}

const HIRES_TIP =
  "Hi-res filters suit high-rate sources (88.2 kHz+) and lossy material like MP3 and MQA. " +
  "Use them at 1x for lossy sources; at Nx, Only narrows to filters built for them.";

// One stage's switch row: muted stage micro-label, the segment, then preview
// counts trailing the switch in button order — how many filters in that stage's
// ACTIVE-chain list (PCM unless the output mode is SDM) each pick would leave
// under the other live facets.
function StageSeg({ stage, sig, options }) {
  const sdm = effective("output_mode") === "sdm";
  const one = stage === "1x";
  const cfgKey = one ? (sdm ? "oversampling1x" : "filter1x") : sdm ? "oversampling" : "filter";
  const field = one ? (sdm ? "sdm_filter_1x" : "pcm_filter_1x") : sdm ? "sdm_filter_nx" : "pcm_filter_nx";
  const list = optionsFor("config", cfgKey);
  const counts = options.map((o) => previewCount(list, stage, field, o.ov));
  return html`
    <div class="narrow-stage-row">
      <span class="t-label">${one ? "1x" : "Nx"}</span>
      <${Segment} value=${sig.value} options=${options} onChange=${(v) => (sig.value = v)} />
      <span class="narrow-count">${counts.join(" · ")}</span>
    </div>
  `;
}

// One function group: title beside its two stage rows, description under the
// rows in the same column.
function SwitchGroup({ title, desc, cls, children }) {
  return html`
    <div class="narrow-group ${cls || ""}">
      <span class="t-label narrow-group-title">${title}</span>
      <div class="narrow-group-body">
        ${children}
        ${desc ? html`<div class="t-caption">${desc}</div>` : null}
      </div>
    </div>
  `;
}

export function NarrowBar() {
  useEffect(() => {
    const onDown = (e) => closeExcept(e.target);
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  return html`
    <${Card}
      title=${html`Narrow filters${
        narrowingActive.value
          ? html`<button type="button" class="narrow-reset" onClick=${resetNarrowing}>Reset</button>`
          : null
      }`}
      cardClass="narrow-card"
    >
      <div class="t-caption">
        Reduce the number of filters in the dropdowns below by selecting which features you're looking for. Dropdown
        counts show the number of 1x/Nx filters resulting from (de)selecting that option. All narrowing data are sourced
        directly from the HQPlayer manual.
      </div>
      <div class="narrow-controls">
        <div class="narrow-facets">
          <${MultiSelect}
            open=${genreOpen}
            name="genre"
            label=${genreLabel()}
            items=${GENRES}
            sig=${nGenre}
            active=${!!nGenre.value.length}
            count=${(v) => ({ genre: toggleVal(nGenre.value, v) })}
          />
          <${SingleSelect}
            open=${qualityOpen}
            name="quality"
            label=${oneLabel(QUALITY, nQuality.value, "Any quality")}
            value=${nQuality.value}
            items=${QUALITY}
            onPick=${(v) => (nQuality.value = Number(v))}
            active=${Number(nQuality.value) > 0}
            count=${(v) => ({ quality: Number(v) })}
          />
          <${MultiSelect}
            open=${focusOpen}
            name="focus"
            label=${focusLabel()}
            items=${FOCUS}
            sig=${nFocus}
            active=${!!nFocus.value.length}
            count=${(v) => ({ focus: toggleVal(nFocus.value, v) })}
          />
          <${SingleSelect}
            open=${phaseOpen}
            name="phase"
            label=${oneLabel(PHASES, nPhase.value, "Any phase")}
            value=${nPhase.value}
            items=${PHASES}
            onPick=${(v) => (nPhase.value = v)}
            active=${!!nPhase.value}
            count=${(v) => ({ phase: v })}
          />
          <${SingleSelect}
            open=${lengthOpen}
            name="length"
            label=${oneLabel(LENGTHS, nLength.value, "Any length")}
            value=${nLength.value}
            items=${LENGTHS}
            onPick=${(v) => (nLength.value = v)}
            active=${!!nLength.value}
            count=${(v) => ({ length: v })}
          />
          <${SingleSelect}
            open=${ratioOpen}
            name="ratio"
            label=${ratioLabel()}
            value=${nRatio.value}
            items=${RATIOS}
            onPick=${(v) => (nRatio.value = v)}
            active=${!!nRatio.value || nUpsampleOnly.value}
            count=${(v) => ({ ratio: v })}
            extra=${html`<label class="multi-extra">
              <input
                type="checkbox"
                checked=${nUpsampleOnly.value}
                onChange=${() => (nUpsampleOnly.value = !nUpsampleOnly.value)}
              />
              <span class="opt-label">Upsample-only</span>
              <${CountChip} overrides=${{ upsampleOnly: true }} />
            </label>`}
          />
          <button
            type="button"
            class="multi-btn ${nFavOnly.value ? "active" : ""}"
            disabled=${!favoriteFilters.value.size}
            title=${
              favoriteFilters.value.size
                ? "Show only the filters you starred in the dropdowns below"
                : "Star a filter in a dropdown below to enable"
            }
            onClick=${() => (nFavOnly.value = !nFavOnly.value)}
          >
            ★ Favorites
          </button>
        </div>
      </div>
      <div class="narrow-switchcols">
        <${SwitchGroup} title="Apodizing filters" desc=${apodTip()}>
          <${StageSeg} stage="1x" sig=${nApod1x} options=${APOD_SEGS} />
          <${StageSeg} stage="nx" sig=${nApodNx} options=${APOD_SEGS} />
        <//>
        <span class="col-rule"></span>
        <${SwitchGroup} title="Hi-res filters" desc=${HIRES_TIP} cls="narrow-hires">
          <${StageSeg} stage="1x" sig=${nHires1x} options=${HIRES_1X_SEGS} />
          <${StageSeg} stage="nx" sig=${nHiresNx} options=${HIRES_NX_SEGS} />
        <//>
      </div>
    <//>
  `;
}
