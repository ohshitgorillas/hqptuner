// Global header: daemon identity + live state, presets dropdown, status pill.
// Picking a preset does NOT touch the daemon — it previews that preset's saved
// settings into the editor (previewPreset) so they can be tweaked first; the
// header then shows "(pending apply)" until Apply commits the switch. The active
// preset comes from config.active (the truly-loaded ConfigurationGet name).
import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import { health, engineState, config, pendingPreset, previewPreset, deletePreset } from "../store/state.js";
import { Ask } from "./Ask.js";
import { askConfirm } from "../store/ask.js";
import { StatusPill } from "./StatusPill.js";

const PLAY = { 0: "Stopped", 1: "Paused", 2: "Playing", 3: "Stopping" };

// Questions this header asks render beside the picker, not in a native dialog.
const OWNER = "header";

const pickStatus = signal(""); // "", "Loading…", or an error line

async function onPick(e) {
  const name = e.target.value;
  pickStatus.value = "Loading…";
  try {
    await previewPreset(name);
    pickStatus.value = "";
  } catch (err) {
    pickStatus.value = `Failed: ${err}`;
  }
}

async function onDelete(name) {
  // a destructive action wants an explicit OK, asked inline beside the picker
  if (!name || !(await askConfirm(OWNER, `Delete preset "${name}"? This cannot be undone.`))) return;
  pickStatus.value = "Deleting…";
  try {
    await deletePreset(name);
    pickStatus.value = "";
  } catch (err) {
    pickStatus.value = `Failed: ${err}`;
  }
}

// Daemon identity + live transport state.
function daemonIdentity() {
  const info = (health.value && health.value.info) || {};
  const st = engineState.value || {};
  return html`
    <div class="daemon">
      <span>${info.name || "hqplayerd"}</span>
      <span class="muted">${info.engine ? `v${info.engine}` : ""}</span>
      <span class="muted">${PLAY[st.state] || ""}</span>
    </div>
  `;
}

// Deleting is offered for whichever preset the picker is showing; the unnamed
// default ("") is not a deletable target.
function deleteButton(name) {
  if (!name) return null;
  return html`<button class="preset-del" title=${`Delete preset "${name}"`} onClick=${() => onDelete(name)}>
    Delete
  </button>`;
}

// One trailing note at most: a previewed preset's pending marker outranks the
// pick status, which is what the "&& !pending" guard said when they were siblings.
function presetNote(pending) {
  if (pending !== null) return html`<span class="preset-status pending-apply">(pending apply)</span>`;
  if (!pickStatus.value) return null;
  return html`<span class="preset-status muted">${pickStatus.value}</span>`;
}

function presetPicker() {
  const cfg = config.value || {};
  const profiles = cfg.profiles;
  if (!profiles) return null;
  const pending = pendingPreset.value;
  // The previewed preset wins the picker until Apply commits (or Discard drops)
  // it. Null is "nothing previewed"; the empty string is the "(no preset)" option
  // being previewed, which a truthiness test read as the former and answered by
  // snapping the picker back to the active preset the user had just left.
  const shown = pending !== null ? pending : cfg.active || profiles.value || "";
  return html`
    <label class="muted">Preset</label>
    <select value=${shown} onChange=${onPick} disabled=${pickStatus.value === "Loading…"}>
      ${(profiles.options || []).map((o) => html`<option value=${o.value}>${o.label || "(no preset)"}</option>`)}
    </select>
    ${deleteButton(shown)}
    ${presetNote(pending)}
  `;
}

export function Header() {
  return html`
    <header class="chrome-header">
      <div class="brand">
        <!-- viewBox is trimmed to the PAINTED extent (r 8.5 centred at 12,
             stroke-width 2 => 2.5..21.5) so the circle's left edge sits on the
             content lane instead of 2px inside it. -->
        <svg class="brand-glyph" viewBox="2.5 2.5 19 19" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" />
          <line x1="12" y1="12" x2="17.2" y2="6.8" />
        </svg>
        <span>HQPTuner</span>
      </div>
      ${daemonIdentity()}
      <div class="presets">${presetPicker()}</div>
      <${Ask} owner=${OWNER} />
      <${StatusPill} />
    </header>
  `;
}
