// AutoEq profile library lane of the Import-EQ panel. The vendored blob
// (scripts/build_autoeq_db.py → GET /api/autoeq, upstream MIT) is lazy-loaded
// on first open, searched client-side, and a selected profile previews on the
// RESPONSE card (previewEq) WITHOUT touching pipeline state. Apply hands the
// profile's verbatim ParametricEQ.txt to the panel's applyText — the exact
// same bytes and code path as pasting the file, so library apply ≡ paste apply
// by construction. Sources are never merged: every hit shows its measurement
// source, with oratory1990 preferred in ranking on equal match quality.
import { signal } from "@preact/signals";
import { api } from "../../lib/api.js";
import { html } from "../../lib/dom.js";
import { errText } from "../../lib/errtext.js";
import { rankProfiles } from "../../lib/profilerank.js";
import { parseEqText } from "../../vendor/eqlab/core/eqimport.js";
import { previewEq } from "./Plot.js";

const db = signal(null); // { meta, profiles } once fetched
const dbState = signal(""); // "" | "loading…" | error text
const query = signal("");
const libSel = signal(null); // selected profile object

/**
 * @typedef {{ model: string, source: string, text: string, form?: string }} Profile
 *   One AutoEq entry as GET /api/autoeq carries it: the headphone model, the
 *   measurement source, the verbatim ParametricEQ.txt, and the optional form
 *   factor that distinguishes two measurements of the same model.
 */

const LIMIT = 40;

async function loadDb() {
  if (db.value || dbState.value === "loading…") return;
  dbState.value = "loading…";
  try {
    db.value = await api.autoeq();
    dbState.value = "";
  } catch (e) {
    dbState.value = `library load failed: ${errText(e)}`;
  }
}

function results() {
  return rankProfiles(db.value && db.value.profiles, query.value, LIMIT);
}

/** @param {Profile} p */
function select(p) {
  libSel.value = p;
  previewEq.value = { label: `${p.model} (${p.source})`, stages: parseEqText(p.text).stages };
}

/** Drops the picked library profile and the response-plot preview it drives. */
export function clearLibrarySelection() {
  libSel.value = null;
  previewEq.value = null;
}

/** @param {{ p: Profile }} props */
function Hit({ p }) {
  const isSel = libSel.value === p;
  return html`
    <button
      type="button"
      class="mtx-lib-hit ${isSel ? "selected" : ""}"
      onClick=${() => (isSel ? clearLibrarySelection() : select(p))}
    >
      <span>${p.model}</span>
      <span>${p.source}${p.form ? ` · ${p.form}` : ""}</span>
    </button>
  `;
}

/**
 * @param {{ applyText: (text: string) => void }} props the panel's paste-apply seam
 */
function Selection({ applyText }) {
  const p = libSel.value;
  if (!p) return null;
  const parsed = parseEqText(p.text);
  return html`
    <div>
      <span>${p.model}</span>
      <span>${p.source}${p.form ? ` · ${p.form}` : ""}</span>
      <span
        >${parsed.stages.length} band(s)${parsed.preamp !== null ? ` · preamp ${parsed.preamp} dB` : ""} — previewing on
        the Response card</span
      >
      <button type="button" onClick=${() => applyText(p.text)}>Load profile</button>
      <button type="button" onClick=${clearLibrarySelection}>Clear</button>
    </div>
  `;
}

/**
 * Renders the headphone-EQ library panel: a search box over the profile database,
 * the ranked hit list, and the selection strip that loads the picked profile.
 *
 * @param {{ applyText: (text: string) => void }} props the panel's paste-apply seam
 */
export function LibraryPicker({ applyText }) {
  loadDb(); // lazy: first render of the open panel fetches the blob once
  const { hits, more } = results();
  const meta = db.value && db.value.meta;
  return html`
    <div>
      <div>
        <input
          type="text"
          placeholder="Search headphone model — e.g. HD 650…"
          value=${query.value}
          onInput=${(/** @type {{ target: HTMLInputElement }} */ e) => (query.value = e.target.value)}
        />
        <span>
          profiles:
          <a href="https://github.com/jaakkopasanen/AutoEq" target="_blank" rel="noreferrer">AutoEq</a> ${" "}(<a
            href="/vendor/autoeq-LICENSE.txt"
            target="_blank"
            >MIT</a
          >)${meta ? ` · ${meta.profiles} models @ ${meta.sha.slice(0, 7)}` : ""}
        </span>
      </div>
      ${dbState.value ? html`<div>${dbState.value}</div>` : null}
      ${
        hits.length
          ? html`<div>
              ${hits.map((p) => html`<${Hit} p=${p} />`)}
              ${more ? html`<div>…${more} more — refine the search</div>` : null}
            </div>`
          : null
      }
      <${Selection} applyText=${applyText} />
    </div>
  `;
}
