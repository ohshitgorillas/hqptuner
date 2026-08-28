// Output tab: Mode / Backend / Rate master switches, the conversion cards
// (pre-process, filter narrowing, the PCM/SDM chains),
// DAC correction (it corrects the selected output device's signal), and the
// two backend sections. Tuned-per-album cards sit above the set-once backend
// plumbing.
import { signal, computed } from "@preact/signals";
import { html } from "../../lib/dom.js";
import { Field } from "../Field.js";
import { BypassNote } from "../matrix/BypassNote.js";
import { noteFor } from "../../store/prose.js";
import { effective } from "../../store/resolve.js";
import { optionsFor } from "../../store/options.js";
import { NarrowBar } from "../narrowbar/Bar.js";
import { EasyCard } from "../easy/EasyCard.js";
import { easyMode } from "../../store/easyview.js";
import { Section, Card, collapseFrom } from "../common.js";
import { truthy } from "../../lib/coerce.js";
import { PreProcessCard, PcmChainCard, SdmChainCard } from "./ConversionCards.js";

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

// DAC correction applies in every mode and on every backend, so there is no
// automatic disclosure for it to follow: it stands open until the user folds it.
const dacOpen = signal(true);

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
//
// `data-backends` carries the backends the alert is about as their wire values,
// so which one tripped is readable without parsing the sentence for its
// display names.
function DeviceAlert() {
  const b = backend();
  /** @type {[string, string][]} wire value, display name */
  const bad = [];
  if (["alsa", "combo"].includes(b) && deviceMissing("alsa_device")) bad.push(["alsa", "ALSA"]);
  if (["network", "combo"].includes(b) && deviceMissing("net_device")) bad.push(["network", "Network"]);
  if (!bad.length) return null;
  const names = bad.map(([, n]) => n).join(" and ");
  return html`<div class="device-alert" data-backends=${bad.map(([v]) => v).join(" ")}>
    ⚠ No output device for the ${names} backend — the loaded preset's endpoint isn't present. Power the
    device on, then Rescan devices.
  </div>`;
}

// The two backend sections, each revealing itself when its backend is selected.
const AlsaCard =
  () => html`<${Card} id="alsa-backend" title="ALSA Backend" collapse=${collapseFrom(alsaOpen, alsaOverride)}>
  <div class="pack">
    <${Field} k="alsa_device" />
    <${Field} k="alsa_offset" />
    <${Field} k="alsa_bits" />
    <${Field} k="alsa_period" />
    <${Field} k="alsa_dop" />
    <${Field} k="alsa_anydsd" />
  </div>
<//>`;

const NetCard =
  () => html`<${Card} id="network-backend" title="Network Backend" collapse=${collapseFrom(netOpen, netOverride)}>
  <div class="pack">
    <${Field} k="net_device" />
    <${Field} k="net_bits" />
    <${Field} k="net_period" />
    <${Field} k="net_dop" />
    <${Field} k="net_anydsd" />
    <${Field} k="net_ipv6" />
  </div>
<//>`;

// The filter half of the tab has two faces. Easy Mode stands in for the whole
// group rather than for any one card, because the narrowing bar exists to make
// the two chain cards navigable and a chain card with no bar above it is the
// hard face without the tool that makes it usable.
const FilterCards = () =>
  easyMode.value
    ? html`<${EasyCard} />`
    : html`
        <${NarrowBar} />
        <${PcmChainCard} />
        <${SdmChainCard} />
      `;

// Mode / Backend / Rate lead the tab as the three master switches.
/** Output tab: backend, mode and rate switches, the conversion cards, DAC correction, and the ALSA and network cards. */
export const Output = () => {
  const dacOn = truthy(effective("dac_correction_enabled"));
  return html`<${Section}>
    <${DeviceAlert} />
    <div class="top-row">
      <${Card} id="backend" title="Backend" center=${true} cardClass="seg-box">
        <${Field} k="backend" />
      <//>
      <${Card} id="mode" title="Mode" center=${true} cardClass="seg-box">
        <${Field} k="output_mode" />
      <//>
      <${Card} id="rate" title="Rate" center=${true}>
        <div class="rate-stack">
          <${Field} k="pcm_rate" />
          <${Field} k="sdm_rate" />
        </div>
      <//>
    </div>
    <${PreProcessCard} />
    <${FilterCards} />
    <${Card}
      id="dac-correction"
      title="DAC correction"
      subtitle=${noteFor("dac_correction_enabled")}
      collapse=${{ open: dacOpen.value, onToggle: () => (dacOpen.value = !dacOpen.value) }}
    >
      <div class="dsp-card">
        <${BypassNote} on=${dacOn} />
        <${Field} k="dac_correction_enabled" />
        <div class="dsp-body ${dacOn ? "" : "off"}">
          <${Field} k="dac_correction_profile" />
        </div>
      </div>
    <//>
    <${AlsaCard} />
    <${NetCard} />
  <//>`;
};
