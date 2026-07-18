// Global header: daemon identity + live state, presets dropdown, status pill.
import { html } from "../store/dom.js";
import { health, engineState, config } from "../store/state.js";
import { StatusPill } from "./StatusPill.js";

const PLAY = { 0: "Stopped", 1: "Paused", 2: "Playing", 3: "Stopping" };

export function Header() {
  const info = (health.value && health.value.info) || {};
  const st = engineState.value || {};
  const profiles = config.value && config.value.profiles;
  const active = profiles && profiles.value;

  return html`
    <header class="chrome-header">
      <div class="brand">HQPTuner</div>
      <div class="daemon">
        <span>${info.name || "hqplayerd"}</span>
        <span class="muted">${info.engine ? `v${info.engine}` : ""}</span>
        <span class="muted">${PLAY[st.state] || ""}</span>
      </div>
      <div class="presets">
        ${profiles
          ? html`
              <label class="muted">Config</label>
              <select value=${active || ""} disabled>
                ${(profiles.options || []).map(
                  (o) => html`<option value=${o.value}>${o.label || "[default]"}</option>`,
                )}
              </select>
            `
          : null}
      </div>
      <${StatusPill} />
    </header>
  `;
}
