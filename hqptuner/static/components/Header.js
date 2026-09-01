// Global header: daemon identity + live state, presets dropdown, status pill.
// Outside LIVE, picking a preset does NOT touch the daemon — it previews that
// preset's saved settings into the editor so they can be tweaked first, and the
// header shows "(pending apply)" until Apply commits the switch. LIVE has no
// Apply button, so there the pick loads the preset on the spot (pickPreset).
// The active preset comes from config.active (the truly-loaded
// ConfigurationGet name).
import { signal } from "@preact/signals";
import { html, wheelGuard } from "../lib/dom.js";
import { health, config, pendingPreset } from "../store/signals.js";
import { pickPreset, deletePreset } from "../store/actions.js";
import { liveMode, setLiveMode } from "../store/prefs.js";
import { Ask } from "./Ask.js";
import { askConfirm } from "../store/ask.js";
import { StatusPill } from "./StatusPill.js";
import { ApodLamp } from "./ApodLamp.js";

// Questions this header asks render beside the picker, not in a native dialog.
const OWNER = "header";

const pickStatus = signal(""); // "", "Loading…", or an error line

/**
 * @param {{ target: HTMLSelectElement }} e the picker's change event
 */
async function onPick(e) {
  const name = e.target.value;
  pickStatus.value = "Loading…";
  try {
    await pickPreset(name);
    pickStatus.value = "";
  } catch (err) {
    pickStatus.value = `Failed: ${err}`;
  }
}

/**
 * @param {string} name the preset to delete
 */
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

// Daemon identity. Transport state is not printed here — the signal path's chips
// already show whether the engine is running.
//
// Nor is the daemon's release. It sat beside the brand mark, one gap from the
// word HQPTuner, which is a good way to read as HQPTuner's own version number
// while being hqplayerd's. The System tab's About card states it as the Version
// row, next to the engine build it is forever confused with.
function daemonIdentity() {
  const info = (health.value || {}).info || {};
  return html`
    <div class="daemon">
      <span>${info.name || "hqplayerd"}</span>
    </div>
  `;
}

// The LIVE switch — one latching button, not an ON|OFF pair. It rides the header
// rather than the tab bar because it is a mode over the whole app, not a peer of
// the tabs, and because the header is the one row that exists in both modes: the
// switch is in the same place going in as coming out.
function LiveSwitch() {
  const on = liveMode.value;
  return html`
    <button
      type="button"
      data-testid="live-toggle"
      class="live-toggle ${on ? "on" : ""}"
      aria-pressed=${on}
      title=${on ? "Leave LIVE and go back to the tabs" : "Show only the settings the engine can change right now"}
      onClick=${() => setLiveMode(!on)}
    >
      LIVE
    </button>
  `;
}

// Deleting is offered for whichever preset the picker is showing; the unnamed
// default ("") is not a deletable target.
/**
 * @param {string} name the preset the picker is showing
 */
function deleteButton(name) {
  if (!name) return null;
  return html`<button class="preset-del" title=${`Delete preset "${name}"`} onClick=${() => onDelete(name)}>
    Delete
  </button>`;
}

// One trailing note at most: a previewed preset's pending marker outranks the
// pick status, which is what the "&& !pending" guard said when they were siblings.
/**
 * @param {string | null} pending the previewed preset, or null when nothing is previewed
 */
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
    <select value=${shown} onWheel=${wheelGuard} onChange=${onPick} disabled=${pickStatus.value === "Loading…"}>
      ${(profiles.options || []).map(
        (/** @type {SchemaOption} */ o) => html`<option value=${o.value}>${o.label || "(no preset)"}</option>`,
      )}
    </select>
    ${deleteButton(shown)}
    ${presetNote(pending)}
  `;
}

/** Chrome header: brand mark, daemon identity, LIVE switch, apodizing lamp, preset picker, Ask button and connection pill. */
export function Header() {
  return html`
    <header class="chrome-header">
      <div class="brand">
        <!-- viewBox is trimmed to the PAINTED extent (r 8.5 centered at 12,
             stroke-width 2 => 2.5..21.5) so the circle's left edge sits on the
             content lane instead of 2px inside it. -->
        <svg class="brand-glyph" viewBox="2.5 2.5 19 19" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" />
          <line x1="12" y1="12" x2="17.2" y2="6.8" />
        </svg>
        <span>HQPTuner</span>
      </div>
      ${daemonIdentity()}
      <${LiveSwitch} />
      <${ApodLamp} />
      <div class="presets">${presetPicker()}</div>
      <${Ask} owner=${OWNER} />
      <${StatusPill} />
    </header>
  `;
}
