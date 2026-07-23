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
import { compileRows, recognizeRows, blockConflicts, SPEAKER_ANGLE, HEAD_RADIUS } from "./binaural.js";
import { effective, stagePipelines, edit } from "../store/state.js";

const KEY = "hqptuner.structuralCrossfeed";
export const DEFAULTS = { lambda: 1, angle: SPEAKER_ANGLE, headRadius: HEAD_RADIUS };

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
export const remembered = signal(load());

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

// Live controls: the installed block's if there is one, otherwise what we
// remember. Keeps the card's sliders meaningful before anything is installed.
export function structuralParams(rows) {
  return structuralBlock(rows) ?? remembered.value;
}

export function mode(rows) {
  return structuralBlock(rows) ? "structural" : "bauer";
}

// A stereo EQ pair at rows 0+1 is what the structural block compiles from, and
// what removing it returns to — the same shape the compensation block uses, so
// an AutoEq import lands straight into either. Row order is not a contract
// (live configs arrive In 2-first); the compiled block always emits In 1-first.
export function pairInfo(rows) {
  const [a, b] = rows;
  if (!a || !b) return { issue: "needs pipelines 1+2" };
  const straight = (x, ch) => x.source === ch && x.mixdown === ch;
  const ok = (straight(a, "0") && straight(b, "1")) || (straight(a, "1") && straight(b, "0"));
  if (!ok) return { issue: "pipelines 1+2 must route In 1→Out 1 / In 2→Out 2" };
  if (a.gainunit !== "dB" || b.gainunit !== "dB") return { issue: "pipelines 1+2 gains must be in dB" };
  if (a.process !== b.process || a.gain !== b.gain) return { issue: "pipelines 1+2 are not a symmetric stereo pair" };
  return { eq: a.process, gain: Number(a.gain) };
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
export const consumed = signal(loadConsumed());

// Install or update the block. Returns an issue string and stages NOTHING when
// the head rows are not a shape this can round-trip — the guard is here rather
// than in the caller so no caller can skip it.
export function stageStructural(rows, params) {
  const rec = structuralBlock(rows);
  let eqProcess;
  let preampDb;
  if (rec) {
    eqProcess = rec.eqProcess;
    preampDb = rec.preampDb;
  } else {
    const pair = pairInfo(rows);
    if (pair.issue) return pair.issue;
    eqProcess = pair.eq;
    preampDb = pair.gain;
    consumed.value = rows.slice(0, 2).map((r) => ({ ...r }));
    persist();
  }
  const next = [
    ...compileRows({ ...params, srcA: 0, srcB: 1, preampDb, eqProcess }),
    ...rows.slice(rec ? 16 : 2),
  ];
  stagePipelines(next);
  edit("pipelines", String(next.length));
  for (const c of conflicts()) edit(c.key, c.required);
  remember(params);
  return null;
}

// Put back exactly what the block was built over. Falls back to reconstructing a
// symmetric pair only when the originals are unavailable — after an Apply and a
// reload, say — and that fallback is the one path that can alter bytes the user
// did not ask us to touch, so it is the one worth noticing in a bug report.
export function removeStructural(rows, rec) {
  const original = consumed.value;
  const head = original ?? [
    { gain: String(Math.round(rec.preampDb * 100) / 100), gainunit: "dB", mixdown: "0", process: rec.eqProcess, source: "0" },
    { gain: String(Math.round(rec.preampDb * 100) / 100), gainunit: "dB", mixdown: "1", process: rec.eqProcess, source: "1" },
  ];
  const next = [...head, ...rows.slice(16)];
  stagePipelines(next);
  edit("pipelines", String(Math.max(2, next.length)));
  return { restored: original !== null };
}
