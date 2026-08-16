// Behavioral suite for components/tabs/OutputTab.js — the Output tab's rendered
// contract: the three master switches, the missing-device alert, the two backend
// disclosures and the DAC-correction card. The Conversion tab is gone: its cards
// (Pre-process, the narrowing bar, the two chains, Filter length) now live here,
// so this suite also pins the tab bar's four-entry shape, the merged card order,
// and that the retired tab id still lands a stale visitor on this body. The
// moved cards' own contracts are conversioncards.test.js's.
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
import { TabBar, TabBody } from "../../../hqptuner/static/components/tabs/index.js";
import { activeTab } from "../../../hqptuner/static/store/ui.js";
import { config, matrixConfig, metadata, engineState, enums } from "../../../hqptuner/static/store/signals.js";
import { discardAll } from "../../../hqptuner/static/store/actions.js";
import { showDescriptions, keepOptionDescriptions } from "../../../hqptuner/static/store/prefs.js";
import { resetNarrowing } from "../../../hqptuner/static/store/narrowing.js";
import { stagingWire } from "../support/wire.js";
import { classes, elements } from "../support/markup.js";
import { cardHeadAt, cardTitled, formFields, section, stateOf } from "../support/tabform.js";

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
  resetNarrowing();
  matrixConfig.value = { fields: formFields(mtx) };
  config.value = { fields: formFields(cfg), file, active: "", profiles: null };
  await discardAll();
}

const tab = () => render(html`<${Output} />`);

// One card's fragment, and where a card's head starts, both keyed by the title
// in that head and both blind to which element carries it (`cardTitled` /
// `cardHeadAt`, tests/js/support/tabform.js). Whether a card is a disclosure is
// its own behaviour — daccorrection-collapse.test.js, common.test.js — so the
// cases here neither assume it nor break on it.

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

// The class list the dsp-body wrapper carries, or null when the fragment
// renders no dsp-body at all — so "the card rendered no body" cannot read as
// "the body is not dimmed".
/** @param {string} frag */
const bodyClasses = (frag) => {
  const body = elements(frag).find((el) => classes(el).includes("dsp-body"));
  return body ? classes(body) : null;
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

// The reorganization moved the old General card's residents to the tabs that
// own them (Volume, System, Matrix) — the pre-process pair came BACK with the
// Conversion merge and is pinned as rendering here, in conversioncards.test.js.
// The form still CARRIES every moved field — the seed below stages them all —
// so an Output tab that kept rendering any of them would show it here.
const MOVED_AWAY = {
  channels: "Output Channels",
  gain_comp: "PCM gain compensation",
  idle_time: "Engine idle time",
  quick_pause: "Quick pause",
  short_buffer: "Short buffer",
  upnp_freewheel: "UPnP freewheel",
};
const MOVED_FORM = {
  channels: "2",
  gain_comp: "0.0",
  idle_time: "0",
  quick_pause: false,
  short_buffer: "0",
  upnp_freewheel: false,
  junk_filter: "0",
  pre_before_meter: false,
};

test("test_no_card_is_titled_general_any_more", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT, ...MOVED_FORM } });
  assert.equal(cardHeadAt(tab(), "General"), -1);
});

for (const [key, label] of Object.entries(MOVED_AWAY)) {
  test(`test_the_${key}_field_no_longer_renders_on_the_output_tab`, async () => {
    await reset({ cfg: { backend: "alsa", ...PRESENT, ...MOVED_FORM } });
    assert.equal(tab().includes(`<label>${label}`), false);
  });
}

// Top to bottom: the ENGAGE|BYPASS gate strip, then the body wrapper. The
// DAC model row must fall INSIDE the dsp-body's extent (opening tag to matching
// close), so a DAC model row rendered after the body's close, or above the gate,
// fails.
test("test_the_correction_profile_sits_in_a_body_below_the_gate_strip", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT }, mtx: { post_correction_enabled: true } });
  const frag = cardTitled(tab(), "DAC correction");
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
  const body = dspBody(cardTitled(tab(), "DAC correction"));
  assert.ok(body.startsWith('<div class="dsp-body off">') && body.includes("<label>DAC model</label>"));
});

// On state: the body wrapper is rendered AND carries no dimming mark. A card
// that renders no body at all is a regression, not a pass, so the live case
// pins the wrapper's presence rather than the absence of a substring.
test("test_the_correction_profile_is_live_once_dac_correction_is_on", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT }, mtx: { post_correction_enabled: true } });
  const cls = bodyClasses(cardTitled(tab(), "DAC correction"));
  assert.ok(cls !== null && !cls.includes("off"));
});

