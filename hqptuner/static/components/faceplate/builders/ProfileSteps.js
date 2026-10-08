// The Profile builder's step pages and its Advanced settings page. A step page is its title row (the step's name, its
// count in the walk, the close), the step's guide or why it skips, its rows (none while it skips), then Back and Next,
// each landing past the steps that skip. The rows are the drawers' own: their rows and blocks drawn through item(), so
// their copy and controls stay theirs; the builder adds only the choice lines (crossfeed's implementation and each
// step's "do you know your settings?"). The EQ step's rows are ./ProfileEq.js's.

import { html } from "../../../lib/dom.js";
import { truthy } from "../../../lib/coerce.js";
import { PRESETS } from "../../../lib/binaural-setup.js";
import { OVERVIEW, nextStep, prevStep } from "../../../model/builders/builder.js";
import { schema } from "../../../store/schema.js";
import { describe } from "../../../store/prose.js";
import { effective } from "../../../store/resolve.js";
import { edit } from "../../../store/actions.js";
import { showBody } from "../../../store/faceplate/view.js";
import { crossfeedView, pickLine, setGate } from "../../../store/faceplate/drawers/crossfeed.js";
import { pickStructuralPreset, structuralView } from "../../../store/faceplate/drawers/crossfeed/structural.js";
import {
  KNOWN,
  LISTEN,
  PB_COPY,
  PB_STEPS,
  STEP_LABELS,
  XF_LINES,
} from "../../../store/faceplate/builders/profile-data.js";
import { known, meta, page, setKnown, setListen, skip, stepCtx } from "../../../store/faceplate/builders/profile.js";
import { item } from "../drawer/Rows.js";
import { field } from "../drawer/Field.js";
import { labelHead, segButtons } from "../drawer/controls.js";
import { CORRECTION_DRAWER, MATRIX_DRAWER } from "../drawers/matrix.js";
import { CROSSFEED_DRAWER, FAMILY_BLOCKS, LOUDNESS_DRAWER } from "../drawers/matrix-family.js";
import { LABEL, NAME } from "../drawers/crossfeed/copy.js";
import { EqStep } from "./ProfileEq.js";

/** @typedef {import("../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {import("../../../store/faceplate/drawer.js").BodyItem} BodyItem */
/** @typedef {import("../../../model/builders/profile.js").Known} Known */
/** @typedef {{ v: string, label: string, man: string }} Line  one choice line: its value, name and paragraph */

/** The close's accessible name. */
const CLOSE_LABEL = "Close Profile builder";

/** The walk's step ids, in order. */
const IDS = PB_STEPS.map((s) => s.id);

/** The keys the Loudness block stages, each with a catalog default: what "Use the defaults" stages. */
const LOUD_DEFAULTS = LOUDNESS_DRAWER.tabs
  .flatMap((t) => t.body)
  .flatMap((it) => ("block" in it && it.block === "loudness" ? (it.keys ?? []) : []))
  .filter((k) => schema[k]?.def !== undefined);

/**
 * The items of `schema` that `hit` picks, each drawn through item() on its own tab with the family's blocks.
 *
 * @param {DrawerSchema} drawer
 * @param {(it: BodyItem) => boolean} hit
 */
const drawerItems = (drawer, hit) =>
  drawer.tabs.flatMap((t) => t.body.filter(hit).map((it) => item(drawer, it, FAMILY_BLOCKS, t.id)));

/**
 * The drawer row for catalog key `key`.
 *
 * @param {DrawerSchema} drawer
 * @param {string} key
 */
const drawerRow = (drawer, key) => drawerItems(drawer, (it) => "row" in it && it.row.key === key);

/**
 * The drawer block named `name`.
 *
 * @param {DrawerSchema} drawer
 * @param {string} name
 */
const drawerBlock = (drawer, name) => drawerItems(drawer, (it) => "block" in it && it.block === name);

