// Tab navigation + the section bodies. Order: Output, Resampling, DSP, Volume,
// System. Output picks endpoint/backend/channels; Resampling holds mode, rate,
// and the PCM/SDM/DSD filter chains; DSP is DAC correction + crossfeed/loudness;
// Volume and System follow.
import { signal, computed } from "@preact/signals";
import { html } from "../store/dom.js";
import { Field } from "../store/Field.js";
import { effective, health } from "../store/state.js";
import { optionsFor } from "../store/options.js";
import { PlaybackVolume } from "./PlaybackVolume.js";
import { VolumeRangeBar } from "./VolumeRangeBar.js";
import { NarrowBar } from "./NarrowBar.js";
import { HardwareCard, BackupRestoreCard } from "./SystemHardware.js";
import { LogTail } from "./LogTail.js";
import { MatrixTab } from "./MatrixTab.js";
import { CrossfeedPlot, LoudnessPlot } from "./plots.js";
import { accent, applyAccent, ACCENTS } from "../store/theme.js";
import { Checkbox } from "./controls/index.js";
import {
  showDescriptions,
  keepOptionDescriptions,
  setShowDescriptions,
  setKeepOptionDescriptions,
} from "../store/prefs.js";

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

// DSP chain cards auto-open by mode (auto shows both). PCM chain is irrelevant
// in pure SDM mode and vice-versa; DSD-source decoding is irrelevant in PCM.
const pcmOpen = computed(() => effective("output_mode") !== "sdm");
const sdmOpen = computed(() => effective("output_mode") !== "pcm");
const dsdOpen = computed(() => effective("output_mode") !== "pcm");
const pcmOverride = signal(null);
const sdmOverride = signal(null);
const dsdOverride = signal(null);

// FFT filter length configures the FFT-based resampling filters only (readme
// §1.2 fft_size), so the card follows the selection instead of sitting open
// permanently. Any of the four filter slots can select an FFT filter, so all
// four are checked. The stored value is the engine's list INDEX, which is
// volatile (outline §2) — match on the option's name, never on the number.
const FILTER_CONTROLS = [
  ["pcm_filter_1x", "filter1x"],
  ["pcm_filter_nx", "filter"],
  ["sdm_filter_1x", "oversampling1x"],
  ["sdm_filter_nx", "oversampling"],
];
const fftOpen = computed(() =>
  FILTER_CONTROLS.some(([key, field]) => {
    const v = String(effective(key));
    const opt = optionsFor("config", field).find((o) => String(o.value) === v);
    return !!opt && /\bFFT\b/i.test(opt.label);
  }),
);
const fftOverride = signal(null);

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

// A device dropdown is "missing" when its selected value is blank, or points at
// an endpoint no longer in the form's option set — the silent empty entry the
// daemon leaves when a preset's output device (e.g. a powered-off NAA) is absent.
// (Empty option set = form not loaded yet; not an alarm.)
function deviceMissing(key) {
  const opts = optionsFor("config", key);
  if (!opts.length) return false;
  const val = effective(key);
  if (val == null || String(val).trim() === "") return true;
  const match = opts.find((o) => String(o.value) === String(val));
  return !match || String(match.label).trim() === "";
}

// Warn when the active backend has no real output device selected — a loaded
// preset referenced an endpoint that isn't present. Combo runs both backends.
function DeviceAlert() {
  const b = effective("backend");
  const bad = [];
  if (["alsa", "combo"].includes(b) && deviceMissing("alsa_device")) bad.push("ALSA");
  if (["network", "combo"].includes(b) && deviceMissing("net_device")) bad.push("Network");
  if (!bad.length) return null;
  return html`<div class="device-alert">
    ⚠ No output device for the ${bad.join(" and ")} backend — the loaded preset's endpoint isn't present. Power the
    device on, then Rescan devices.
  </div>`;
}

const Output = () =>
  html`<section class="tab-body">
    <${DeviceAlert} />
    <div class="top-row">
      <div class="box seg-box">
        <div class="box-title">Backend</div>
        <${Field} k="backend" />
      </div>
    </div>
    <${Card} title="General">
      <div class="pack">
        <${Field} k="channels" />
        <${Field} k="gain_comp" />
        <${Field} k="idle_time" />
        <${Field} k="upnp_freewheel" />
        <${Field} k="quick_pause" />
        <${Field} k="short_buffer" />
      </div>
    <//>
    <${Collapsible} title="ALSA Backend" auto=${alsaOpen} override=${alsaOverride}>
      <div class="pack">
        <${Field} k="alsa_device" />
        <${Field} k="alsa_offset" />
        <${Field} k="alsa_bits" />
        <${Field} k="alsa_period" />
        <${Field} k="alsa_dop" />
        <${Field} k="alsa_anydsd" />
      </div>
    <//>
    <${Collapsible} title="Network Backend" auto=${netOpen} override=${netOverride}>
      <div class="pack">
        <${Field} k="net_device" />
        <${Field} k="net_bits" />
        <${Field} k="net_period" />
        <${Field} k="net_dop" />
        <${Field} k="net_anydsd" />
        <${Field} k="net_ipv6" />
      </div>
    <//>
  </section>`;

