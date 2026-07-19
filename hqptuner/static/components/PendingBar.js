// Pending-changes bar. Explicit about *why* Apply is enabled or not, so a
// disabled button never reads as a hung one:
//   applying      — "Applying… (daemon restarting)" while the apply is in flight
//   held          — daemon unreachable: changes are kept, Apply re-enables on reconnect
//   staged        — N staged + live/restart split, Apply enabled
//   done          — last apply result (✓/✗), shown until the next edit
//   idle          — no pending changes
// Staging is never dropped on a soft failure, so multiple applies and the
// restart→reconnect cycle both work without stranding the user.
import { html } from "../store/dom.js";
import {
  stagedCount,
  hasPending,
  pendingPreset,
  split,
  discardAll,
  applyAll,
  reachable,
  applying,
  lastApply,
  config,
} from "../store/state.js";

// Where Apply & Save writes: the preset this apply lands on — the previewed one
// when a switch is pending (the daemon's active hasn't changed yet), else the
// current active. [default] (empty) can't be a save target: its "snapshot" is the
// working config, which a plain Apply already writes.
function saveTarget() {
  const c = config.value || {};
  return pendingPreset.value || c.active || (c.profiles && c.profiles.value) || "";
}

function existingPresets() {
  const p = config.value && config.value.profiles;
  return ((p && p.options) || []).map((o) => o.value).filter(Boolean);
}

async function onApply() {
  try {
    await applyAll();
  } catch {
    /* result surfaced via lastApply */
  }
}

async function onApplySave() {
  const name = saveTarget();
  if (!name) return;
  try {
    await applyAll({ name });
  } catch {
    /* surfaced via lastApply */
  }
}

async function onSaveNew() {
  const name = (prompt("Save current settings as a new preset:") || "").trim();
  if (!name) return;
  if (existingPresets().includes(name) && !confirm(`Preset "${name}" already exists. Overwrite it?`)) return;
  try {
    await applyAll({ name });
  } catch {
    /* surfaced via lastApply */
  }
}

function statusLine(n, sp, busy, reach, result, switchName) {
  if (busy) return html`<span class="note">Applying…${sp.restart || switchName ? " daemon restarting" : ""}</span>`;
  const pend = n > 0 || !!switchName;
  if (pend && !reach) return html`<span class="note warn">Daemon unreachable — changes held, Apply resumes on reconnect</span>`;
  if (pend) {
    const parts = [];
    if (switchName) parts.push(`switch to "${switchName}"`);
    if (n) parts.push(`${sp.live} live · ${sp.restart} restart`);
    return html`<span class="muted">${parts.join(" · ")}</span>`;
  }
  if (result) return html`<span class="note ${result.ok ? "ok" : "err"}">${result.ok ? "✓" : "✗"} ${result.text}</span>`;
  return html`<span class="muted">No pending changes</span>`;
}

export function PendingBar() {
  const n = stagedCount.value;
  const busy = applying.value;
  const reach = reachable.value;
  const pend = hasPending.value;
  const switchName = pendingPreset.value;
  const canApply = !(busy || !pend || !reach);
  const target = saveTarget();
  return html`
    <footer class="pending-bar ${pend ? "active" : ""}">
      <span class="count">${n ? `${n} staged` : ""}</span>
      ${statusLine(n, split.value, busy, reach, lastApply.value, switchName)}
      <span class="spacer"></span>
      <button onClick=${discardAll} disabled=${busy || !pend}>Discard</button>
      <button class="primary" onClick=${onApply} disabled=${!canApply}>${busy ? "Applying…" : "Apply"}</button>
      <button
        onClick=${onApplySave}
        disabled=${!canApply || !target}
        title=${target ? `Apply and save to "${target}"` : "No named preset to save to ([default])"}
      >
        Apply & Save
      </button>
      <button onClick=${onSaveNew} disabled=${!canApply}>Save as New…</button>
    </footer>
  `;
}
