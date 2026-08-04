// Crossfeed mode: which of the two implementations is installed, the staging
// that swaps between them, and the client-side memory that makes the swap
// lossless.
//
// What is INSTALLED is derived: a recognized 16-row structural block at rows
// 0..15 is Structural, anything else is Bauer. There is no config field for it
// because the structural controls have no daemon representation at all — they
// exist only as a consequence of the compiled rows, exactly as the compensation
// slider's percentage lives in its own block rather than in config.
//
// What the user is LOOKING AT is stored separately (see the mode section at the
// foot of this file). The two are not the same question, and answering the second
// with the first is what made the segment turn processing on and off by itself.
//
// Switching mode STAGES a change like any other edit — it deletes nothing. The
// installed block sits in the baseline until Apply, and Discard puts it back.
//
// The remembered triple exists for a narrower reason: the baseline holds the
// block as last APPLIED, so a user who nudges the angle, toggles to Bauer and
// toggles back would silently lose that nudge if we recompiled from the baseline.
// An in-memory signal covers the session; localStorage carries it across an Apply
// or a reload (prefs.js precedent). That last part is a convenience, and its cost
// is worth stating: those values are browser-local and do not travel with the
// configuration.

import { signal } from "@preact/signals";

import { compileRows, recognizeRows, SPEAKER_ANGLE, HEAD_RADIUS } from "./binaural.js";
import { blockConflicts, pairInfo, REFUSAL } from "./binaural-setup.js";
import { effective, effectivePipelines, pipelineBaseline } from "../store/resolve.js";
import { stagePipelines, edit } from "../store/actions.js";
// Upward, deliberately: the compensation block is recognized against the LIVE
// bauer settings, and that reading lives with the strip that renders it. Nothing
// in components/ imports this module's mode signal back, so the graph stays a DAG.
import { xfeedBlock, removeBlock as removeCompBlock } from "../components/XfeedComp.js";
import { truthy } from "./coerce.js";

const KEY = "hqptuner.structuralCrossfeed";
const DEFAULTS = { lambda: 1, angle: SPEAKER_ANGLE, headRadius: HEAD_RADIUS };

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const v = JSON.parse(raw);
    return {
      lambda: Number.isFinite(v.lambda) ? v.lambda : DEFAULTS.lambda,
      angle: Number.isFinite(v.angle) ? v.angle : DEFAULTS.angle,
      headRadius: Number.isFinite(v.headRadius) ? v.headRadius : DEFAULTS.headRadius,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

// The controls to use when no block is installed — last used, or the defaults.
const remembered = signal(load());

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(remembered.value));
  } catch {
    /* storage disabled — in-memory values still drive the session */
  }
}

export function remember(params) {
  remembered.value = { ...remembered.value, ...params };
  persist();
}

// The installed block, or null. Rows 0..15 only: the block owns the head of the
// list the same way the compensation block owns rows 0..7.
export function structuralBlock(rows) {
  return rows.length >= 16 ? recognizeRows(rows, 0) : null;
}

// In-flight slider position, shared rather than local to the card: the response
// plot reads the same params, so a drag that only updated the card would leave
// the plot stale until release. Null when nothing is being dragged.
export const liveParams = signal(null);

// Live controls, in precedence order: whatever is being dragged right now, then
// the installed block's, then what we remember.
export function structuralParams(rows) {
  return liveParams.value ?? structuralBlock(rows) ?? remembered.value;
}

function installedMode(rows) {
  return structuralBlock(rows) ? "structural" : "bauer";
}

// What stands between the current config and an installed block. Reported, never
// applied behind the user's back — the caller stages these so they appear in the
// pending bar like any other edit.
export function conflicts() {
  return blockConflicts(effective);
}

// Install or update the block, or REFUSE. Returns null when the block is in, and
// the refusal note when the rows it was pointed at are not a stereo pair it can
// carry — see `pairInfo`.
//
// A refusal stages nothing whatever: not the rows, not the row count, and not
// the conflict fixes an install writes alongside them. The rows are left as they
// were found, EQ included, so a call that reports it did nothing has done
// nothing.
export function stageStructural(rows, params) {
  const rec = structuralBlock(rows);
  let eqProcess;
  let preampDb;
  if (rec) {
    eqProcess = rec.eqProcess;
    preampDb = rec.preampDb;
  } else {
    const pair = pairInfo(rows);
    if (pair.refused) return REFUSAL;
    eqProcess = pair.eq;
    preampDb = pair.gain;
  }
  const next = [...compileRows({ ...params, srcA: 0, srcB: 1, preampDb, eqProcess }), ...rows.slice(rec ? 16 : 2)];
  stagePipelines(next);
  edit("pipelines", String(next.length));
  for (const c of conflicts()) edit(c.key, c.required);
  remember(params);
  return null;
}

