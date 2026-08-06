// Output tab: Mode / Backend / Rate master switches, general engine options,
// the two backend sections, and DAC correction (it corrects the selected
// output device's signal).
import { signal, computed } from "@preact/signals";
import { html } from "../../lib/dom.js";
import { Field } from "../Field.js";
import { BypassNote } from "../MatrixBypassNote.js";
import { noteFor } from "../../store/prose.js";
import { effective } from "../../store/resolve.js";
import { optionsFor } from "../../store/options.js";
import { Section, Card, collapseFrom } from "./common.js";
import { truthy } from "../../lib/coerce.js";

// A backend section reveals itself when its backend is selected (or Combo, which
// runs both). Collapse is purely visual — every field still POSTs (the daemon
// rejects a partial form), so a hidden backend's config is never dropped. The
// user can also toggle manually; `override` (null = follow the backend) wins.
// `backend` is a string-valued control on every lane, so its effective value is
// a string wherever it is set at all.
const backend = () => /** @type {string} */ (effective("backend"));
const alsaOpen = computed(() => ["alsa", "combo"].includes(backend()));
const netOpen = computed(() => ["network", "combo"].includes(backend()));
const alsaOverride = signal(null);
const netOverride = signal(null);

// A device dropdown is "missing" when its selected value is blank, or points at
// an endpoint no longer in the form's option set — the silent empty entry the
// daemon leaves when a preset's output device (e.g. a powered-off NAA) is absent.
// (Empty option set = form not loaded yet; not an alarm.)
/**
 * @param {string} key the device control's schema key
 * @returns {boolean}
 */
function deviceMissing(key) {
  const opts = optionsFor("config", key);
  if (!opts.length) return false;
  const val = effective(key);
  if (val == null || String(val).trim() === "") return true;
  const match = opts.find((/** @type {OptionItem} */ o) => String(o.value) === String(val));
  return !match || String(match.label).trim() === "";
}

// Warn when the active backend has no real output device selected — a loaded
// preset referenced an endpoint that isn't present. Combo runs both backends.
function DeviceAlert() {
  const b = backend();
  const bad = [];
  if (["alsa", "combo"].includes(b) && deviceMissing("alsa_device")) bad.push("ALSA");
  if (["network", "combo"].includes(b) && deviceMissing("net_device")) bad.push("Network");
  if (!bad.length) return null;
  return html`<div class="device-alert">
    ⚠ No output device for the ${bad.join(" and ")} backend — the loaded preset's endpoint isn't present. Power the
    device on, then Rescan devices.
  </div>`;
}

// The two backend sections, each revealing itself when its backend is selected.
const AlsaCard = () => html`<${Card} title="ALSA Backend" collapse=${collapseFrom(alsaOpen, alsaOverride)}>
  <div class="pack">
    <${Field} k="alsa_device" />
    <${Field} k="alsa_offset" />
    <${Field} k="alsa_bits" />
    <${Field} k="alsa_period" />
    <${Field} k="alsa_dop" />
    <${Field} k="alsa_anydsd" />
  </div>
<//>`;

const NetCard = () => html`<${Card} title="Network Backend" collapse=${collapseFrom(netOpen, netOverride)}>
  <div class="pack">
    <${Field} k="net_device" />
    <${Field} k="net_bits" />
    <${Field} k="net_period" />
    <${Field} k="net_dop" />
    <${Field} k="net_anydsd" />
    <${Field} k="net_ipv6" />
  </div>
<//>`;

// Mode / Backend / Rate lead the tab as the three master switches.
export const Output = () => {
  const dacOn = truthy(effective("dac_correction_enabled"));
  return html`<${Section}>
    <${DeviceAlert} />
    <div class="top-row">
      <${Card} title="Backend" center=${true} cardClass="seg-box">
        <${Field} k="backend" />
      <//>
      <${Card} title="Mode" center=${true} cardClass="seg-box">
        <${Field} k="output_mode" />
      <//>
      <${Card} title="Rate" center=${true}>
        <div class="rate-stack">
          <${Field} k="pcm_rate" />
          <${Field} k="sdm_rate" />
        </div>
      <//>
    </div>
    <${Card} title="General">
      <div class="pack">
        <${Field} k="channels" />
        <${Field} k="gain_comp" />
        <${Field} k="idle_time" />
        <${Field} k="upnp_freewheel" />
        <${Field} k="quick_pause" />
        <${Field} k="short_buffer" />
        <${Field} k="junk_filter" />
        <${Field} k="pre_before_meter" />
      </div>
    <//>
    <${AlsaCard} />
    <${NetCard} />
    <${Card} title="DAC correction" subtitle=${noteFor("dac_correction_enabled")}>
      <div class="dsp-card">
        <${BypassNote} />
        <${Field} k="dac_correction_enabled" />
        <div class="dsp-body ${dacOn ? "" : "off"}">
          <${Field} k="dac_correction_profile" />
        </div>
      </div>
    <//>
  <//>`;
};
