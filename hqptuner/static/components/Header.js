// Global header: daemon identity + live state, presets dropdown, status pill.
// Picking a preset does NOT touch the daemon — it previews that preset's saved
// settings into the editor (previewPreset) so they can be tweaked first; the
// header then shows "(pending apply)" until Apply commits the switch. The active
// preset comes from config.active (the truly-loaded ConfigurationGet name).
import { signal } from "@preact/signals";
import { html } from "../store/dom.js";
import { health, engineState, config, pendingPreset, previewPreset, deletePreset } from "../store/state.js";
import { StatusPill } from "./StatusPill.js";

const PLAY = { 0: "Stopped", 1: "Paused", 2: "Playing", 3: "Stopping" };

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
  // eslint-disable-next-line no-alert -- a destructive action wants an explicit OK
  if (!name || !confirm(`Delete preset "${name}"? This cannot be undone.`)) return;
  pickStatus.value = "Deleting…";
  try {
    await deletePreset(name);
    pickStatus.value = "";
  } catch (err) {
    pickStatus.value = `Failed: ${err}`;
  }
}

export function Header() {
  const info = (health.value && health.value.info) || {};
  const st = engineState.value || {};
  const cfg = config.value || {};
  const profiles = cfg.profiles;
  const active = cfg.active || (profiles && profiles.value) || "";
  const pending = pendingPreset.value;

  return html`
    <header class="chrome-header">
      <div class="brand">
        <svg class="brand-glyph" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" />
          <line x1="12" y1="12" x2="17.2" y2="6.8" />
        </svg>
        <span>HQPTuner</span>
      </div>
      <div class="daemon">
        <span>${info.name || "hqplayerd"}</span>
        <span class="muted">${info.engine ? `v${info.engine}` : ""}</span>
        <span class="muted">${PLAY[st.state] || ""}</span>
      </div>
      <div class="presets">
        ${profiles
          ? html`
              <label class="muted">Config</label>
              <select value=${pending || active} onChange=${onPick} disabled=${pickStatus.value === "Loading…"}>
                ${(profiles.options || []).map(
                  (o) => html`<option value=${o.value}>${o.label || "[default]"}</option>`,
                )}
              </select>
              ${pending || active
                ? html`<button
                    class="preset-del"
                    title=${`Delete preset "${pending || active}"`}
                    onClick=${() => onDelete(pending || active)}
                  >
                    Delete
                  </button>`
                : null}
              ${pending ? html`<span class="preset-status pending-apply">(pending apply)</span>` : null}
              ${pickStatus.value && !pending ? html`<span class="preset-status muted">${pickStatus.value}</span>` : null}
            `
          : null}
      </div>
      <${StatusPill} />
    </header>
  `;
}
