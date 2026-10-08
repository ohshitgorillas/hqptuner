// The Profile builder's store: opening on the loaded station, which steps skip, the answers the rail and the overview
// read off the staged chain, the state line, starting from scratch, and the edit's name, description, stations and
// listening. The record, the book and what Save, Remove and Discard send are ./profile-save.js, re-exported here.

import { signal } from "@preact/signals";
import { NEW, OVERVIEW, stateOf } from "../../../model/builders/builder.js";
import { stepContext, skipOf, summaryOf } from "../../../model/builders/profile.js";
import { modeName } from "../../../model/gauges/crossfeed.js";
import { peqCount } from "../../../model/gauges/eq.js";
import { parseProcess } from "../../../vendor/eqlab/core/matrixspec.js";
import { schema } from "../../schema.js";
import { effectivePipelines, runningValue } from "../../resolve.js";
import { edit, stagePipelines } from "../../actions.js";
import { matrixActiveProfile } from "../../matrix/profiles.js";
import { structuralBlock } from "../../xfeed/mode.js";
import { xfeedBlock } from "../../xfeed/block.js";
import { rowOptions } from "../drawer.js";
import { volumeNow } from "../volume.js";
import { home } from "./snapshot.js";
import { cur, go, refused } from "./shell.js";
import { LISTEN, PB_STEPS } from "./profile-data.js";
import { POST_KEYS, dirty, known, meta, presets, settle, valsNow } from "./profile-save.js";

export {
  meta,
  known,
  profileBook,
  valsNow,
  dirty,
  switchTo,
  saveProfile,
  removeProfile,
  discardEdit,
} from "./profile-save.js";

/** @typedef {import("../../../model/builders/builder.js").State} State */
/** @typedef {import("../../../model/builders/profile.js").Meta} Meta */
/** @typedef {import("../../../model/builders/profile.js").Known} Known */
/** @typedef {import("../../../model/builders/profile.js").Summary} Summary */
/** @typedef {import("../../../model/builders/profile.js").StepContext} StepContext */
/** @typedef {import("../../resolve.js").PipelineRow} PipelineRow */

/** Crossfeed's implementations as the rail names them. */
const XF_MODES = [
  { v: "off", label: "Off" },
  { v: "bauer", label: "Bauer" },
  { v: "structural", label: "Structural" },
];

/**
 * Each step's answer from the profile's summary.
 *
 * @type {Record<string, (x: Summary) => string>}
 */
const ANSWER = {
  listen: (x) => LISTEN.find((l) => l.v === x.listen)?.label ?? "",
  crossfeed: ({ crossfeed: x }) => (x.on ? `${modeName(XF_MODES, x.mode) ?? "Off"} · ${x.preset ?? "Custom"}` : "Off"),
  correction: ({ correction: x }) => (x.on ? x.model || "[none]" : "Bypassed"),
  loudness: ({ loudness: x }) => (x.on ? `${x.percent}% applied` : "Off"),
};

/**
 * The EQ step's answer: its band count, else None.
 *
 * @param {number} n
 */
const EQ_ANSWER = (n) => (n ? `${n} bands` : "None");

/** The page showing: the overview, a step id, or `advanced`. */
export const page = signal(OVERVIEW);

/**
 * Open on the loaded station's New entry, over whatever is staged, on the overview.
 *
 * @returns {void}
 */
export function openProfileBuilder() {
  go({ st: home(), name: NEW });
  settle(cur.value, false);
  page.value = OVERVIEW;
}

/**
 * What the steps' guides and skips read: the listening answer, a fixed volume, and how many DAC models are offered.
 *
 * @returns {StepContext}
 */
export function stepCtx() {
  const models = rowOptions("dac_correction_profile").map((o) => ({ v: String(o.value) }));
  return stepContext(meta.value.listen, volumeNow().fixed, models);
}

/**
 * Why step `id` does not apply ('' = it does).
 *
 * @param {string} id
 * @returns {string}
 */
export function skip(id) {
  return skipOf(PB_STEPS, id, stepCtx());
}

/**
 * The first ear's stages: the Structural block's left EQ, else the first row past any compensation block.
 *
 * @returns {{ kind: string, type?: string }[]}
 */
function firstEar() {
  const rows = effectivePipelines.value;
  const rec = structuralBlock(rows);
  const proc = rec ? rec.eqProcess.left : String(rows[xfeedBlock(rows).rec ? 8 : 0]?.process ?? "");
  return parseProcess(proc).map((s) => ({ kind: s.kind, type: s.args?.type }));
}

/**
 * Step `id`'s answer on the rail and the overview.
 *
 * @param {string} id
 * @returns {string}
 */
export function answerOf(id) {
  if (id === "eq") return EQ_ANSWER(peqCount(firstEar()));
  const vol = volumeNow();
  const x = summaryOf(meta.value, valsNow(), presets(), { level: vol.level, fixed: vol.fixed });
  return ANSWER[id]?.(x) ?? "";
}

/**
 * The state line and the Discard / Save buttons: a save always restarts the engine.
 *
 * @returns {State}
 */
export function stateNow() {
  const name = cur.value.name;
  return stateOf({
    dirty: dirty(),
    isNew: name === NEW,
    ticked: meta.value.stations.length > 0,
    restarts: true,
    live: name === matrixActiveProfile.value,
  });
}

/**
 * Start from scratch: the pair with no processing, every post-process gate off and each other key at its default,
 * else its running value; the first step shows.
 *
 * @returns {Promise<void>}
 */
export async function scratch() {
  const rows = effectivePipelines.value;
  const rec = structuralBlock(rows);
  const pair = rec ? [rows[0], rows[8], ...rows.slice(16)] : rows;
  const next = pair.map((/** @type {PipelineRow} */ r) => ({
    ...r,
    gain: String(r.source) === String(r.mixdown) ? "0" : r.gain,
    process: "",
  }));
  /** @type {Record<string, string>} */
  const post = {};
  for (const k of POST_KEYS) {
    const v = schema[k].bool ? "0" : (schema[k].def ?? runningValue(k));
    if (v !== undefined) post[schema[k].field ?? ""] = String(v);
  }
  await stagePipelines(next, post);
  if (rec) await edit("pipelines", String(Math.max(2, next.length)));
  page.value = PB_STEPS[0].id;
}

/**
 * Merge `p` into the edit's meta.
 *
 * @param {Partial<Meta>} p
 */
const patch = (p) => {
  meta.value = { ...meta.value, ...p };
};

/**
 * Type the profile's name; a refusal clears.
 *
 * @param {string} name
 * @returns {void}
 */
export function setName(name) {
  patch({ name });
  refused.value = false;
}

/**
 * Type the profile's description.
 *
 * @param {string} desc
 * @returns {void}
 */
export const setDesc = (desc) => patch({ desc });

/**
 * Tick the stations Save writes to.
 *
 * @param {string[]} list
 * @returns {void}
 */
export const setStations = (list) => patch({ stations: [...list] });

/**
 * Answer the listening step.
 *
 * @param {string} listen
 * @returns {void}
 */
export const setListen = (listen) => patch({ listen });

/**
 * Pick a step's settings path.
 *
 * @param {keyof Known} step
 * @param {string} v  preset | values
 * @returns {void}
 */
export function setKnown(step, v) {
  known.value = { ...known.value, [step]: v };
}
