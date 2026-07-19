// Client-only UI preference: the signature accent color. Persisted in
// localStorage and applied as `data-accent` on <html>; the CSS owns the actual
// color values (`:root[data-accent="…"]`). No daemon involvement — pure chrome.
//
// Module load must stay node-safe (the SSR harness imports the component graph
// with no `localStorage`/`document`): the storage read is guarded, and the
// document is only touched inside functions the browser entry point calls.
import { signal } from "@preact/signals";

const KEY = "hqptuner.accent";
export const ACCENTS = ["blue", "green", "amber"];
const DEFAULT = "blue";

function load() {
  try {
    const v = localStorage.getItem(KEY);
    return ACCENTS.includes(v) ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export const accent = signal(load());

// Persist + apply the choice. Sets the root attribute the CSS keys on, so the
// swap is instant and every accent site follows from the one variable.
export function applyAccent(name) {
  const v = ACCENTS.includes(name) ? name : DEFAULT;
  accent.value = v;
  document.documentElement.dataset.accent = v;
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* storage disabled (private mode) — keep the in-memory value */
  }
}

// Stamp the root attribute at boot so there's no first-paint flash of blue.
export function initAccent() {
  document.documentElement.dataset.accent = accent.value;
}