// The Structural gate's dirty state. The gate is ENGAGE/BYPASS, so the question
// it asks is whether the BLOCK's presence is staged-different from the applied
// one — not whether the rows changed. Retuning an installed block restages all
// sixteen rows and leaves the gate clean on purpose: the crossfeed is engaged
// either way, and the pending bar counts the row edit under matrix_pipelines.
//
// Presence rather than the "pipelines" row-count field:
// that field is the Matrix tab's own count dropdown, so reading it (or a DSP-mode
// restore) lights this gate with no crossfeed change staged, while install and
// removal only register because 2 <-> 16 happens to move the count.
export function pipelinesDirty() {
  return !!structuralBlock(effectivePipelines.value) !== !!structuralBlock(pipelineBaseline.value);
}

// --- which mode the user is LOOKING AT ---------------------------------------
//
// STORED, not derived from the rows. Deriving it makes the segment a mutator:
// selecting a mode has to install its rows for the selection to stick, and
// turning that mode off drops the view into the other one. Both are the app
// deciding what the user is listening to, which is not a view selector's job.
//
// Null until the user picks one, and then the installed rows answer for them — a
// config that arrives with a block open on Structural.
const MODE_KEY = "hqptuner.crossfeedMode";

function loadSelected() {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "structural" || v === "bauer" ? v : null;
  } catch {
    return null; // storage disabled — the session still switches
  }
}

export const xfMode = signal(loadSelected());

// The mode on screen: the user's choice, or what the rows say when there is none.
export function activeMode(rows) {
  return xfMode.value ?? installedMode(rows);
}

// Everything Bauer puts in the signal path: the daemon's post-process flag AND
// the compensation block that corrects for it. The block is matrix rows, so
// leaving it behind means a correction still running against no crossfeed.
export function disableBauer(rows) {
  const { rec } = xfeedBlock(rows);
  if (rec) removeCompBlock(rows, rec);
  if (truthy(effective("crossfeed_enabled"))) edit("crossfeed_enabled", "0");
}

// Selecting a mode DISABLES the one being left and enables NOTHING. Arriving at a
// view is a request to see its controls, never to have its processing switched on
// behind the user's back; leaving one is the opposite reading of the same click,
// and it is what keeps the two crossfeeds — matrix block and post-process — from
// ever running in series. Turning either one on stays a button the user presses.
//
// Both directions stage like any other edit: the pending bar counts them and
// Discard puts them back.
export function setXfMode(next, rows) {
  const m = next === "structural" ? "structural" : "bauer";
  xfMode.value = m;
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* storage disabled — in-memory value drives the session */
  }
  if (m === "bauer") {
    const rec = structuralBlock(rows);
    if (rec) removeStructural(rows, rec);
    return;
  }
  disableBauer(rows);
}

// Take the crossfeed off and hand back the EQ underneath it. The transform is
// fully defined by lambda, angle and head radius, so removing it is arithmetic on
// the rows in front of us — `recognizeRows` is the exact inverse of `compileRows`
// and has already done it. Nothing was destroyed at install, so there is nothing
// to remember: whatever EQ the block picked up WHILE it was installed comes back
// with it, which a snapshot taken at install time could never do.
//
// Channels come from the block rather than assumed. Recognition accepts any
// distinct pair, and a block built on In 3 / In 4 comes back on In 3 / In 4.
// Gain is emitted on the 1e-3 grid `recognizeRows` snaps the preamp to: this is
// the only path now, so rounding it coarser than the block demonstrably carries
// would silently edit the user's number.
export function removeStructural(rows, rec) {
  const row = (i, side) => ({
    gain: String(Math.round(rec.preampDb[side] * 1000) / 1000),
    gainunit: "dB",
    mixdown: rows[i].mixdown,
    process: rec.eqProcess[side],
    source: rows[i].source,
  });
  const next = [row(0, "left"), row(8, "right"), ...rows.slice(16)];
  stagePipelines(next);
  edit("pipelines", String(Math.max(2, next.length)));
}
