// Pending-changes bar. Explicit about *why* Apply is enabled or not, so a
// disabled button never reads as a hung one:
//   applying      — "Applying… (daemon restarting)" while the apply is in flight
//   held          — daemon unreachable: changes are kept, Apply re-enables on reconnect
//   staged        — N staged + live/restart split, Apply enabled
//   done          — last apply result (✓/✗), shown until the next edit
//   idle          — no pending changes
// Staging is never dropped on a soft failure, so multiple applies and the
// restart→reconnect cycle both work without stranding the user.
import { html } from "../lib/dom.js";
import { Ask } from "./Ask.js";
import { askName, askConfirm } from "../store/ask.js";
import { pendingPreset, reachable, config } from "../store/signals.js";
import { stagedCount, hasPending, split } from "../store/resolve.js";
import { discardAll, applyAll, savePresetOnly, applying, lastApply, autosave, setAutosave } from "../store/actions.js";

/**
 * @typedef {{ live: number, restart: number }} Split
 *   How the staged edits divide by cost (store/resolve.js `split`): how many go
 *   out live over the Control API, and how many restart the daemon.
 * @typedef {{ ok: boolean, text: string }} ApplyResult
 *   The most recent apply's outcome (store/apply-summary.js `summarize`), held
 *   until the next edit clears it.
 */

// Questions this bar asks render inside it, not in a native dialog.
const OWNER = "pending";

// Where Apply & Save writes: the preset this apply lands on — the previewed one
// when a switch is pending (the daemon's active hasn't changed yet), else the
// current active. "(no preset)" (empty) can't be a save target: its "snapshot" is
// the working config, which a plain Apply already writes. Tested against null so
// previewing "(no preset)" yields no target — falling through to the active
// preset would offer to save into the very preset the user is leaving.
/** @returns {string} */
function saveTarget() {
  const c = config.value || {};
  if (pendingPreset.value !== null) return pendingPreset.value;
  return c.active || (c.profiles && c.profiles.value) || "";
}

/** @returns {(string | number)[]} */
function existingPresets() {
  const p = config.value && config.value.profiles;
  return ((p && p.options) || []).map((/** @type {SchemaOption} */ o) => o.value).filter(Boolean);
}

async function onApply() {
  try {
    await applyAll();
  } catch {
    /* result surfaced via lastApply */
  }
}

// With nothing staged, saving still works: it persists the CURRENT running
// config to the preset (no arbitrary edit needed to light the button).
/**
 * @param {string} name
 * @param {boolean} pend whether anything is staged — a save with edits applies them too
 */
async function saveVia(name, pend) {
  try {
    if (pend) await applyAll({ name });
    else await savePresetOnly(name);
  } catch {
    /* surfaced via lastApply */
  }
}

/** @param {boolean} pend */
async function onApplySave(pend) {
  const name = saveTarget();
  if (name) await saveVia(name, pend);
}

// Both questions are asked INLINE in the bar (store/ask.js). Backing out of
// either — Escape, Cancel, or an empty name — commits nothing.
/** @param {boolean} pend */
async function onSaveNew(pend) {
  // askName resolves whatever the prompt collected (store/ask.js types that
  // `unknown`); a name prompt only ever settles a typed string or the cancel null.
  const name = /** @type {string | null} */ (await askName(OWNER, "Save current settings as a new preset:"));
  if (!name) return;
  if (existingPresets().includes(name)) {
    const overwrite = await askConfirm(OWNER, `Preset "${name}" already exists. Overwrite it?`);
    if (!overwrite) return;
  }
  await saveVia(name, pend);
}

const HELD = "Daemon unreachable — changes held, Apply resumes on reconnect";

// Auto-save toggle: with it on, the backend folds every successful apply and
// live change into the active preset — store only, no extra restart (the daemon
// mirror catches up on the next reload). Needs an active preset to write to,
// so it disables on "(no preset)".
function AutosaveToggle() {
  const active = !!(config.value && config.value.active);
  const title = active
    ? "Save every apply and live change into the active preset (no extra restart)"
    : "Auto-save needs an active preset";
  return html`
    <label class="autosave" title=${title}>
      <input
        type="checkbox"
        checked=${autosave.value}
        disabled=${!active}
        onChange=${(/** @type {{ target: HTMLInputElement }} */ e) => setAutosave(e.target.checked)}
      />
      Auto-save
    </label>
  `;
}

