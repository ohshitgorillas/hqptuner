// The Profile builder's record and save half: the edit's meta and values, the book of saved profiles, when the edit
// reads dirty, loading and stashing a record, and what Save, Remove and Discard send. The edit is the staged set
// itself: loading a profile stages its rows and post-process chain, Save stages the profile save and applies it. Sits
// on the builders' shell (./shell.js) for the record being edited and its stashed edits; ./profile.js is the rest.

import { signal } from "@preact/signals";
import { NEW, keyOf, savePlan, savedTo, removedFrom } from "../../../model/builders/builder.js";
import { knownOf, isDirty as movedFrom } from "../../../model/builders/profile.js";
import { PRESETS } from "../../../lib/binaural-setup.js";
import { truthy } from "../../../lib/coerce.js";
import { errText } from "../../../lib/errtext.js";
import { api } from "../../../lib/api.js";
import { schema } from "../../schema.js";
import { canonPipelines, effective, effectivePipelines, isDirty as stagedDirty } from "../../resolve.js";
import { applyAll, discardAll, stagePipelines } from "../../actions.js";
import { refreshConfig } from "../../sync.js";
import {
  isLiveProfile,
  presetProfiles,
  profilePost,
  profileRows,
  savedProfiles,
  stageProfileDelete,
  stageProfileSave,
} from "../../matrix/profiles.js";
import { descriptionError, descriptionFor, descriptions } from "../../matrix/descriptions.js";
import { activeMode, structuralBlock, structuralParams } from "../../xfeed/mode.js";
import { rowOptions } from "../drawer.js";
import { home, stations } from "./snapshot.js";
import { confirm, cur, discard, go, refused, stage, staged } from "./shell.js";
import { PROFILE_COPY } from "./profile-data.js";

/** @typedef {import("../../../model/builders/builder.js").Ref} Ref */
/** @typedef {import("../../../model/builders/profile.js").Vals} Vals */
/** @typedef {import("../../../model/builders/profile.js").Meta} Meta */
/** @typedef {import("../../../model/builders/profile.js").Known} Known */
/** @typedef {import("../../../model/builders/profile.js").Presets} Presets */
/** @typedef {import("../../resolve.js").PipelineRow} PipelineRow */
/** @typedef {{ rows: PipelineRow[] | null, post: Record<string, string> | null }} ProfileRecord  a saved profile */
/** @typedef {{ meta: Meta, rows: PipelineRow[], post: Record<string, string> }} Stash  an edit stashed by a switch */

/** The post-process chain's catalog keys: what a saved profile's `post` carries, by wire field. */
export const POST_KEYS = Object.keys(schema).filter(
  (k) => schema[k].endpoint === "matrix" && (schema[k].field ?? "").startsWith("post_"),
);
/** The loudness keys with a default: what "Use the defaults" compares against. */
const LOUD_DEFS = POST_KEYS.filter((k) => k.startsWith("loudness_") && schema[k].def !== undefined);
/** The Structural presets in the shape the lifted decisions read. */
const S_PRESETS = PRESETS.map((p) => ({ v: p.id, label: p.label, angle: p.angle, lambda: p.lambda }));

/** The edit's name, stations, description and listening. */
export const meta = signal(/** @type {Meta} */ ({ name: "", stations: [], desc: "", listen: "speakers" }));
/** Each step's "do you know your settings?" path. */
export const known = signal(/** @type {Known} */ ({ crossfeed: "preset", loudness: "preset" }));

/** The record as loaded: its meta, and the staged chain's signature (null: New, read against the baseline). */
let base = { meta: meta.value, sig: /** @type {string | null} */ (null) };

/**
 * A catalog value as the wire writes it: a truth as "1" or "0".
 *
 * @param {string} k
 * @returns {string}
 */
const wireOf = (k) => {
  const v = effective(k);
  if (schema[k].bool) return truthy(v) ? "1" : "0";
  return String(v ?? "");
};

/**
 * The listening a profile's values read as: crossfeed engaged reads headphones (mockup records.js:143).
 *
 * @param {Vals} v
 */
const listenOf = (v) => (v.xfmode !== "off" ? "headphones" : "speakers");

