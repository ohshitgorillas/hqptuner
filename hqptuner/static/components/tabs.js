// Tab navigation + the four section bodies. Order per decision: Output, DSP,
// Volume, System (outline §3). Step 1 places a representative Field in each of
// the first three to prove both lanes and every widget end-to-end; step 3 fills
// the full outline §4 control set per tab.
import { signal, computed } from "@preact/signals";
import { html } from "../store/dom.js";
import { Field } from "../store/Field.js";
import { effective } from "../store/state.js";
import { PlaybackVolume } from "./PlaybackVolume.js";

const active = signal("output");

// No per-tab page heading — the active tab in the nav already names it.
function Section({ children }) {
  return html`<section class="tab-body">${children}</section>`;
}

// Non-collapsible card, same visual as the Output backend sections (shared title
// style) — used to group controls within a tab.
function Card({ title, children }) {
  return html`
    <section class="card">
      <div class="card-head">${title}</div>
      <div class="card-body">${children}</div>
    </section>
  `;
}

// A backend section reveals itself when its backend is selected (or Combo, which
// runs both). Collapse is purely visual — every field still POSTs (the daemon
// rejects a partial form), so a hidden backend's config is never dropped. The
// user can also toggle manually; `override` (null = follow the backend) wins.
const alsaOpen = computed(() => ["alsa", "combo"].includes(effective("backend")));
const netOpen = computed(() => ["network", "combo"].includes(effective("backend")));
const alsaOverride = signal(null);
const netOverride = signal(null);

function Collapsible({ title, auto, override, children }) {
  const open = override.value === null ? auto.value : override.value;
  return html`
    <section class="collapsible ${open ? "open" : "closed"}">
      <button type="button" class="collapsible-head" onClick=${() => (override.value = !open)}>
        <span class="tri">${open ? "▾" : "▸"}</span> ${title}
      </button>
      ${open ? html`<div class="collapsible-body">${children}</div>` : null}
    </section>
  `;
}

const Output = () =>
  html`<section class="tab-body">
    <div class="top-row">
      <div class="box seg-box">
        <div class="box-title">Mode</div>
        <${Field} k="output_mode" />
      </div>
      <div class="box seg-box">
        <div class="box-title">Backend</div>
        <${Field} k="backend" />
      </div>
      <div class="box">
        <div class="box-title">Rate</div>
        <div class="rate-stack">
          <${Field} k="pcm_rate" />
          <${Field} k="sdm_rate" />
        </div>
      </div>
    </div>
    <${Field} k="idle_time" />
    <${Field} k="upnp_freewheel" />
    <${Collapsible} title="ALSA Backend" auto=${alsaOpen} override=${alsaOverride}>
      <${Field} k="alsa_device" />
      <${Field} k="alsa_offset" />
      <${Field} k="alsa_bits" />
      <${Field} k="alsa_period" />
      <${Field} k="alsa_dop" />
      <${Field} k="alsa_anydsd" />
    <//>
    <${Collapsible} title="Network Backend" auto=${netOpen} override=${netOverride}>
      <${Field} k="net_device" />
      <${Field} k="net_bits" />
      <${Field} k="net_period" />
      <${Field} k="net_dop" />
      <${Field} k="net_anydsd" />
      <${Field} k="net_ipv6" />
    <//>
  </section>`;

const Dsp = () =>
  html`<${Section} title="DSP">
    <${Field} k="filter_nx" />
    <${Field} k="shaper" />
    <${Field} k="channels" />
  <//>`;

const Volume = () =>
  html`<${Section}>
    <${PlaybackVolume} />
    <div class="card-grid">
      <${Card} title="Fixed volume">
        <${Field} k="fixed_volume_enabled" />
        <div class="indent">
          <${Field} k="fixed_volume" />
          <${Field} k="optimal_iso" />
        </div>
      <//>
      <${Card} title="Range">
        <${Field} k="volume_max" />
        <${Field} k="volume_min" />
        <${Field} k="startup_volume" />
      <//>
      <${Card} title="Gain">
        <${Field} k="gain_comp" />
      <//>
      <${Card} title="Automatic">
        <${Field} k="adaptive_volume" />
        <${Field} k="playlist_album_gain" />
      <//>
    </div>
  <//>`;

const System = () => html`<${Section} title="System"><p class="muted">System controls arrive in step 3.</p><//>`;

const TABS = [
  ["output", "Output", Output],
  ["dsp", "DSP", Dsp],
  ["volume", "Volume", Volume],
  ["system", "System", System],
];

export function TabNav() {
  const Body = (TABS.find((t) => t[0] === active.value) || TABS[0])[2];
  return html`
    <nav class="tab-nav">
      ${TABS.map(
        ([id, label]) => html`
          <button class=${active.value === id ? "active" : ""} onClick=${() => (active.value = id)}>${label}</button>
        `,
      )}
    </nav>
    <${Body} />
  `;
}