// How the previewed switch target reads in the bar. Null is nothing previewed;
// the empty string is the "(no preset)" option, a real target whose name happens
// to be empty — so it must not collapse into "nothing pending". Named presets
// keep their quotes, "(no preset)" carries its own parentheses instead.
const switchLabel = (/** @type {string | null} */ name) => (name === null ? null : name ? `"${name}"` : "(no preset)");

// A persistent edit or a preset switch both restart the daemon, so say so while
// the apply is in flight rather than leaving a silent pause.
//
// `busy` is what names this state. The other three notes carry `ok`, `err` or
// `warn`, so without it the in-flight note would be the only one identified by
// the ABSENCE of a modifier — leaving `.note` the sole selector for "an apply is
// running", which also matches all three concluded states.
const applyingLine = (/** @type {Split} */ sp, /** @type {string | null} */ switchName) =>
  html`<span class="note busy">Applying…${sp.restart || switchName ? " daemon restarting" : ""}</span>`;

// What is waiting to go out, as a readable list.
/**
 * @param {number} n
 * @param {Split} sp
 * @param {string | null} switchName
 */
function pendingLine(n, sp, switchName) {
  const parts = [];
  if (switchName) parts.push(`switch to ${switchName}`);
  if (n) parts.push(`${sp.live} live · ${sp.restart} restart`);
  return html`<span class="muted">${parts.join(" · ")}</span>`;
}

const resultLine = (/** @type {ApplyResult} */ result) =>
  html`<span class="note ${result.ok ? "ok" : "err"}">${result.ok ? "✓" : "✗"} ${result.text}</span>`;

/**
 * @param {number} n
 * @param {Split} sp
 * @param {{ busy: boolean, reach: boolean }} state
 * @param {{ result: ApplyResult | null, switchName: string | null }} last
 */
function statusLine(n, sp, { busy, reach }, { result, switchName }) {
  if (busy) return applyingLine(sp, switchName);
  const pend = n > 0 || !!switchName;
  if (!pend) return result ? resultLine(result) : html`<span class="muted">No pending changes</span>`;
  if (!reach) return html`<span class="note warn">${HELD}</span>`;
  // A failed apply KEEPS the staging (api/app.py), so "still pending" and "the
  // last apply failed" are true at once — and the pending line alone reads as if
  // nothing was ever tried. The failure is the reason the changes are still here,
  // so it leads; `edit()` clears it the moment the user stages something new.
  if (result && !result.ok) return html`${resultLine(result)}${pendingLine(n, sp, switchName)}`;
  return pendingLine(n, sp, switchName);
}

// Which buttons are inert. Discard is local, so it only wants something pending;
// Apply additionally needs a reachable daemon; the save lane needs a reachable
// daemon and a named target to write to.
/**
 * @param {boolean} busy
 * @param {boolean} pend
 * @param {boolean} reach
 * @param {string} target
 * @returns {{ discard: boolean, apply: boolean, save: boolean, saveNew: boolean }}
 */
function inert(busy, pend, reach, target) {
  return {
    discard: busy || !pend,
    apply: busy || !pend || !reach,
    save: busy || !reach || !target,
    saveNew: busy || !reach,
  };
}

// Why the save button is offered, and where it writes.
/**
 * @param {string} target
 * @param {boolean} pend
 * @returns {string}
 */
function saveTitle(target, pend) {
  if (!target) return "No preset selected — Save needs a named preset";
  return pend ? `Apply and save to "${target}"` : `Save the current settings to "${target}"`;
}

/** Footer bar carrying the staged-edit count and status line with the Discard, Apply, Save and Save as New buttons. */
export function PendingBar() {
  const n = stagedCount.value;
  const busy = applying.value;
  const reach = reachable.value;
  const pend = hasPending.value;
  const switchName = switchLabel(pendingPreset.value);
  const target = saveTarget();
  const off = inert(busy, pend, reach, target);
  return html`
    <footer class="pending-bar ${pend ? "active" : ""}">
      <span class="count">${n ? `${n} staged` : ""}</span>
      ${statusLine(n, split.value, { busy, reach }, { result: lastApply.value, switchName })}
      <${Ask} owner=${OWNER} />
      <span class="spacer"></span>
      <${AutosaveToggle} />
      <button onClick=${discardAll} disabled=${off.discard}>Discard</button>
      <button class="primary" onClick=${onApply} disabled=${off.apply}>${busy ? "Applying…" : "Apply"}</button>
      <button onClick=${() => onApplySave(pend)} disabled=${off.save} title=${saveTitle(target, pend)}>
        ${pend ? "Apply & Save" : "Save"}
      </button>
      <button onClick=${() => onSaveNew(pend)} disabled=${off.saveNew}>Save as New…</button>
    </footer>
  `;
}
