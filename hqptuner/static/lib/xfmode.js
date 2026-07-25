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

import { compileRows, recognizeRows, blockConflicts, pairInfo, SPEAKER_ANGLE, HEAD_RADIUS } from "./binaural.js";
import { effective, stagePipelines, edit } from "../store/state.js";
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

function loadConsumed() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    return Array.isArray(v?.consumed) && v.consumed.length === 2 ? v.consumed : null;
  } catch {
    return null;
  }
}

// The controls to use when no block is installed — last used, or the defaults.
const remembered = signal(load());

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...remembered.value, consumed: consumed.value }));
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

// The EXACT rows the block was compiled over, kept so removal can put them back
// byte-for-byte. Reconstructing them from the recovered controls looks equivalent
// and is not: the gain would come back re-rounded, the row order canonicalized to
// In 1-first (live configs arrive In 2-first), and any asymmetry between the ears
// is not representable in the block at all. These are people's tuned headphone
// profiles; the feature does not get to rewrite them to suit its own conventions.
const consumed = signal(loadConsumed());

// Install or update the block. Always installs — never refuses. Returns a note
// when the rows it took over could not be read as a headphone EQ pair, so they
// were stashed rather than carried in; Turn off restores them verbatim.
export function stageStructural(rows, params) {
  const rec = structuralBlock(rows);
  let eqProcess;
  let preampDb;
  let note = null;
  if (rec) {
    eqProcess = rec.eqProcess;
    preampDb = rec.preampDb;
  } else {
    const pair = pairInfo(rows);
    eqProcess = pair.eq;
    preampDb = pair.gain;
    if (pair.setAside) {
      note = `${pair.setAside} — they have been set aside, and Turn off restores them exactly.`;
    }
    consumed.value = rows.slice(0, 2).map((r) => ({ ...r }));
    persist();
  }
  const next = [...compileRows({ ...params, srcA: 0, srcB: 1, preampDb, eqProcess }), ...rows.slice(rec ? 16 : 2)];
  stagePipelines(next);
  edit("pipelines", String(next.length));
  for (const c of conflicts()) edit(c.key, c.required);
  remember(params);
  return note;
}

// Put back exactly what the block was built over. The stash is persisted with the
// remembered controls, so it survives an Apply and a reload; the fallback that
// reconstructs the pair engages only when there is no stash at all — another
// browser, cleared storage, or a block installed before the stash existed. That
// fallback is the one path that can alter bytes the user did not ask us to touch,
// so callers surface `restored: false` rather than letting the rows come back
// quietly different.
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

export function removeStructural(rows, rec) {
  const original = consumed.value;
  const row = (ch, side) => ({
    gain: String(Math.round(rec.preampDb[side] * 100) / 100),
    gainunit: "dB",
    mixdown: ch,
    process: rec.eqProcess[side],
    source: ch,
  });
  const head = original ?? [row("0", "left"), row("1", "right")];
  const next = [...head, ...rows.slice(16)];
  stagePipelines(next);
  edit("pipelines", String(Math.max(2, next.length)));
  return { restored: original !== null };
}
