// Filter narrowing bar — a titled panel ABOVE the PCM/SDM filter cards. The
// "Narrow filters" heading sits on its own line; the genre / quality / focus /
// phase / length / ratio facets (all multi- or single-select popovers) sit on
// the control row below it. Presentational only. Apodizing narrowing is NOT
// here — it is 1x-only and per-chain, so it lives below each 1x dropdown
// (ApodNarrow.js) rather than as a shared bar toggle.
import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import {
  nGenre,
  nQuality,
  nFocus,
  nPhase,
  nLength,
  nRatio,
  nUpsampleOnly,
  narrowingActive,
  resetNarrowing,
} from "../store/narrowing.js";

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
  ["short", "Short"],
  ["medium", "Medium"],
  ["long", "Long"],
  ["xlong", "Extra long"],
];
// "any" is the ratio escape-hatch (a filter the manual marks any-ratio survives
// every ratio selection) — not offered as a pick, same as genre's "All genres".
// Upsample-only ("up" in the manual) rides in the popover as an extra checkbox.
const RATIOS = [
  ["integer", "Integer"],
  ["2x", "2×"],
  ["1:1", "1:1"],
];

const focusOpen = signal(false);
const genreOpen = signal(false);
const qualityOpen = signal(false);
const phaseOpen = signal(false);
const lengthOpen = signal(false);
const ratioOpen = signal(false);

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

function lengthLabel() {
  const sel = nLength.value;
  if (!sel.length) return "Any length";
  if (sel.length === 1) return oneLabel(LENGTHS, sel[0], sel[0]);
  return `${sel.length} lengths`;
}

// The ratio button also reports the upsample-only extra: "Integer", "Upsample
// only", or "Integer + upsample-only" when both are set.
function ratioLabel() {
  const sel = nRatio.value;
  const parts = [];
  if (sel.length === 1) parts.push(oneLabel(RATIOS, sel[0], sel[0]));
  else if (sel.length) parts.push(`${sel.length} ratios`);
  if (nUpsampleOnly.value) parts.push("upsample-only");
  if (!parts.length) return "Any ratio";
  return parts.join(" + ");
}

const oneLabel = (items, v, fallback) => (items.find(([iv]) => String(iv) === String(v)) || [null, fallback])[1];

// single-select twin of MultiSelect — same button + popover chrome so genre,
// quality, focus, and phase all render as one identical control (no native
// <select> chrome mixed in). Picking a value closes the popover.
function SingleSelect({ open, label, value, items, onPick }) {
  return html`
    <div class="multi">
      <button type="button" class="multi-btn" onClick=${() => (open.value = !open.value)}>
        ${label} <span class="multi-caret">▾</span>
      </button>
      ${
        open.value
          ? html`<div class="multi-pop">
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
                    ${l}
                  </label>
                `,
              )}
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
function MultiSelect({ open, label, items, sig, extra }) {
  return html`
    <div class="multi">
      <button type="button" class="multi-btn" onClick=${() => (open.value = !open.value)}>
        ${label} <span class="multi-caret">▾</span>
      </button>
      ${
        open.value
          ? html`<div class="multi-pop">
              ${items.map(
                ([v, l]) => html`
                  <label>
                    <input type="checkbox" checked=${sig.value.includes(v)} onChange=${() => toggleIn(sig, v)} />
                    ${l}
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

export function NarrowBar() {
  return html`
    <div class="narrow-bar">
      <div class="narrow-header">Narrow filters</div>
      <div class="narrow-controls">
        <div class="narrow-facets">
          <${MultiSelect} open=${genreOpen} label=${genreLabel()} items=${GENRES} sig=${nGenre} />
          <${SingleSelect}
            open=${qualityOpen}
            label=${oneLabel(QUALITY, nQuality.value, "Any quality")}
            value=${nQuality.value}
            items=${QUALITY}
            onPick=${(v) => (nQuality.value = Number(v))}
          />
          <${MultiSelect} open=${focusOpen} label=${focusLabel()} items=${FOCUS} sig=${nFocus} />
          <${SingleSelect}
            open=${phaseOpen}
            label=${oneLabel(PHASES, nPhase.value, "Any phase")}
            value=${nPhase.value}
            items=${PHASES}
            onPick=${(v) => (nPhase.value = v)}
          />
          <${MultiSelect} open=${lengthOpen} label=${lengthLabel()} items=${LENGTHS} sig=${nLength} />
          <${MultiSelect}
            open=${ratioOpen}
            label=${ratioLabel()}
            items=${RATIOS}
            sig=${nRatio}
            extra=${html`<label class="multi-extra">
              <input
                type="checkbox"
                checked=${nUpsampleOnly.value}
                onChange=${() => (nUpsampleOnly.value = !nUpsampleOnly.value)}
              />
              Upsample-only
            </label>`}
          />
        </div>
        <div class="narrow-right">
          ${
            narrowingActive.value
              ? html`<button type="button" class="narrow-reset" onClick=${resetNarrowing}>Reset</button>`
              : null
          }
        </div>
      </div>
    </div>
  `;
}
