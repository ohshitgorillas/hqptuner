// Filter narrowing bar — a titled panel ABOVE the PCM/SDM filter cards. The
// "Narrow filters" heading sits on its own line; the genre / quality / focus
// (multi-select) / phase facets and the apodizing toggle (1x only, with a
// ½-apodizing sub-toggle) sit on the control row below it. Presentational only.
import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import { metadata } from "../store/state.js";
import { nGenre, nQuality, nFocus, nPhase, nLength, nApod, nApodHalf, narrowingActive, resetNarrowing } from "../store/narrowing.js";

// manual prose for the apodizing toggle (settings.json dsp.show_apodizing_only)
function apodTip() {
  const s = (metadata.value && metadata.value.settings) || {};
  const e = s.dsp && s.dsp.show_apodizing_only;
  return (e && e.tooltip) || "";
}

const GENRES = ["pop", "rock", "jazz", "blues", "classical", "electronic"];
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

const focusOpen = signal(false);
const genreOpen = signal(false);
const qualityOpen = signal(false);
const phaseOpen = signal(false);
const lengthOpen = signal(false);

// toggle a value in a multi-select signal (add if absent, remove if present)
function toggleIn(sig, v) {
  const cur = sig.value;
  sig.value = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
}

const cap = (g) => g[0].toUpperCase() + g.slice(1);

function focusLabel() {
  const sel = nFocus.value;
  if (!sel.length) return "Any focus";
  if (sel.length === 1) return (FOCUS.find(([v]) => v === sel[0]) || [])[1];
  return `${sel.length} focuses`;
}

function genreLabel() {
  const sel = nGenre.value;
  if (!sel.length) return "Any genre";
  if (sel.length === 1) return cap(sel[0]);
  return `${sel.length} genres`;
}

function lengthLabel() {
  const sel = nLength.value;
  if (!sel.length) return "Any length";
  if (sel.length === 1) return oneLabel(LENGTHS, sel[0], sel[0]);
  return `${sel.length} lengths`;
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
      ${open.value
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
        : null}
    </div>
  `;
}

// a checkbox-dropdown multi-select (the shared genre/focus pattern): a button
// showing the summary label, a popover of checkboxes toggling `sig`'s array.
function MultiSelect({ open, label, items, sig }) {
  return html`
    <div class="multi">
      <button type="button" class="multi-btn" onClick=${() => (open.value = !open.value)}>
        ${label} <span class="multi-caret">▾</span>
      </button>
      ${open.value
        ? html`<div class="multi-pop">
            ${items.map(
              ([v, l]) => html`
                <label>
                  <input type="checkbox" checked=${sig.value.includes(v)} onChange=${() => toggleIn(sig, v)} />
                  ${l}
                </label>
              `,
            )}
          </div>`
        : null}
    </div>
  `;
}

export function NarrowBar() {
  return html`
    <div class="narrow-bar">
      <div class="narrow-header">Narrow filters</div>
      <div class="narrow-controls">
        <div class="apod-stack">
          <label class="narrow-apod" title=${apodTip()}>
            <input type="checkbox" checked=${nApod.value} onChange=${(e) => (nApod.value = e.target.checked)} />
            Show apodizing only (1x)
          </label>
          <label class="narrow-apod apod-sub ${nApod.value ? "" : "off"}">
            <input
              type="checkbox"
              checked=${nApodHalf.value}
              disabled=${!nApod.value}
              onChange=${(e) => (nApodHalf.value = e.target.checked)}
            />
            Show ½ apodizing filters
          </label>
        </div>
        <div class="narrow-facets">
          <${MultiSelect} open=${genreOpen} label=${genreLabel()} items=${GENRES.map((g) => [g, cap(g)])} sig=${nGenre} />
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
        </div>
        <div class="narrow-right">
          ${narrowingActive.value
            ? html`<button type="button" class="narrow-reset" onClick=${resetNarrowing}>Reset</button>`
            : null}
        </div>
      </div>
    </div>
  `;
}
