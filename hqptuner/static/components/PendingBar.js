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
import { stagedCount, split, discardAll, applyAll, reachable, applying, lastApply } from "../store/state.js";

async function onApply() {
  try {
    await applyAll();
  } catch {
    /* result surfaced via lastApply */
  }
}

function statusLine(n, sp, busy, reach, result) {
  if (busy) return html`<span class="note">Applying…${sp.restart ? " daemon restarting" : ""}</span>`;
  if (n && !reach) return html`<span class="note warn">Daemon unreachable — changes held, Apply resumes on reconnect</span>`;
  if (n) return html`<span class="muted">${sp.live} live · ${sp.restart} restart</span>`;
  if (result) return html`<span class="note ${result.ok ? "ok" : "err"}">${result.ok ? "✓" : "✗"} ${result.text}</span>`;
  return html`<span class="muted">No pending changes</span>`;
}

export function PendingBar() {
  const n = stagedCount.value;
  const busy = applying.value;
  const reach = reachable.value;
  return html`
    <footer class="pending-bar ${n ? "active" : ""}">
      <span class="count">${n ? `${n} staged` : ""}</span>
      ${statusLine(n, split.value, busy, reach, lastApply.value)}
      <span class="spacer"></span>
      <button onClick=${discardAll} disabled=${busy || n === 0}>Discard</button>
      <button class="primary" onClick=${onApply} disabled=${busy || n === 0 || !reach}>
        ${busy ? "Applying…" : "Apply"}
      </button>
    </footer>
  `;
}
