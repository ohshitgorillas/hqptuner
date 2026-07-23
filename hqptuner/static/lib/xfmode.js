// Crossfeed mode: which of the two implementations is installed, the staging
// that swaps between them, and the client-side memory that makes the swap
// lossless.
//
// Mode is DERIVED, never stored: a recognized 16-row structural block at rows
// 0..15 is Structural, anything else is Bauer. There is no config field for it
// because the structural controls have no daemon representation at all — they
// exist only as a consequence of the compiled rows, exactly as the compensation
// slider's percentage lives in its own block rather than in config.
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

export function mode(rows) {
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
