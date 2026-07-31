// Filter narrowing bar — a card ABOVE the PCM/SDM filter cards, holding the
// genre / quality / focus / phase / length / ratio facets (all multi- or
// single-select popovers) on one row. Presentational only. Apodizing narrowing
// is NOT here — it is 1x-only and per-chain, so it lives below each 1x dropdown
// (ApodNarrow.js) rather than as a shared bar toggle.
//
// It is a real `Card`, not a panel of its own: it used to paint the card frame
// itself — card surface, card radius, a hand-rolled heading — under its own
// class name, which is how it drifted to the wrong border token and a doubled
// bottom margin without any gate noticing. A card that reads as a card IS a
// Card (docs/design-system.md).
import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { html } from "../lib/dom.js";
import { effective } from "../store/state.js";
import { optionsFor } from "../store/options.js";
import { Card } from "./tabs/common.js";
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
  previewCount,
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

// add a value to a multi-select array without duplicating — a preview override
// answers "what if this option were ALSO on", so a value already picked leaves
// the selection (and its count) unchanged.
const addVal = (arr, v) => (arr.includes(v) ? arr : [...arr, v]);

// Per-option result counts hang off the ACTIVE chain only (user decision): PCM
// unless the output mode is SDM. The two numbers are that chain's 1x / Nx list
// sizes AFTER the option's override is merged onto the live selection — so the
// popover reads "Rock 14/22" = 14 of the 1x filters, 22 of the Nx, survive if
// Rock is added. Reads each dropdown's own field key so the preview honours that
// chain's apod / hi-res toggles too.
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

// The count chip shown right-aligned in each popover row. A pair that zeroes out
// both stages reads `dead` — a dead-end pick, dimmed so it is visible before
// clicking.
function CountChip({ overrides }) {
  const { one, nx } = chainCounts(overrides);
  const dead = one + nx === 0;
  return html`<span class="opt-count ${dead ? "dead" : ""}">${one}/${nx}</span>`;
}

// single-select twin of MultiSelect — same button + popover chrome so genre,
// quality, focus, and phase all render as one identical control (no native
// <select> chrome mixed in). Picking a value closes the popover.
function SingleSelect({ open, name, label, value, items, onPick, active, count }) {
  return html`
    <div class="multi" data-multi=${name}>
      <button type="button" class="multi-btn ${active ? "active" : ""}" onClick=${() => (open.value = !open.value)}>
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
                    <span class="opt-label">${l}</span>
                    ${count ? html`<${CountChip} overrides=${count(v)} />` : null}
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
function MultiSelect({ open, name, label, items, sig, extra, active, count }) {
  return html`
    <div class="multi" data-multi=${name}>
      <button type="button" class="multi-btn ${active ? "active" : ""}" onClick=${() => (open.value = !open.value)}>
        ${label} <span class="multi-caret">▾</span>
      </button>
      ${
        open.value
          ? html`<div class="multi-pop">
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

export function NarrowBar() {
  useEffect(() => {
    const onDown = (e) => closeExcept(e.target);
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);
  return html`
    <${Card} title="Narrow filters" cardClass="narrow-card">
      <div class="narrow-controls">
        <div class="narrow-facets">
          <${MultiSelect}
            open=${genreOpen}
            name="genre"
            label=${genreLabel()}
            items=${GENRES}
            sig=${nGenre}
            active=${!!nGenre.value.length}
            count=${(v) => ({ genre: addVal(nGenre.value, v) })}
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
            count=${(v) => ({ focus: addVal(nFocus.value, v) })}
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
          <${MultiSelect}
            open=${lengthOpen}
            name="length"
            label=${lengthLabel()}
            items=${LENGTHS}
            sig=${nLength}
            active=${!!nLength.value.length}
            count=${(v) => ({ length: addVal(nLength.value, v) })}
          />
          <${MultiSelect}
            open=${ratioOpen}
            name="ratio"
            label=${ratioLabel()}
            items=${RATIOS}
            sig=${nRatio}
            active=${!!nRatio.value.length || nUpsampleOnly.value}
            count=${(v) => ({ ratio: addVal(nRatio.value, v) })}
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
        </div>
        <div class="narrow-right">
          ${
            narrowingActive.value
              ? html`<button type="button" class="narrow-reset" onClick=${resetNarrowing}>Reset</button>`
              : null
          }
        </div>
      </div>
    <//>
  `;
}