const truthy = (v) => v === true || v === 1 || v === "1" || v === "on" || v === "true";

// Post-processing cards: controls on top, a full-width response plot across the
// bottom. When the feature checkbox is off, the body (sub-controls + plot) dims
// as a unit — the sub-controls also go non-interactive via their grayWhen.
export function CrossfeedCard() {
  const on = truthy(effective("crossfeed_enabled"));
  return html`
    <${Card} title="Crossfeed">
      <div class="dsp-card">
        <div class="pack">
          <${Field} k="crossfeed_enabled" />
          <${Field} k="crossfeed_preset" />
        </div>
        <div class="dsp-body ${on ? "" : "off"}">
          <div class="knob-cluster">
            <${Field} k="crossfeed_frequency" />
            <${Field} k="crossfeed_level" />
          </div>
          <div class="dsp-plot"><${CrossfeedPlot} /></div>
        </div>
      </div>
    <//>
  `;
}

export function LoudnessCard() {
  const on = truthy(effective("loudness_enabled"));
  return html`
    <${Card} title="Loudness">
      <div class="dsp-card">
        <${Field} k="loudness_enabled" />
        <div class="dsp-body ${on ? "" : "off"}">
          <div class="dsp-controls">
            <div class="cluster-row">
              <div class="cluster">
                <div class="cluster-head">Bass</div>
                <${Field} k="loudness_low_level" />
                <${Field} k="loudness_low_freq" />
                <${Field} k="loudness_low_steep" />
                <${Field} k="loudness_low_type" />
              </div>
              <div class="cluster">
                <div class="cluster-head">Treble</div>
                <${Field} k="loudness_high_level" />
                <${Field} k="loudness_high_freq" />
                <${Field} k="loudness_high_steep" />
                <${Field} k="loudness_high_type" />
              </div>
            </div>
            <div class="range-group">
              <div class="cluster-head">Range</div>
              <div class="range-row">
                <${Field} k="loudness_range_low" />
                <${Field} k="loudness_range_high" />
              </div>
            </div>
          </div>
          <div class="dsp-plot"><${LoudnessPlot} /></div>
        </div>
      </div>
    <//>
  `;
}

const Resampling = () =>
  html`<${Section}>
    <div class="top-row">
      <div class="box seg-box">
        <div class="box-title">Mode</div>
        <${Field} k="output_mode" />
      </div>
      <div class="box">
        <div class="box-title">Rate</div>
        <div class="rate-stack">
          <${Field} k="pcm_rate" />
          <${Field} k="sdm_rate" />
        </div>
      </div>
    </div>
    <${NarrowBar} />
    <${Collapsible} title="PCM" auto=${pcmOpen} override=${pcmOverride}>
      <div class="pack chain">
        <${Field} k="pcm_filter_1x" />
        <${Field} k="pcm_filter_nx" />
        <${Field} k="pcm_dither" />
      </div>
    <//>
    <${Collapsible} title="SDM" auto=${sdmOpen} override=${sdmOverride}>
      <div class="pack chain">
        <${Field} k="sdm_filter_1x" />
        <${Field} k="sdm_filter_nx" />
        <${Field} k="sdm_modulator" />
      </div>
    <//>
    <${Collapsible} title="DSD sources" auto=${dsdOpen} override=${dsdOverride}>
      <div class="pack">
        <${Field} k="direct_sdm" />
        <${Field} k="dsd_gain_6db" />
        <${Field} k="sdm_integrator" />
        <${Field} k="sdm_conversion" />
        <${Field} k="noise_filter" />
        <${Field} k="pcm_conversion" />
      </div>
    <//>
    <${Collapsible} title="Filter length" auto=${fftOpen} override=${fftOverride}>
      <${Field} k="fft_size" />
    <//>
  <//>`;