/**
 * The staged post-process chain, by wire field.
 *
 * @returns {Record<string, string>}
 */
const postNow = () =>
  Object.fromEntries(
    POST_KEYS.filter((k) => effective(k) !== undefined).map((k) => [schema[k].field ?? "", wireOf(k)]),
  );

/** What tells two staged chains apart: the rows and the post-process chain. */
const sigNow = () => JSON.stringify([canonPipelines(effectivePipelines.value), postNow()]);

/**
 * The stations holding profile `name`: the loaded one always, then each whose stored preset lists it.
 *
 * @param {string} name
 * @returns {string[]}
 */
function holders(name) {
  const h = home();
  return stations().filter((st) => st === h || (presetProfiles.value[st] ?? []).includes(name));
}

/**
 * The loaded station's saved profiles, name → `{rows, post}`; null for a name only the daemon knows.
 *
 * @returns {Record<string, Record<string, ProfileRecord | null>>}
 */
export function profileBook() {
  /** @type {Record<string, ProfileRecord | null>} */
  const list = {};
  for (const name of savedProfiles.value) {
    const rows = profileRows(name);
    list[name] = rows ? { rows, post: profilePost(name) } : null;
  }
  return { [home()]: list };
}

/**
 * The book Save plans over: every station, the loaded one's profiles and each other's listed names, less the
 * profile being edited, which the stations holding it hold as the same profile.
 *
 * @returns {Record<string, Record<string, ProfileRecord | null>>}
 */
function saveBook() {
  const h = home();
  /** @type {Record<string, Record<string, ProfileRecord | null>>} */
  const book = {};
  for (const st of stations()) {
    const names = (presetProfiles.value[st] ?? []).filter((/** @type {string} */ n) => n !== cur.value.name);
    book[st] = Object.fromEntries(names.map((/** @type {string} */ n) => [n, { rows: null, post: null }]));
  }
  return { ...book, [h]: profileBook()[h] };
}

/**
 * The profile's values off the staged chain.
 *
 * @returns {Vals}
 */
export function valsNow() {
  const rows = effectivePipelines.value;
  const picked = activeMode(rows) === "structural" ? "structural" : "bauer";
  const on = picked === "structural" ? !!structuralBlock(rows) : truthy(effective("crossfeed_enabled"));
  const p = structuralParams(rows);
  return {
    xfmode: on ? picked : "off",
    xfpreset: String(effective("crossfeed_preset") ?? ""),
    xsangle: Number(p.angle),
    xslambda: Number(p.lambda),
    dcen: wireOf("dac_correction_enabled"),
    dcdac: String(effective("dac_correction_profile") ?? ""),
    ldon: wireOf("loudness_enabled"),
    ldrlow: String(effective("loudness_range_low") ?? ""),
    ldrhigh: String(effective("loudness_range_high") ?? ""),
  };
}

/**
 * The Bauer presets the matrix form offers and the Structural ones.
 *
 * @returns {Presets}
 */
export const presets = () => ({
  bauer: rowOptions("crossfeed_preset").map((o) => ({ v: String(o.value), label: o.label })),
  structural: S_PRESETS,
});

/**
 * Each step's settings path for the staged values.
 *
 * @returns {Known}
 */
function knownNow() {
  const vals = Object.fromEntries(LOUD_DEFS.map((k) => [k, String(effective(k) ?? "")]));
  const defs = Object.fromEntries(LOUD_DEFS.map((k) => [k, String(schema[k].def)]));
  return knownOf({ ...valsNow(), ...vals }, presets(), defs);
}

/**
 * Whether the edit differs from its record: the staged chain (New: against the baseline) or its meta.
 *
 * @returns {boolean}
 */
export function dirty() {
  const chain = base.sig === null ? [...POST_KEYS, "matrix_pipelines"].some(stagedDirty) : sigNow() !== base.sig;
  return chain || movedFrom({}, meta.value, { vals: {}, meta: base.meta });
}

/**
 * Take the staged chain as record `ref` as loaded: its meta, and the settings path each step opens on.
 *
 * @param {Ref} ref
 * @param {boolean} hasRows  the record carries rows (false: New, or a name only the daemon knows)
 * @returns {void}
 */
