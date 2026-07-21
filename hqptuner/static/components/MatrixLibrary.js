// AutoEq profile library lane of the Import-EQ panel. The vendored blob
// (scripts/build_autoeq_db.py → GET /api/autoeq, upstream MIT) is lazy-loaded
// on first open, searched client-side, and a selected profile previews on the
// RESPONSE card (previewEq) WITHOUT touching pipeline state. Apply hands the
// profile's verbatim ParametricEQ.txt to the panel's applyText — the exact
// same bytes and code path as pasting the file, so library apply ≡ paste apply
// by construction. Sources are never merged: every hit shows its measurement
// source, with oratory1990 preferred in ranking on equal match quality.
import { signal } from "@preact/signals";
import { html } from "../store/dom.js";
import { parseEqText } from "../store/eqimport.js";
import { previewEq } from "./MatrixPlot.js";

const db = signal(null); // { meta, profiles } once fetched
const dbState = signal(""); // "" | "loading…" | error text
const query = signal("");
const libSel = signal(null); // selected profile object

const LIMIT = 40;
const sourceRank = (s) => (s === "oratory1990" ? 0 : 1);

async function loadDb() {
  if (db.value || dbState.value === "loading…") return;
  dbState.value = "loading…";
  try {
    const r = await fetch("/api/autoeq");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    db.value = await r.json();
    dbState.value = "";
  } catch (e) {
    dbState.value = `library load failed: ${e.message}`;
  }
}

// All tokens must appear as substrings; rank by where they land
// (start of model < word boundary < mid-word), then by source preference.
function score(model, tokens) {
  const m = model.toLowerCase();
  let s = 0;
  for (const t of tokens) {
    const i = m.indexOf(t);
    if (i === -1) return -1;
    s += (i === 0 ? 0 : m[i - 1] === " " ? 1 : 2) + i / 1000;
  }
  return s;
}

function results() {
  const d = db.value;
  const q = query.value.trim().toLowerCase();
  if (!d || !q) return { hits: [], more: 0 };
  const tokens = q.split(/\s+/);
  const scored = [];
  for (const p of d.profiles) {
    const s = score(p.model, tokens);
    if (s >= 0) scored.push([s, p]);
  }
  scored.sort(
    (a, b) =>
      a[0] - b[0] ||
      sourceRank(a[1].source) - sourceRank(b[1].source) ||
      a[1].model.localeCompare(b[1].model) ||
      a[1].source.localeCompare(b[1].source),
  );
  return { hits: scored.slice(0, LIMIT).map((h) => h[1]), more: Math.max(0, scored.length - LIMIT) };
}

function select(p) {
  libSel.value = p;
  previewEq.value = { label: `${p.model} (${p.source})`, stages: parseEqText(p.text).stages };
}

export function clearLibrarySelection() {
  libSel.value = null;
  previewEq.value = null;
}

function Hit({ p }) {
  const isSel = libSel.value === p;
  return html`
    <button type="button" class="mtx-lib-hit ${isSel ? "selected" : ""}" onClick=${() => (isSel ? clearLibrarySelection() : select(p))}>
      <span class="mtx-lib-model">${p.model}</span>
      <span class="mtx-lib-src">${p.source}${p.form ? ` · ${p.form}` : ""}</span>
    </button>
  `;
}

function Selection({ applyText }) {
  const p = libSel.value;
  if (!p) return null;
  const parsed = parseEqText(p.text);
  return html`
    <div class="mtx-lib-sel">
      <span class="mtx-lib-model">${p.model}</span>
      <span class="mtx-lib-src">${p.source}${p.form ? ` · ${p.form}` : ""}</span>
      <span class="mtx-lib-bands">${parsed.stages.length} band(s)${parsed.preamp !== null ? ` · preamp ${parsed.preamp} dB` : ""} — previewing on the Response card</span>
      <button type="button" class="mtx-tool mtx-primary" onClick=${() => applyText(p.text)}>Load profile</button>
      <button type="button" class="mtx-tool" onClick=${clearLibrarySelection}>Clear</button>
    </div>
  `;
}

export function LibraryPicker({ applyText }) {
  loadDb(); // lazy: first render of the open panel fetches the blob once
  const { hits, more } = results();
  const meta = db.value && db.value.meta;
  return html`
    <div class="mtx-lib">
      <div class="mtx-profile-row">
        <input
          type="text"
          placeholder="Search headphone model — e.g. HD 650…"
          value=${query.value}
          onInput=${(e) => (query.value = e.target.value)}
        />
        <span class="mtx-lib-credit">
          profiles: <a href="https://github.com/jaakkopasanen/AutoEq" target="_blank" rel="noreferrer">AutoEq</a>
          ${" "}(<a href="/vendor/autoeq-LICENSE.txt" target="_blank">MIT</a>)${meta ? ` · ${meta.profiles} models @ ${meta.sha.slice(0, 7)}` : ""}
        </span>
      </div>
      ${dbState.value ? html`<div class="mtx-issues">${dbState.value}</div>` : null}
      ${hits.length
        ? html`<div class="mtx-lib-hits">
            ${hits.map((p) => html`<${Hit} p=${p} />`)}
            ${more ? html`<div class="mtx-lib-more">…${more} more — refine the search</div>` : null}
          </div>`
        : null}
      <${Selection} applyText=${applyText} />
    </div>
  `;
}
