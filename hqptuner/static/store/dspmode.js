// DSP tab mode — SPEAKERS or HEADPHONES. A VIEW SELECTOR: it decides which
// half of the DSP tab is on screen, and it never turns processing on by itself.
//
// Switching to SPEAKERS SUPPRESSES crossfeed (the two are mutually exclusive
// listening setups — a speaker rig has real ear-to-ear leakage, so synthesizing
// more of it is wrong), and switching back to HEADPHONES puts back exactly what
// was suppressed. Suppression is not the same as turning something off: the user
// enabled crossfeed on the headphone side, that setting belongs to the headphone
// side, and a trip through the speaker controls is not a decision to abandon it.
// Nothing is restored that the switch did not itself take away, and nothing is
// restored over a pipeline the user edited while they were on the speaker side —
// their work outranks the snapshot.
//
// Both directions are STAGED like any other edit — the pending bar counts them
// and Discard undoes them. Nothing reaches the daemon until Apply.
//
// The mode itself is client-only and persisted in localStorage (prefs.js
// precedent): the daemon has no field for "which controls am I looking at". The
// snapshot rides along with it, so a reload on the speaker side does not strand
// the headphone setup.
import { signal } from "@preact/signals";

import { effective, effectivePipelines, canonPipelines } from "./resolve.js";
import { stagePipelines, edit } from "./actions.js";
import { structuralBlock, removeStructural, disableBauer } from "../lib/xfmode.js";
import { truthy } from "../lib/coerce.js";

const KEY = "hqptuner.dspMode";
const SNAPSHOT_KEY = "hqptuner.crossfeedSuppressed";

function load() {
  try {
    return localStorage.getItem(KEY) === "speakers" ? "speakers" : "headphones";
  } catch {
    return "headphones"; // storage disabled — the session still switches
  }
}

// What the switch took away: the pipelines as they stood, the crossfeed flag as
// it stood, and the rows the suppression left behind (the guard for putting them
// back). Null when there was nothing to suppress.
function loadSnapshot() {
  try {
    const v = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null");
    return v && Array.isArray(v.rows) && Array.isArray(v.after) ? v : null;
  } catch {
    return null;
  }
}

let snapshot = loadSnapshot();

function saveSnapshot(v) {
  snapshot = v;
  try {
    if (v) localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(v));
    else localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    /* storage disabled — in-memory value drives the session */
  }
}

export const dspMode = signal(load());

// EVERY crossfeed carrier, since any of them may be installed: the structural
// block is sixteen matrix rows, Bauer is a post-process flag PLUS the eight
// compensation rows built to correct for it. Dropping only the flag left that
// correction running against a crossfeed that was no longer there — and since
// the headphone EQ profile lives inside those eight rows, dismantling them is
// also what hands the profile back to pipelines 1+2 intact.
function suppress() {
  const rows = effectivePipelines.value;
  const crossfeed = effective("crossfeed_enabled");
  const rec = structuralBlock(rows);
  if (rec) removeStructural(rows, rec);
  // Re-read: removing the block restaged the pipelines under us.
  disableBauer(effectivePipelines.value);
  const after = effectivePipelines.value;
  const took = canonPipelines(after) !== canonPipelines(rows) || truthy(crossfeed);
  saveSnapshot(took ? { rows, crossfeed, after } : null);
}

// Put back what the trip to the speaker side took, and only that. A pipeline set
// that no longer matches what the suppression left is one the user has worked on
// since — theirs, not ours to overwrite, so the snapshot is dropped instead.
function restore() {
  const snap = snapshot;
  saveSnapshot(null);
  if (!snap || canonPipelines(effectivePipelines.value) !== canonPipelines(snap.after)) return;
  stagePipelines(snap.rows);
  edit("pipelines", String(Math.max(2, snap.rows.length)));
  if (truthy(snap.crossfeed)) edit("crossfeed_enabled", "1");
}

export function setDspMode(next) {
  const mode = next === "speakers" ? "speakers" : "headphones";
  const prev = dspMode.value;
  dspMode.value = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* storage disabled — in-memory value drives the session */
  }
  if (mode === prev) return;
  if (mode === "speakers") suppress();
  else restore();
}
