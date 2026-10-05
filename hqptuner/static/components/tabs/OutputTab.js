// Output tab: Mode / Backend / Rate master switches, the conversion cards
// (pre-process, filter narrowing, the PCM/SDM chains),
// DAC correction (it corrects the selected output device's signal), and the
// two backend sections. Tuned-per-album cards sit above the set-once backend
// plumbing.
import { signal, computed } from "@preact/signals";
import { html } from "../../lib/dom.js";
import { Field } from "../widgets/Field.js";
import { BypassNote } from "../matrix/BypassNote.js";
import { noteFor } from "../../store/prose.js";
import { effective } from "../../store/resolve.js";
import { optionsFor } from "../../store/ui/options.js";
import { BACKEND_LABELS, fieldOf, localBackends } from "../../store/ui/backends.js";
import { NarrowBar } from "../narrowbar/Bar.js";
import { EasyCard } from "../easy/EasyCard.js";
import { easyMode } from "../../store/easy/easyview.js";
import { PrimerView } from "../primer/View.js";
import { primerOpen } from "../../store/primer/primerview.js";
import { Section, Card, collapseFrom } from "../common.js";
import { truthy } from "../../lib/coerce.js";
import { PreProcessCard, PcmChainCard, SdmChainCard } from "./ConversionCards.js";

// A backend section reveals itself when its backend is selected (or Combo, which
// runs them together). Collapse is purely visual — every field still POSTs (the
// daemon rejects a partial form), so a hidden backend's config is never dropped.
// The user can also toggle manually; `override` (null = follow the backend) wins.
// `backend` is a string-valued control on every lane, so its effective value is
// a string wherever it is set at all.
const backend = () => /** @type {string} */ (effective("backend"));
/** @param {string} name the section's own backend */
const disclosure = (name) => ({
  open: computed(() => [name, "combo"].includes(backend())),
  override: signal(null),
});
// One per backend that can own a section, whether or not this daemon has it.
const SECTIONS = Object.fromEntries(["alsa", "asio", "wasapi", "network"].map((name) => [name, disclosure(name)]));

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
  const bad = [...localBackends(), "network"].filter(
    (name) => [name, "combo"].includes(b) && deviceMissing(fieldOf(name, "device")),
  );
  if (!bad.length) return null;
  const names = bad.map((name) => BACKEND_LABELS[name]).join(" and ");
  return html`<div class="device-alert" data-backends=${bad.join(" ")}>
    ⚠ No output device for the ${names} backend — the loaded preset's endpoint isn't present. Power the
    device on, then Rescan devices.
  </div>`;
}

// The backend sections, each revealing itself when its backend is selected. A
// daemon's local backends (ALSA, or ASIO and WASAPI) share one layout.
/** @param {{ name: string }} props the local backend's wire value */
const LocalCard = ({ name }) => {
  const { open, override } = SECTIONS[name];
  return html`<${Card}
    id="${name}-backend"
    title="${BACKEND_LABELS[name]} Backend"
    collapse=${collapseFrom(open, override)}
  >
    <div class="pack">
      ${["device", "offset", "bits", "period", "dop", "anydsd"].map(
        (setting) => html`<${Field} key=${setting} k=${fieldOf(name, setting)} />`,
      )}
    </div>
  <//>`;
};

const NetCard =
  () => html`<${Card} id="network-backend" title="Network Backend" collapse=${collapseFrom(SECTIONS.network.open, SECTIONS.network.override)}>
  <div class="pack">
    <${Field} k="net_device" />
    <${Field} k="net_bits" />
    <${Field} k="net_period" />
    <${Field} k="net_dop" />
    <${Field} k="net_anydsd" />
    <${Field} k="net_ipv6" />
  </div>
<//>`;

// The filter half of the tab has three faces. Easy Mode and the primer each
// stand in for the whole group rather than for any one card, because the
// narrowing bar exists to make the two chain cards navigable and a chain card
// with no bar above it is the hard face without the tool that makes it usable.
// The primer wins when both flags are up: it is reached deliberately and left
// by its own Back, and the Easy Mode preference is still there when it is.
const FilterCards = () => {
  if (primerOpen.value) return html`<${PrimerView} />`;
  return easyMode.value
    ? html`<${EasyCard} />`
    : html`
        <${NarrowBar} />
        <${PcmChainCard} />
        <${SdmChainCard} />
      `;
};

// Mode / Backend / Rate lead the tab as the three master switches.
/** Output tab: backend, mode and rate switches, the conversion cards, DAC correction, and the backend cards. */
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
    ${localBackends().map((name) => html`<${LocalCard} key=${name} name=${name} />`)}
    <${NetCard} />
  <//>`;
};
