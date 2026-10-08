// The Profile builder's EQ / Correction step: Headphone Auto EQ while the edit listens on headphones (a search over the
// AutoEq library, fetched once, its ranked hits and the picked hit's strip), the correction files row (an AutoEq / REW
// text, a convolution filter, the mirror box), then what the stereo pair holds and its response. Every EQ lands on the
// staged set through the pipelines drawer's store; the search's query, the picked hit and the mirror box live here.

import { signal } from "@preact/signals";
import { useRef } from "preact/hooks";
import { api } from "../../../lib/api.js";
import { html } from "../../../lib/dom.js";
import { rankProfiles } from "../../../lib/profilerank.js";
import { parseEqText } from "../../../vendor/eqlab/core/eqimport.js";
import { effectivePipelines } from "../../../store/resolve.js";
import { importEq, pipelinesView, setStages } from "../../../store/faceplate/drawers/pipelines.js";
import { answerOf, meta } from "../../../store/faceplate/builders/profile.js";
import { AEQ_COPY, AUTOEQ_COPY, EQ_MAN } from "../../../store/faceplate/builders/profile-data.js";
import { labelHead } from "../drawer/controls.js";
import { uploadStage } from "../drawers/pipelines/Strip.js";
import { RespPlot } from "../drawers/loudness/RespPlot.js";
import { responsePlot } from "../page/MatrixProfile.js";

/** @typedef {import("../../matrix/plot-traces.js").PipelineRow} PipelineRow */
/** @typedef {import("../../../model/shell/pipelines.js").Stage} Stage */
/** @typedef {import("../../../model/shell/pipelines.js").Pipe} Pipe */
/** @typedef {{ model: string, source: string, text: string }} Profile  one AutoEq entry as GET /api/autoeq carries it */
/** @typedef {{ currentTarget: HTMLInputElement }} InputEv */

/** The correction files row's label. */
export const FILES_LABEL = "Correction files";
/** The response plot's accessible name. */
export const PLOT_ARIA = "EQ response";

/** How many hits the search lists. */
const HITS = 3;
/** The plot's grid step in dB, the window `responsePlot` answers widening by it. */
const STEP = 6;

const db = signal(/** @type {{ profiles: Profile[] } | null} */ (null));
const query = signal("");
const sel = signal(/** @type {Profile | null} */ (null));
const mirror = signal(true);
/** @type {Promise<void> | null} */
let loading = null;

/** Fetch the AutoEq library once, on the first draw that needs it; a refused fetch is not retried. */
function loadDb() {
  loading ??= api.autoeq().then(
    (/** @type {{ profiles: Profile[] }} */ d) => void (db.value = d),
    () => undefined,
  );
}

/** Drop the search and the pick: an EQ landed. */
function landed() {
  query.value = "";
  sel.value = null;
}

/**
 * Land an AutoEq / REW text on the pair.
 *
 * @param {string} text
 */
async function loadText(text) {
  await importEq(text, mirror.value);
  landed();
}

/**
 * Append a filter's stage to the pair's chains, or the first side's alone while the mirror box is clear.
 *
 * @param {Stage} st
 */
async function landStage(st) {
  const v = pipelinesView();
  const sides = mirror.value ? [v.ear[0], v.ear[1]] : [v.ear[0] ?? v.ear[1]];
  for (const p of sides) {
    const i = p ? v.pipes.indexOf(p) : -1;
    if (p && i >= 0) await setStages(i, [...p.stages, st]);
  }
  landed();
}

/**
 * One listed hit: tapping it picks it, tapping it again drops it.
 *
 * @param {Profile} p
 */
function hitRow(p) {
  const on = sel.value === p;
  return html`
    <div class=${on ? "peqhit on" : "peqhit"} role="option" aria-selected=${String(on)}>
      <button type="button" class="peqpick" onClick=${() => (sel.value = on ? null : p)}>
        <span>${p.model}</span>
        <span class="src">${p.source}</span>
      </button>
    </div>
  `;
}

/**
 * The picked hit's strip: its band count and preamp, Clear, Load profile.
 *
 * @param {Profile} p
 */