// DAC correction leads the DSP page; the profile dims to non-interactive when
// correction is off (property has no effect until enabled).
const Dsp = () => {
  const dacOn = truthy(effective("dac_correction_enabled"));
  return html`<${Section}>
    <${Card} title="DAC correction">
      <div class="pack">
        <${Field} k="dac_correction_enabled" />
        <div class="indent ${dacOn ? "" : "off"}">
          <${Field} k="dac_correction_profile" />
        </div>
      </div>
    <//>
    <${CrossfeedCard} />
    <${LoudnessCard} />
  <//>`;
};

const Volume = () =>
  html`<${Section}>
    <${PlaybackVolume} />
    <${VolumeRangeBar} />
    <div class="card-grid">
      <${Card} title="Fixed volume">
        <${Field} k="fixed_volume_enabled" />
        <div class="indent">
          <${Field} k="fixed_volume" />
          <${Field} k="optimal_iso" />
        </div>
      <//>
      <${Card} title="Automatic">
        <${Field} k="adaptive_volume" />
        <${Field} k="playlist_album_gain" />
      <//>
    </div>
  <//>`;

const info = computed(() => (health.value && health.value.info) || {});
const license = computed(() => (health.value && health.value.license) || {});

const licenseLabel = (l) => {
  if (!l || l.valid == null) return "";
  // anything that isn't an explicit false/trial reads as licensed -> TRUE
  const v = String(l.valid).toLowerCase();
  const trial = v === "" || v === "0" || v === "false" || v === "trial";
  return trial ? "FALSE" : "TRUE";
};

const About = () => {
  const i = info.value;
  const rows = [
    ["Product", i.product],
    ["Engine", i.engine],
    ["Licensed", licenseLabel(license.value)],
    ["Platform", i.platform],
  ].filter((r) => r[1]);
  return html`
    <dl class="about">
      ${rows.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}
    </dl>
  `;
};

// Inline-description visibility prefs. The master hides both the static feature
// notes and the per-selection option descriptions; the second checkbox — only
// live while the master is off — keeps the filter / DSD-source option
// descriptions visible even then.
const DescriptionPrefs = () => html`
  <div class="field">
    <label>Feature descriptions</label>
    <div class="control">
      <${Checkbox} value=${showDescriptions.value ? "1" : "0"} onChange=${(v) => setShowDescriptions(v === "1")} />
    </div>
    <div class="field-note">Show a manual note under each control</div>
  </div>
  <div class="field">
    <label>Option descriptions</label>
    <div class="control">
      <${Checkbox}
        value=${keepOptionDescriptions.value ? "1" : "0"}
        disabled=${showDescriptions.value}
        onChange=${(v) => setKeepOptionDescriptions(v === "1")}
      />
    </div>
    <div class="field-note">Keep filter and DSD source option descriptions when feature descriptions are hidden</div>
  </div>
`;

const ACCENT_LABELS = { blue: "Blue", green: "Phosphor green", amber: "Amber" };

const AccentPicker = () =>
  html`
    <div class="field">
      <label>Accent color</label>
      <div class="control accent-swatches">
        ${ACCENTS.map(
          (a) => html`
            <button
              type="button"
              class="swatch ${a} ${accent.value === a ? "active" : ""}"
              title=${ACCENT_LABELS[a]}
              aria-label=${ACCENT_LABELS[a]}
              aria-pressed=${accent.value === a}
              onClick=${() => applyAccent(a)}
            ></button>
          `,
        )}
      </div>
    </div>
  `;

// Logging card — full width at the bottom of the tab. The two log-config options
// sit side by side at the top; the live tail view (checkbox-gated) sits below.
const LoggingCard = () =>
  html`<${Card} title="Logging">
    <div class="log-opts">
      <${Field} k="log_enabled" />
      <${Field} k="log_file" />
    </div>
    <${LogTail} />
  <//>`;

const System = () =>
  html`<${Section}>
    <div class="card-grid">
      <${Card} title="About">
        <${About} />
      <//>
      <${BackupRestoreCard} />
    </div>
    <${HardwareCard} />
    <div class="card-grid">
      <${Card} title="DSP pipelines">
        <${Field} k="pipelines" />
      <//>
      <${Card} title="Metering">
        <${Field} k="pre_before_meter" />
      <//>
    </div>
    <${Card} title="HQPTuner">
      <div class="pack">
        <${DescriptionPrefs} />
        <${AccentPicker} />
      </div>
    <//>
    <${LoggingCard} />
  <//>`;

const TABS = [
  ["output", "Output", Output],
  ["resampling", "Resampling", Resampling],
  ["dsp", "DSP", Dsp],
  ["volume", "Volume", Volume],
  ["matrix", "Matrix", MatrixTab],
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