export function settle(ref, hasRows) {
  const listen = listenOf(valsNow());
  const { name } = ref;
  /** @type {Meta} */
  const m =
    name === NEW
      ? { name: "", stations: [home()], desc: "", listen }
      : { name, stations: holders(name), desc: descriptionFor(name)?.text ?? "", listen };
  meta.value = m;
  base = { meta: m, sig: hasRows ? sigNow() : null };
  known.value = knownNow();
}

/**
 * Load record `ref`: the staged set cleared, its rows and post staged, then its stashed edit over them.
 *
 * @param {Ref} ref
 * @returns {Promise<void>}
 */
async function load(ref) {
  const buf = /** @type {Stash | undefined} */ (staged.value.get(keyOf(ref)));
  await discardAll();
  const rows = ref.name === NEW ? null : profileRows(ref.name);
  if (rows) await stagePipelines(rows, profilePost(ref.name) ?? {});
  settle(ref, !!rows);
  if (!buf) return;
  await stagePipelines(buf.rows, buf.post);
  meta.value = buf.meta;
  known.value = knownNow();
}

/**
 * Switch to record `ref`: a dirty edit is stashed under its record, then `ref` loads.
 *
 * @param {Ref} ref
 * @returns {Promise<void>}
 */
export async function switchTo(ref) {
  stage(dirty() ? { meta: meta.value, rows: effectivePipelines.value, post: postNow() } : null);
  go(ref);
  await load(ref);
}

/**
 * Write the save: stage it with the rows and the other ticked stations, apply, write the description, then switch the
 * engine to it where the daemon knows the name. The record edited moves to where it landed, its stashes spent.
 *
 * @param {string} name
 * @returns {Promise<void>}
 */
async function write(name) {
  const h = home();
  const { desc, stations: ticked } = meta.value;
  const to = [h, ...ticked.filter((/** @type {string} */ st) => st !== h)];
  const landed = savedTo(saveBook(), cur.value, { name, to, rec: null, keep: true }).cur;
  const live = isLiveProfile(name);
  const old = cur.value.name;
  if (old !== NEW && old !== name)
    await stageProfileDelete(
      old,
      holders(old).filter((st) => st !== h),
    );
  await stageProfileSave(name, effectivePipelines.value, to.slice(1));
  if (!(await applyAll().catch(() => null))) return;
  try {
    descriptions.value = (await api.saveDescription(name, desc)).profiles || {};
  } catch (e) {
    descriptionError.value = errText(e);
  }
  stage(null);
  go(landed);
  stage(null);
  meta.value = { ...meta.value, name };
  base = { meta: meta.value, sig: sigNow() };
  if (!live) return;
  await api.matrixProfile("switch", name);
  await refreshConfig();
}

/**
 * Save the edit: refuse with no name, nothing with no station ticked, ask before overwriting a profile a ticked
 * station holds, else write.
 *
 * @returns {Promise<void>}
 */
export async function saveProfile() {
  const name = meta.value.name.trim();
  const plan = savePlan(saveBook(), cur.value, name, meta.value.stations);
  if (plan === "refuse") refused.value = true;
  else if (plan === "ask") confirm(PROFILE_COPY.overwrite(name), () => void write(name));
  else if (plan === "write") await write(name);
}

/**
 * Remove the profile being edited from the loaded station and every other station holding it, apply, and land on the
 * first saved name left, else New.
 *
 * @returns {Promise<void>}
 */
export async function removeProfile() {
  const from = cur.value;
  if (from.name === NEW) return;
  const others = holders(from.name).filter((st) => st !== home());
  const landed = removedFrom(profileBook(), from).cur;
  await stageProfileDelete(from.name, others);
  if (!(await applyAll().catch(() => null))) return;
  stage(null);
  go(landed);
  settle(landed, landed.name !== NEW && !!profileRows(landed.name));
}

/**
 * Discard the edit: its stash dropped, the staged set cleared, its record loaded again.
 *
 * @returns {Promise<void>}
 */
export async function discardEdit() {
  discard();
  await load(cur.value);
}