/**
 * One choice line: its radio and name (both pick it unless it is picked), then its paragraph.
 *
 * @param {Line} l
 * @param {boolean} on
 * @param {boolean} fold  folds to its name: another line is picked and leads on
 * @param {(v: string) => unknown} pick
 */
function choiceLine(l, on, fold, pick) {
  const tap = () => (on ? undefined : pick(l.v));
  const cls = ["chline", on ? "cur" : "", fold && !on ? "fold" : ""].filter(Boolean).join(" ");
  return html`
    <div class=${cls} data-v=${l.v}>
      <div class="chl">
        <button type="button" class="radio" role="radio" aria-checked=${String(on)} aria-label=${l.label} onClick=${tap}></button>
        <span class="chn" onClick=${tap}><b>${l.label}</b></span>
      </div>
      <div class="man"><p>${l.man}</p></div>
    </div>
  `;
}

/**
 * Choice lines under their label, spanning the row.
 *
 * @param {{ label: string, lines: Line[], cur: string, pick: (v: string) => unknown, fold?: boolean }} c
 */
const choiceRow = ({ label, lines, cur, pick, fold = false }) => html`
  <div class="drow drow-full pbchoice">
    <div class="ctl">${labelHead(label)}</div>
    <div class="chlist" role="radiogroup" aria-label=${label}>
      ${lines.map((l) => choiceLine(l, l.v === cur, fold, pick))}
    </div>
  </div>
`;

/**
 * A step's "do you know your settings?" lines, the path taken current.
 *
 * @param {keyof Known} step
 * @param {(v: string) => unknown} pick
 */
const knownRow = (step, pick) =>
  choiceRow({ label: STEP_LABELS.settings, lines: KNOWN[step], cur: known.value[step], pick });

/**
 * Crossfeed's line picked: Off bypasses, Bauer or Structural switches to that implementation and engages it.
 *
 * @param {string} v
 */
function pickCrossfeed(v) {
  if (v === "off") return setGate("0");
  pickLine(v);
  return setGate("1");
}

/** Structural's preset, as segment buttons: the one its values land on lit. */
function structuralPresetRow() {
  const control = segButtons({
    options: PRESETS.map((p) => ({ value: p.id, label: p.label })),
    value: structuralView().preset,
    label: LABEL.preset,
    off: false,
    pick: pickStructuralPreset,
  });
  return html`<div class="drow"><div class="ctl">${labelHead(LABEL.preset)} ${control}</div></div>`;
}

/** Crossfeed's rows: the implementation, then while engaged the settings path and the preset or the whole block. */
function crossfeedRows() {
  const view = crossfeedView();
  const lines = [
    { v: "off", label: STEP_LABELS.off, man: XF_LINES.off },
    { v: "bauer", label: LABEL.bauer, man: describe(schema.crossfeed_enabled, "crossfeed_enabled").tooltip },
    { v: "structural", label: LABEL.structural, man: XF_LINES.structural },
  ];
  const impl = choiceRow({
    label: NAME.gate,
    lines,
    cur: view.engaged ? view.picked : "off",
    pick: pickCrossfeed,
    fold: view.engaged,
  });
  if (!view.engaged) return [impl];
  const tab = CROSSFEED_DRAWER.tabs[0].id;
  const preset =
    view.picked === "bauer"
      ? item(CROSSFEED_DRAWER, { row: { key: "crossfeed_preset" } }, FAMILY_BLOCKS, tab)
      : structuralPresetRow();
  const path = known.value.crossfeed === "preset" ? preset : drawerBlock(CROSSFEED_DRAWER, "crossfeed");
  return [impl, knownRow("crossfeed", (v) => setKnown("crossfeed", v)), path];
}

/**
 * Loudness's settings path picked; the defaults path stages every loudness default.
 *
 * @param {string} v
 */
