// DSP tab mode — SPEAKERS or HEADPHONES. A VIEW SELECTOR: it decides which
// half of the DSP tab is on screen, and it never turns processing on. Switching
// to SPEAKERS suppresses crossfeed (the two are mutually exclusive listening
// setups — a speaker rig has real ear-to-ear leakage, so synthesizing more of it
// is wrong); switching back to HEADPHONES restores NOTHING, because the user
// asked to see the headphone controls, not to have them re-enabled behind their
// back. Standing pipelines and EQ are untouched by either direction.
//
// The suppression is STAGED like any other edit — the pending bar counts it and
// Discard undoes it. Nothing reaches the daemon until Apply.
//
// The mode itself is client-only and persisted in localStorage (prefs.js
// precedent): the daemon has no field for "which controls am I looking at".
import { signal } from "@preact/signals";

import { effective, effectivePipelines, edit } from "./state.js";
import { structuralBlock, removeStructural } from "../lib/xfmode.js";

const KEY = "hqptuner.dspMode";

const truthy = (v) => v === true || v === 1 || v === "1" || v === "on" || v === "true";

function load() {
  try {
    return localStorage.getItem(KEY) === "speakers" ? "speakers" : "headphones";
  } catch {
    return "headphones"; // storage disabled — the session still switches
  }
}

export const dspMode = signal(load());

export function setDspMode(next) {
  const mode = next === "speakers" ? "speakers" : "headphones";
  dspMode.value = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* storage disabled — in-memory value drives the session */
  }
  if (mode !== "speakers") return;
  // Both crossfeed implementations, since either one may be installed: the
  // structural block is sixteen matrix rows, Bauer is a post-process flag.
  const rows = effectivePipelines.value;
  const rec = structuralBlock(rows);
  if (rec) removeStructural(rows, rec);
  if (truthy(effective("crossfeed_enabled"))) edit("crossfeed_enabled", "0");
}