function strip(p) {
  const { stages, preamp } = parseEqText(p.text);
  return html`
    <div class="peqsel">
      <span class="cap">${AEQ_COPY.bands(stages.length, preamp === null ? null : Number(preamp))}</span>
      <span class="grow"></span>
      <button type="button" class="btn xs" onClick=${() => (sel.value = null)}>${AEQ_COPY.clear}</button>
      <button type="button" class="btn xs" onClick=${() => loadText(p.text)}>${AEQ_COPY.load}</button>
    </div>
  `;
}

/** The Headphone Auto EQ row: the search, the credit, the hits and the picked hit's strip. */
function AutoRow() {
  loadDb();
  /** @type {Profile[] | null} */
  const profiles = db.value?.profiles ?? null;
  const { hits, more } = rankProfiles(profiles, query.value, HITS);
  const p = sel.value;
  return html`
    <div class="drow">
      <div class="ctl">
        ${labelHead(AEQ_COPY.title)}
        <div class="peqsearch">
          <input
            class="vfd pq peqq"
            type="search"
            placeholder=${AUTOEQ_COPY.placeholder}
            aria-label=${AEQ_COPY.title}
            value=${query.value}
            onInput=${(/** @type {InputEv} */ e) => {
              query.value = e.currentTarget.value;
              sel.value = null;
            }}
          />
          <div class="aeqcred">
            ${AEQ_COPY.credit} <a href="https://github.com/jaakkopasanen/AutoEq" target="_blank" rel="noreferrer">AutoEq</a>
            (MIT)
          </div>
          ${
            hits.length
              ? html`<div class="peqhits" role="listbox">
                ${hits.map(hitRow)} ${more ? html`<div class="peqmore">${AEQ_COPY.more(more)}</div>` : null}
              </div>`
              : null
          }
          ${p ? strip(p) : null}
        </div>
      </div>
      <div class="man"><p>${EQ_MAN.peqFile}</p></div>
    </div>
  `;
}

/** The correction files row: an AutoEq / REW text, a convolution filter, the mirror box. */
function FilesRow() {
  const txt = useRef(/** @type {HTMLInputElement | null} */ (null));
  const wav = useRef(/** @type {HTMLInputElement | null} */ (null));
  /** @param {InputEv} e */
  const onTxt = async (e) => {
    const input = e.currentTarget;
    const f = input.files?.[0];
    input.value = "";
    if (f) await loadText(await f.text());
  };
  /** @param {InputEv} e */
  const onWav = async (e) => {
    const input = e.currentTarget;
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length) await uploadStage(files, (st) => void landStage(st));
  };
  return html`
    <div class="drow">
      <div class="ctl">
        ${labelHead(FILES_LABEL)}
        <div class="peqfiles">
          <div class="peqf">
            <button type="button" class="btn xs" onClick=${() => txt.current?.click()}>${AEQ_COPY.file}</button>
            <input ref=${txt} type="file" accept=".txt" hidden onChange=${onTxt} />
            <button type="button" class="btn xs" onClick=${() => wav.current?.click()}>${AEQ_COPY.conv}</button>
            <input ref=${wav} type="file" accept=".wav" hidden onChange=${onWav} />
          </div>
          <label class="chk"
            ><input
              type="checkbox"
              checked=${mirror.value}
              onChange=${(/** @type {InputEv} */ e) => (mirror.value = e.currentTarget.checked)}
            />${AUTOEQ_COPY.mirror}</label
          >
        </div>
      </div>
      <div class="man"><p>${EQ_MAN.conv}</p></div>
    </div>
  `;
}

/** What the pair holds, and its response. */
function Out() {
  const { traces, range } = responsePlot(/** @type {PipelineRow[]} */ (effectivePipelines.value));
  return html`
    <div class="pbeqout">
      <div class="peqhold"><b>${answerOf("eq")}</b></div>
      <${RespPlot}
        cls="eq peqplot"
        aria=${PLOT_ARIA}
        scale=${{ lo: -range, hi: range, step: STEP, minor: STEP / 2 }}
        traces=${traces}
      />
    </div>
  `;
}

/**
 * The EQ / Correction step's rows: Headphone Auto EQ while listening on headphones, the correction files, then what
 * the stereo pair holds and its response.
 */
export function EqStep() {
  return html`
    ${meta.value.listen === "headphones" ? html`<${AutoRow} />` : null}
    <${FilesRow} />
    <${Out} />
  `;
}