async function pickLoudness(v) {
  setKnown("loudness", v);
  if (v !== "preset") return;
  for (const k of LOUD_DEFAULTS) await edit(k, /** @type {string | number} */ (schema[k].def));
}

/** Loudness's rows: the gate, then while engaged the settings path and, for my values, the whole block. */
function loudnessRows() {
  const gate = drawerRow(LOUDNESS_DRAWER, "loudness_enabled");
  if (!truthy(effective("loudness_enabled"))) return [gate];
  const block = known.value.loudness === "values" ? drawerBlock(LOUDNESS_DRAWER, "loudness") : null;
  return [gate, knownRow("loudness", pickLoudness), block];
}

/** Listening's row: the two ways to listen, the edit's lit. */
const listenRow = () =>
  field(
    {
      id: "listen",
      label: PB_STEPS[0].title,
      man: [],
      options: LISTEN.map((l) => ({ value: l.v, label: l.label })),
      value: () => meta.value.listen,
      set: setListen,
    },
    { drawer: "profile", tab: "listen" },
  );

/** Each step's rows. @type {Record<string, () => unknown>} */
const ROWS = {
  listen: listenRow,
  eq: () => html`<${EqStep} />`,
  crossfeed: crossfeedRows,
  correction: () => [
    drawerRow(CORRECTION_DRAWER, "dac_correction_enabled"),
    drawerRow(CORRECTION_DRAWER, "dac_correction_profile"),
  ],
  loudness: loudnessRows,
};

/**
 * A page's title row in the section header grammar, its count after the name, the close at its end.
 *
 * @param {string} title
 * @param {string} [count]
 */
const titleRow = (title, count) => html`
  <div class="sh btitle">
    <span class="t">${title}</span>
    ${count ? html`<span class="pbn">${count}</span>` : null}
    <span class="ln"></span>
    <button type="button" class="round dx" aria-label=${CLOSE_LABEL} onClick=${() => showBody("chain")}>×</button>
  </div>
`;

/**
 * Whether step `id` skips.
 *
 * @param {string} id
 */
const skipped = (id) => !!skip(id);

/**
 * One step's page: title row, guide or skip line, rows, then Back and Next (Review where Next leaves the walk).
 *
 * @param {{ id: string }} props  id: the step shown
 * @returns {unknown}
 */
export function StepPage({ id }) {
  const i = IDS.indexOf(id);
  const st = PB_STEPS[i];
  const why = skip(id);
  const next = nextStep(IDS, i, skipped);
  return html`
    <div class="pbstepp">
      ${titleRow(st.title, PB_COPY.stepOf(i + 1, IDS.length))}
      <p class=${why ? "pbguide skip" : "pbguide"}>${why || st.guide(stepCtx())}</p>
      <div class="pbsrows">${why ? null : ROWS[id]?.()}</div>
      <div class="pbnav">
        <span class="grow"></span>
        <button type="button" class="btn sm" onClick=${() => (page.value = prevStep(IDS, i, skipped))}>
          ${PB_COPY.back}
        </button>
        <button type="button" class="btn sm" onClick=${() => (page.value = next)}>
          ${next === OVERVIEW ? PB_COPY.review : PB_COPY.next}
        </button>
      </div>
    </div>
  `;
}

/**
 * The Advanced settings page: the Matrix engine drawer's engine, Expand HF and IIR to FIR rows, then the way back to
 * the overview.
 *
 * @returns {unknown}
 */
export function AdvancedPage() {
  return html`
    <div class="pbstepp">
      ${titleRow(PB_COPY.advanced)}
      <div class="pbsrows">
        ${["matrix_engine", "matrix_expand_hf", "matrix_iir2fir"].map((k) => drawerRow(MATRIX_DRAWER, k))}
      </div>
      <div class="pbnav">
        <span class="grow"></span>
        <button type="button" class="btn sm" onClick=${() => (page.value = OVERVIEW)}>${PB_COPY.overview}</button>
      </div>
    </div>
  `;
}