// The old indented layout is gone from this card entirely. The card must be
// FOUND for that to mean anything: `cardTitled` answers "" for a card that never
// rendered, and "" carries no indent either.
test("test_the_dac_correction_card_has_no_indented_layout", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT }, mtx: { post_correction_enabled: false } });
  const out = tab();
  assert.ok(
    cardHeadAt(out, "DAC correction") >= 0 && !cardTitled(out, "DAC correction").includes('<div class="indent'),
  );
});

test("test_the_dac_correction_card_carries_the_correction_profile", async () => {
  await reset({ cfg: { backend: "alsa", ...PRESENT }, mtx: { post_correction_enabled: true } });
  assert.ok(cardTitled(tab(), "DAC correction").includes("<label>DAC model</label>"));
});

// --- the merged tab ------------------------------------------------------------
// The Conversion tab is gone. The bar offers exactly four tabs; its cards now
// stand on this tab in a fixed order; and the retired id "resampling", left in a
// stale visitor's saved UI state, still lands on this body rather than on a
// blank page.

/**
 * @param {string} value
 * @param {string} label
 */
const opt = (value, label) => ({ value, options: [{ value, label }] });
const CHAINS = {
  filter1x: opt("1", "poly-sinc-gauss-long"),
  filter: opt("2", "poly-sinc-xtr-mp"),
  oversampling1x: opt("3", "poly-sinc-short-mp"),
  oversampling: opt("4", "closed-form-M"),
};
const PREP = { junk_filter: "0", pre_before_meter: false };
const FULL = { backend: "alsa", ...PRESENT, ...CHAINS, ...PREP };

// A tab button's visible label, accents and markup stripped. Buttons are cut
// out by string index rather than one lazy regex (sonarjs/super-linear-regex);
// the tag strip is the suite's excluded-bracket precedent.
/** @param {string} out */
const tabLabels = (out) =>
  out
    .split("</button>")
    .slice(0, -1)
    .map((chunk) => chunk.slice(chunk.lastIndexOf("<button")))
    .map((btn) => btn.replace(/<[^<>]*>/g, "").trim());

test("test_the_tab_bar_offers_exactly_output_volume_matrix_system_in_order", async () => {
  await reset({ cfg: FULL });
  assert.deepEqual(tabLabels(render(html`<${TabBar} />`)), ["Output", "Volume", "Matrix", "System"]);
});

test("test_no_tab_is_labelled_conversion", async () => {
  await reset({ cfg: FULL });
  assert.equal(render(html`<${TabBar} />`).includes("Conversion"), false);
});

test("test_no_tab_is_labelled_resampling", async () => {
  await reset({ cfg: FULL });
  assert.equal(render(html`<${TabBar} />`).includes("Resampling"), false);
});

test("test_a_stale_resampling_tab_id_renders_the_output_tab_body", async () => {
  await reset({ cfg: FULL });
  activeTab.value = "resampling";
  assert.ok(render(html`<${TabBody} />`).includes('<div class="card-head center">Backend</div>'));
});

// Top to bottom: the Backend/Mode/Rate top row, then the moved Conversion cards,
// then the cards that were already Output's. Each landmark is the card's own
// head, found by its title whatever element carries it, so the ORDER is what
// this pins and a card changing its disclosure does not move it. The narrowing
// bar is no card and has no head, so it is the one landmark located by its text.
const CARD_ORDER = [
  { head: "Backend" },
  { head: "Pre-process" },
  { text: "Narrow filters" },
  { head: "PCM Chain" },
  { head: "SDM Chain" },
  { head: "Filter length" },
  { head: "DAC correction" },
  { head: "ALSA Backend" },
  { head: "Network Backend" },
];

test("test_the_merged_cards_stand_in_order_from_the_top_row_to_the_backends", async () => {
  await reset({ cfg: FULL });
  const out = tab();
  const at = CARD_ORDER.map((mark) =>
    mark.head === undefined ? out.indexOf(String(mark.text)) : cardHeadAt(out, mark.head),
  );
  assert.ok(
    at.every((pos, i) => pos >= 0 && (i === 0 || pos > at[i - 1])),
    `landmarks out of order: ${at}`,
  );
});

test("test_a_missing_device_still_warns_above_the_top_row", async () => {
  await reset({ cfg: { ...FULL, alsa_device: alsaDev("") } });
  const out = tab();
  const alert = out.indexOf("No output device for the ALSA backend");
  assert.ok(alert >= 0 && alert < out.indexOf('<div class="card-head center">Backend</div>'));
});
