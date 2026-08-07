// Behavioral suite for components/tabs/OutputTab.js — the Output tab's rendered
// contract: the three master switches, the missing-device alert, the two backend
// disclosures and the DAC-correction card.
//
// Policy (docs/testing.md): public API only, one assertion per test.
// `DeviceAlert`, `deviceMissing` and the two override signals are private and
// stay that way — every case here goes through the exported `Output`, driven by
// the exported store signals (`config`, `matrixConfig`) carrying the daemon's own
// /config and /matrix forms, over a faked wire on the real REST paths.
//
// Which BACKEND section auto-opens is a pure function of the form's `backend`
// value, so it is observable here. Which one the user has manually toggled is
// not: `alsaOverride` / `netOverride` are module-private and written only from
// the disclosure head's onClick, which SSR never fires. Exporting them to reach
// the manual branch would widen the public surface to serve a test, so the
// manual-override half of the disclosure is covered in common.test.js against
// Collapsible's own props instead, and the wiring of a MANUAL toggle on this tab
// is left to the playwright hand-back protocol.
//
// State reset is total on every call: module-level signals outlive a test, so a
// partial reset makes cases pass alone and fail in sequence.
//
// Run: node --import ./tests/js/vendor-resolve.js --test tests/js/outputtab.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../hqptuner/static/lib/dom.js";
import { Output } from "../../../hqptuner/static/components/tabs/OutputTab.js";
import { config, matrixConfig, metadata, engineState, enums } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { stagingWire } from "../support/wire.js";
import { formFields, section, stateOf } from "../support/tabform.js";

/** @typedef {import("../support/tabform.js").FieldSpec} FieldSpec */

/**
 * @param {{
 *   cfg?: Record<string, FieldSpec>,
 *   mtx?: Record<string, FieldSpec>,
 *   file?: Record<string, string>,
 * }} [opts]
 */
async function reset({ cfg = {}, mtx = {}, file = { mode: "auto" } } = {}) {
  stagingWire();
  engineState.value = {};
  enums.value = null;
  metadata.value = null;
  showDescriptions.value = true;
  keepOptionDescriptions.value = true;
  matrixConfig.value = { fields: formFields(mtx) };
  config.value = { fields: formFields(cfg), file, active: "", profiles: null };
  await discardAll();
}

const tab = () => render(html`<${Output} />`);

// One card's fragment, from its head to its close. Cards on this tab carry no
// nested <section>, so the first close after the head is the card's own.
/**
 * @param {string} out
 * @param {string} title
 */
const card = (out, title) => {
  const head = out.indexOf(`<div class="card-head">${title}</div>`);
  return head < 0 ? "" : out.slice(head, out.indexOf("</section>", head));
};

// The dsp-body wrapper's full extent: from its opening tag to its matching
// close, tracked by <div>/</div> depth so nested row divs stay inside. Empty
// string when the fragment carries no dsp-body at all.
/** @param {string} frag */
const dspBody = (frag) => {
  const start = frag.indexOf('<div class="dsp-body');
  if (start < 0) return "";
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m; (m = re.exec(frag));) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return frag.slice(start, m.index + m[0].length);
  }
  return frag.slice(start);
};

const ALSA = "ALSA Backend";
const NET = "Network Backend";
// Device option sets with distinguishable labels, so a section can be shown to
// carry ITS OWN device list rather than merely "a device list".
const ALSA_DEVICES = [
  { value: "", label: "" },
  { value: "hw:0", label: "Topping DAC" },
];
const NET_DEVICES = [
  { value: "", label: "" },
  { value: "naa:1", label: "Living room NAA" },
];
/** @param {string} value */
const alsaDev = (value) => ({ value, options: ALSA_DEVICES });
/** @param {string} value */
const netDev = (value) => ({ value, options: NET_DEVICES });
// Both backends pointed at a device that is actually present.
const PRESENT = { alsa_device: alsaDev("hw:0"), net_device: netDev("naa:1") };

// --- master switches ----------------------------------------------------------

test("test_the_backend_switch_leads_the_tab", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT } });
  assert.ok(tab().includes('<div class="card-head center">Backend</div>'));
});

test("test_the_mode_switch_leads_the_tab", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT } });
  assert.ok(tab().includes('<div class="card-head center">Mode</div>'));
});

test("test_the_rate_box_carries_the_pcm_family_rate", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT } });
  assert.ok(tab().includes("<label>PCM</label>"));
});

test("test_the_rate_box_carries_the_sdm_family_rate", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT } });
  assert.ok(tab().includes("<label>SDM</label>"));
});

test("test_the_selected_backend_reads_back_on_its_segment", async () => {
  await reset({ cfg: { backend: "combo", ...PRESENT } });
  assert.ok(tab().includes('<button type="button" class="seg active">Combo</button>'));
});

// --- backend disclosures ------------------------------------------------------

test("test_the_alsa_section_opens_for_the_alsa_backend", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT } });
  assert.equal(stateOf(tab(), ALSA), "open");
});

test("test_the_alsa_section_closes_for_the_network_backend", async () => {
  await reset({ cfg: { backend: "network", ...PRESENT } });
  assert.equal(stateOf(tab(), ALSA), "closed");
});

test("test_the_alsa_section_opens_for_the_combo_backend", async () => {
  await reset({ cfg: { backend: "combo", ...PRESENT } });
  assert.equal(stateOf(tab(), ALSA), "open");
});

