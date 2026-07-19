// Filter narrowing bar — the header for the PCM/SDM filter cards. Genre /
// quality / focus (multi-select) / phase facets trim the filter dropdowns
// (store/narrowing.js); the apodizing toggle (1x only) with a ½-apodizing
// sub-toggle sits at the right. Presentational only.
import { signal } from "@preact/signals";
import { html } from "../store/dom.js";
import { nGenre, nQuality, nFocus, nPhase, nApod, nApodHalf, narrowingActive, resetNarrowing } from "../store/narrowing.js";

const GENRES = ["", "pop", "rock", "jazz", "blues", "classical", "electronic"];
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

const focusOpen = signal(false);

function toggleFocus(v) {
  const cur = nFocus.value;
  nFocus.value = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
}

function focusLabel() {
  const sel = nFocus.value;
  if (!sel.length) return "Any focus";
  if (sel.length === 1) return (FOCUS.find(([v]) => v === sel[0]) || [])[1];
  return `${sel.length} focuses`;
}

export function NarrowBar() {
  return html`
    <div class="narrow-bar">
      <span class="narrow-title">Narrow filters</span>
      <select value=${nGenre.value} onChange=${(e) => (nGenre.value = e.target.value)}>
        ${GENRES.map((g) => html`<option value=${g}>${g ? g[0].toUpperCase() + g.slice(1) : "Any genre"}</option>`)}
      </select>
      <select value=${String(nQuality.value)} onChange=${(e) => (nQuality.value = Number(e.target.value))}>
        ${QUALITY.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
      </select>
      <div class="multi">
        <button type="button" class="multi-btn" onClick=${() => (focusOpen.value = !focusOpen.value)}>
          ${focusLabel()} <span class="multi-caret">▾</span>
        </button>
        ${focusOpen.value
          ? html`<div class="multi-pop">
              ${FOCUS.map(
                ([v, l]) => html`
                  <label>
                    <input type="checkbox" checked=${nFocus.value.includes(v)} onChange=${() => toggleFocus(v)} />
                    ${l}
                  </label>
                `,
              )}
            </div>`
          : null}
      </div>
      <select value=${nPhase.value} onChange=${(e) => (nPhase.value = e.target.value)}>
        ${PHASES.map(([v, l]) => html`<option value=${v}>${l}</option>`)}
      </select>
      <div class="narrow-right">
        ${narrowingActive.value
          ? html`<button type="button" class="narrow-reset" onClick=${resetNarrowing}>Reset</button>`
          : null}
        <div class="apod-stack">
          <label class="narrow-apod">
            <input type="checkbox" checked=${nApod.value} onChange=${(e) => (nApod.value = e.target.checked)} />
            Apodizing only (1x)
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
      </div>
    </div>
  `;
}