test("test_the_network_section_opens_for_the_network_backend", async () => {
  await reset({ cfg: { backend: "network", ...PRESENT } });
  assert.equal(stateOf(tab(), NET), "open");
});

test("test_the_network_section_closes_for_the_alsa_backend", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT } });
  assert.equal(stateOf(tab(), NET), "closed");
});

test("test_the_network_section_opens_for_the_combo_backend", async () => {
  await reset({ cfg: { backend: "combo", ...PRESENT } });
  assert.equal(stateOf(tab(), NET), "open");
});

test("test_the_alsa_section_carries_the_alsa_device_list", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT } });
  assert.ok(section(tab(), ALSA).includes("Topping DAC"));
});

test("test_the_network_section_carries_the_network_device_list", async () => {
  await reset({ cfg: { backend: "network", ...PRESENT } });
  assert.ok(section(tab(), NET).includes("Living room NAA"));
});

test("test_a_closed_backend_section_hides_its_device_list", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT } });
  assert.equal(section(tab(), NET).includes("Living room NAA"), false);
});

test("test_the_alsa_section_offers_a_rescan_for_a_device_that_reappears", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT } });
  assert.ok(section(tab(), ALSA).includes("⟳ Rescan devices"));
});

// --- missing-device alert -----------------------------------------------------

test("test_a_blank_alsa_device_warns_that_the_backend_has_no_output", async () => {
  await reset({ cfg: { backend: "alsa", alsa_device: alsaDev(""), net_device: netDev("naa:1") } });
  assert.ok(tab().includes("No output device for the ALSA backend"));
});

test("test_a_device_that_left_the_option_set_warns", async () => {
  await reset({ cfg: { backend: "alsa", alsa_device: alsaDev("hw:9"), net_device: netDev("naa:1") } });
  assert.ok(tab().includes("No output device for the ALSA backend"));
});

test("test_a_device_that_is_present_raises_no_warning", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT } });
  assert.equal(tab().includes("device-alert"), false);
});

test("test_an_unloaded_form_raises_no_warning", async () => {
  await reset({ cfg: { backend: "alsa" } });
  assert.equal(tab().includes("device-alert"), false);
});

test("test_the_inactive_backends_missing_device_raises_no_warning", async () => {
  await reset({ cfg: { backend: "alsa", alsa_device: alsaDev("hw:0"), net_device: netDev("") } });
  assert.equal(tab().includes("device-alert"), false);
});

test("test_the_network_backend_warns_about_its_own_missing_device", async () => {
  await reset({ cfg: { backend: "network", alsa_device: alsaDev(""), net_device: netDev("") } });
  assert.ok(tab().includes("No output device for the Network backend"));
});

test("test_combo_names_both_backends_when_neither_has_a_device", async () => {
  await reset({ cfg: { backend: "combo", alsa_device: alsaDev(""), net_device: netDev("") } });
  assert.ok(tab().includes("No output device for the ALSA and Network backend"));
});

test("test_the_alert_says_how_to_recover_the_device", async () => {
  await reset({ cfg: { backend: "alsa", alsa_device: alsaDev(""), net_device: netDev("naa:1") } });
  assert.ok(tab().includes("then Rescan devices"));
});

// --- cards --------------------------------------------------------------------

test("test_the_general_card_carries_the_high_frequency_filter", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT } });
  assert.ok(card(tab(), "General").includes("<label>High-frequency filter"));
});

test("test_the_general_card_carries_pre_process_before_metering", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT } });
  assert.ok(card(tab(), "General").includes("<label>Pre-process before metering</label>"));
});

test("test_the_general_card_leaves_the_device_lists_to_the_backend_sections", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT } });
  assert.equal(card(tab(), "General").includes("Topping DAC"), false);
});

// Top to bottom: the ENGAGE|BYPASS gate strip, then the body wrapper. The
// DAC model row must fall INSIDE the dsp-body's extent (opening tag to matching
// close), so a DAC model row rendered after the body's close, or above the gate,
// fails.
test("test_the_correction_profile_sits_in_a_body_below_the_gate_strip", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT }, mtx: { post_correction_enabled: true } });
  const frag = card(tab(), "DAC correction");
  const gate = frag.indexOf('<span class="segment">');
  assert.ok(
    gate >= 0 && gate < frag.indexOf('<div class="dsp-body') && dspBody(frag).includes("<label>DAC model</label>"),
  );
});

// Off state: the body wrapper carries the `off` class AND the DAC model row sits
// inside its extent — a dimmed wrapper with the row rendered outside it
// would dim nothing.
test("test_the_correction_profile_is_dimmed_while_dac_correction_is_off", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT }, mtx: { post_correction_enabled: false } });
  const body = dspBody(card(tab(), "DAC correction"));
  assert.ok(body.startsWith('<div class="dsp-body off">') && body.includes("<label>DAC model</label>"));
});

test("test_the_correction_profile_is_live_once_dac_correction_is_on", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT }, mtx: { post_correction_enabled: true } });
  assert.equal(card(tab(), "DAC correction").includes('<div class="dsp-body off">'), false);
});

// The old indented layout is gone from this card entirely.
test("test_the_dac_correction_card_has_no_indented_layout", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT }, mtx: { post_correction_enabled: false } });
  assert.equal(card(tab(), "DAC correction").includes('<div class="indent'), false);
});

test("test_the_dac_correction_card_carries_the_correction_profile", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT }, mtx: { post_correction_enabled: true } });
  assert.ok(card(tab(), "DAC correction").includes("<label>DAC model</label>"));
});
