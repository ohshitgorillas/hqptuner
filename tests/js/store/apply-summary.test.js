// Behavioral suite for the store core's apply summary (`summarize`, reached
// through `applyAll`). Written BEFORE the complexity refactor of it (19).
//
// It is not exported, and should not be: its contract is what the public
// functions return. Everything below drives it the way the app does, over the
// fake wire in tests/js/support/threetrees.js. No store function is stubbed.

import test from "node:test";
import assert from "node:assert/strict";

import { edit, applyAll, lastApply, discardAll } from "../../../hqptuner/static/store/actions.js";
import { refreshConfig } from "../../../hqptuner/static/store/sync.js";
import { bad, ok } from "../support/wire/wire.js";
import { env, route, trees, field } from "../support/threetrees.js";

// --- summarize: failures outrank everything ---------------------------------

// The verdict's `code` and the data fields beside it are what these read; the
// sentence built from them is owner copy (docs/testing.md rule 9).

/**
 * The verdict the last apply recorded. `lastApply.value` is nullable by design,
 * so that a verdict field that does not exist stops type-checking clean;
 * reading a field off it needs narrowing, and a case whose apply recorded
 * nothing has lost its own premise rather than its assertion. Refusing here
 * keeps that separate from the one assertion each case is allowed.
 *
 * @param {typeof lastApply} signal
 * @returns {NonNullable<typeof lastApply.value>}
 */
function verdict(signal) {
  if (signal.value === null) throw new Error("expected an apply verdict, none was recorded");
  return signal.value;
}

test("test_a_failed_live_setting_is_reported_by_name", async () => {
  await trees();
  route({ apply: { live: [{ setting: "filter", ok: false }] } });
  await applyAll();
  assert.deepEqual(verdict(lastApply).settings, ["filter"]);
});

test("test_several_failed_live_settings_are_listed", async () => {
  await trees();
  route({
    apply: {
      live: [
        { setting: "a", ok: false },
        { setting: "b", ok: false },
        { setting: "c", ok: true },
      ],
    },
  });
  await applyAll();
  assert.deepEqual(verdict(lastApply).settings, ["a", "b"]);
});

test("test_a_live_failure_outranks_a_switch_and_a_failed_save", async () => {
  await trees();
  route({
    apply: { live: [{ setting: "a", ok: false }], switched: { name: "N" } },
    saved: { ok: false },
  });
  await applyAll();
  assert.equal(verdict(lastApply).code, "live-failed");
});

// A failed live entry may carry the setter's error `code` (a wire identifier).
// `daemon_unavailable` anywhere in the report is a different verdict from a
// refusal; a report carrying only `daemon_refused`, or no code at all, is the
// plain live failure the cases above pin.

test("test_any_unavailable_live_failure_yields_live_unavailable_and_refused_or_uncoded_keep_live_failed", async () => {
  await trees();
  const codes = [];
  route({
    apply: {
      live: [
        { setting: "a", ok: false, code: "daemon_refused" },
        { setting: "b", ok: false, code: "daemon_unavailable" },
      ],
    },
  });
  await applyAll();
  codes.push(verdict(lastApply).code);
  route({ apply: { live: [{ setting: "a", ok: false, code: "daemon_refused" }] } });
  await applyAll();
  codes.push(verdict(lastApply).code);
  route({ apply: { live: [{ setting: "a", ok: false }] } });
  await applyAll();
  codes.push(verdict(lastApply).code);
  assert.deepEqual(codes, ["live-unavailable", "live-failed", "live-failed"]);
});

test("test_live_unavailable_lists_every_failed_setter_refused_ones_included_in_report_order", async () => {
  await trees();
  // the refused one comes first, so a verdict keyed on the first failure alone
  // would read this report as a plain live failure
  route({
    apply: {
      live: [
        { setting: "a", ok: false, code: "daemon_refused" },
        { setting: "b", ok: false, code: "daemon_unavailable" },
        { setting: "c", ok: true },
      ],
    },
  });
  await applyAll();
  assert.deepEqual([verdict(lastApply).code, verdict(lastApply).settings], ["live-unavailable", ["a", "b"]]);
});

test("test_a_failed_apply_is_not_ok", async () => {
  await trees();
  route({ apply: { live: [{ setting: "filter", ok: false }] } });
  await applyAll();
  assert.equal(verdict(lastApply).ok, false);
});

// --- summarize: the switch --------------------------------------------------

test("test_a_successful_switch_is_reported_as_switched", async () => {
  await trees();
  route({ apply: { switched: { name: "Night" } } });
  await applyAll();
  assert.equal(verdict(lastApply).code, "switched");
});

// Unloading the active preset switches to the nameless "(no preset)" option: an
// empty name is a real switch and must not degrade the verdict.
test("test_a_switch_to_the_nameless_preset_still_reads_as_switched", async () => {
  await trees();
  route({ apply: { switched: { name: "" } } });
  await applyAll();
  assert.equal(verdict(lastApply).code, "switched");
});

// --- summarize: the persistent lane -----------------------------------------

test("test_a_missing_endpoint_is_named_rather_than_reported_generically", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, unfixable: { net_device: { want: "NAA1" } }, error: "e" } } });
  await applyAll();
  assert.equal(verdict(lastApply).endpoint, "NAA1");
});

test("test_a_missing_endpoint_outranks_the_generic_error_beside_it", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, unfixable: { net_device: { want: "NAA1" } }, error: "e" } } });
  await applyAll();
  assert.equal(verdict(lastApply).code, "endpoint-missing");
});

test("test_a_persistent_error_is_reported_as_an_error", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, error: "boom" } } });
  await applyAll();
  assert.equal(verdict(lastApply).code, "persist-error");
});

// The daemon's own reason is the only thing that tells the user what went
// wrong, so it must survive the trip to the caption. The test invents it, which
// is why asserting it back pins no shipped wording.
test("test_the_daemons_own_error_reaches_the_user", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, error: "boom" } } });
  await applyAll();
  assert.ok(String(verdict(lastApply).text).includes("boom"));
});

test("test_a_persistent_refusal_reports_its_reason", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, reason: "timeout" } } });
  await applyAll();
  assert.equal(verdict(lastApply).reason, "timeout");
});

// "unconverged" alone is undebuggable: it says a setting the daemon kept
// refusing exists, but not which one — and the user is the only one who can see
// their own config.
test("test_an_unconverged_apply_names_the_fields_that_diverged", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, reason: "unconverged", diff: { volume_max: {}, alsa_dop: {} } } } });
  await applyAll();
  assert.deepEqual(verdict(lastApply).fields, ["volume_max", "alsa_dop"]);
});

// The user knows a setting by the label the page gives it, not by the daemon's
// config key. A label is copy (docs/testing.md rule 9), so no assertion holds
// one: a sentence that names its field reads differently for two fields, and a
// labelled field is never shown by its wire key.

/** @param {Record<string, unknown>} diff */
async function unconverged(diff) {
  await trees();
  route({ apply: { persistent: { applied: false, reason: "unconverged", diff } } });
  await applyAll();
  return String(verdict(lastApply).text);
}

test("test_unconverged_applies_on_two_different_fields_read_differently", async () => {
  const maximum = await unconverged({ volume_max: {} });
  const fixed = await unconverged({ volume_fixed: {} });
  assert.notEqual(maximum, fixed);
});

test("test_an_unconverged_apply_shows_a_labelled_field_without_its_wire_key", async () => {
  const text = await unconverged({ volume_max: {} });
  assert.ok(!text.includes("volume_max"), text);
});

// `volume_fixed` is the daemon's key for the control the page keys as
// `optimal_iso`, so a lookup by the wire key alone finds no label for it and
// falls back to showing the key.
test("test_an_unconverged_apply_shows_a_field_read_under_another_key_without_its_wire_key", async () => {
  const text = await unconverged({ volume_fixed: {} });
  assert.ok(!text.includes("volume_fixed"), text);
});

// The reason code is wire vocabulary; the sentence around the labels says what
// it means in plain words instead.
test("test_an_unconverged_apply_does_not_show_its_reason_code", async () => {
  const text = await unconverged({ volume_max: {} });
  assert.ok(!text.includes("unconverged"), text);
});

// --- summarize: a failed live write, in the page's words ------------------------
// A live setter that failed is named by the label the page gives its control,
// never by the daemon's form key. A refusal carries the daemon's own reason
// (architecture.md §8.2: `{ok: false, error, code}` per setter), which the
// fixture invents, so asserting it back pins no shipped wording. Labels are
// copy and stay out of every assertion (docs/testing.md rule 9).

// The daemon's form keys for the PCM chain's two filter slots, each owned by a
// control on the page (tests/js/components/controls/combobox-favstars.test.js).
const PCM_1X = "filter1x";
const PCM_NX = "filter";
// Keys no control on the page owns: with no label to show, each stands for itself.
const UNLABELLED = "no_control_owns_this_key";
const ALSO_UNLABELLED = "nor_does_any_own_this_one";
// The reason a refused SetFilter carries (protocol.md, simple-command replies).
const DAEMON_REASON = "invalid filter";
const STALL = "no reply";

/** @param {{ setting: string, code: string, error: string }[]} failures */
async function liveFailure(failures) {
  await trees();
  route({ apply: { live: failures.map((f) => ({ ok: false, ...f })) } });
  await applyAll();
  return String(verdict(lastApply).text);
}

/** @param {string} setting */
const refused = (setting) => ({ setting, code: "daemon_refused", error: DAEMON_REASON });
/** @param {string} setting */
const stalled = (setting) => ({ setting, code: "daemon_unavailable", error: STALL });

test("test_refusals_of_two_different_live_settings_read_differently", async () => {
  const oneX = await liveFailure([refused(PCM_1X)]);
  const nX = await liveFailure([refused(PCM_NX)]);
  assert.notEqual(oneX, nX);
});

test("test_a_refused_live_setting_is_shown_without_its_wire_key", async () => {
  const text = await liveFailure([refused(PCM_1X)]);
  assert.ok(!text.includes(PCM_1X), text);
});

test("test_a_refused_live_setting_gives_the_daemons_reason", async () => {
  const text = await liveFailure([refused(PCM_1X)]);
  assert.ok(text.includes(DAEMON_REASON), text);
});

test("test_every_live_setting_the_daemon_stopped_answering_on_is_named", async () => {
  const text = await liveFailure([stalled(UNLABELLED), stalled(ALSO_UNLABELLED)]);
  assert.deepEqual(
    [UNLABELLED, ALSO_UNLABELLED].map((key) => text.includes(key)),
    [true, true],
    text,
  );
});

test("test_a_live_setting_the_daemon_stopped_answering_on_is_shown_without_its_wire_key", async () => {
  const text = await liveFailure([stalled(PCM_1X)]);
  assert.ok(!text.includes(PCM_1X), text);
});

test("test_a_persistent_refusal_with_no_reason_is_still_a_refusal", async () => {
  await trees();
  route({ apply: { persistent: { applied: false } } });
  await applyAll();
  assert.equal(verdict(lastApply).code, "persist-refused");
});

/** @type {[string, Record<string, unknown>, string][]} */
const CREDENTIAL_REFUSALS = [
  [
    "with_its_sentence",
    { code: "no_credentials", error: "A fixture sentence about credentials." },
    "persist-credentials",
  ],
  ["without_its_sentence", { code: "no_credentials" }, "persist-refused"],
];

for (const [id, refusal, expected] of CREDENTIAL_REFUSALS) {
  test(`test_a_credential_refusal_${id}_reads_as_${expected}`, async () => {
    await trees();
    route({ apply: { persistent: { applied: false, ...refusal } } });
    await applyAll();
    assert.equal(verdict(lastApply).code, expected);
  });
}

// --- summarize: change counts -----------------------------------------------

test("test_an_apply_with_nothing_staged_counts_no_changes", async () => {
  await trees();
  await discardAll();
  route({ apply: {} });
  await applyAll();
  assert.equal(verdict(lastApply).changes, 0);
});

test("test_a_single_change_is_counted_as_one", async () => {
  await trees({ fields: [field("volume_max", "-3")] });
  route({ staged: { live: {}, http: { volume_max: "-6" } } });
  await edit("volume_max", "-6");
  route({ apply: {}, staged: { live: {}, http: { volume_max: "-6" } } });
  await applyAll();
  assert.equal(verdict(lastApply).changes, 1);
});

test("test_a_switch_and_edits_are_reported_together", async () => {
  await trees({ fields: [field("volume_max", "-3")] });
  route({ staged: { live: {}, http: { volume_max: "-6" } } });
  await edit("volume_max", "-6");
  route({ apply: { switched: { name: "N" } }, staged: { live: {}, http: { volume_max: "-6" } } });
  await applyAll();
  assert.deepEqual([verdict(lastApply).code, verdict(lastApply).changes], ["switched", 1]);
});

// --- summarize: the save lane -----------------------------------------------

// A save rides its own axis on the verdict, because an apply and a save can end
// differently and one code cannot carry both.

test("test_a_successful_save_rides_alongside_the_apply", async () => {
  await trees();
  await discardAll();
  route({ saved: { name: "P" } });
  await applyAll();
  assert.equal(verdict(lastApply).save, "ok");
});

test("test_a_failed_save_is_appended_and_makes_the_apply_not_ok", async () => {
  await trees();
  await discardAll();
  route({ refusal: bad(502, "disk") });
  await applyAll().catch(() => {});
  assert.equal(verdict(lastApply).ok, false);
});

test("test_a_failed_save_is_reported_as_failed", async () => {
  await trees();
  await discardAll();
  route({ refusal: bad(502, "disk") });
  await applyAll().catch(() => {});
  assert.equal(verdict(lastApply).code, "lane-failed");
});

// As with the persistent lane's daemon error above: the error string is
// test-invented, so asserting it back pins no shipped wording.
test("test_the_save_errors_own_text_reaches_the_user", async () => {
  await trees();
  await discardAll();
  route({ refusal: bad(502, "disk") });
  await applyAll().catch(() => {});
  assert.ok(String(verdict(lastApply).text).includes("disk"));
});

// A WARNED save is a save: only hqplayerd's own mirror of the preset is behind,
// so the caveat rides a success rather than turning it into a failure. Reporting
// it as failed is what sent a user hunting for a preset already on disk.

test("test_a_warned_save_is_reported_as_warned", async () => {
  await trees();
  await discardAll();
  route({ saved: { name: "P", warning: "list not updated" } });
  await applyAll();
  assert.equal(verdict(lastApply).save, "warned");
});

test("test_a_warned_save_is_still_ok", async () => {
  await trees();
  await discardAll();
  route({ saved: { name: "P", warning: "list not updated" } });
  await applyAll();
  assert.equal(verdict(lastApply).ok, true);
});

// --- summarize: transport failure -------------------------------------------

test("test_a_rejected_apply_request_is_reported_rather_than_swallowed", async () => {
  await trees();
  env.fetch = async (/** @type {string} */ path) => {
    if (path === "/api/config/apply") return { ok: false, status: 503, json: async () => ({}) };
    return ok({});
  };
  await assert.rejects(() => applyAll());
});

// --- summarize: a live edit HQPTuner refused before sending it ------------------
// A live setter that never reached HQPlayer comes back with code `invalid_input`
// (architecture.md §8.2): HQPTuner judged the value unusable itself. It is still
// named by the label the page gives its control, and it does not read as a
// refusal by HQPlayer. Labels are copy and stay out of every assertion
// (docs/testing.md rule 9); the setting keys, the reason and the level below are
// the fixture's own.

// One reason text for both codes, so only the code can tell the two apart.
const SETTER_REASON = "value out of reach";
// A playback level no parser reads as a number (tests/apply/test_live_report_codes.py).
const UNREADABLE_LEVEL = "eleven";

/** @param {string} setting */
const rejected = (setting) => ({ setting, code: "invalid_input", error: SETTER_REASON });

test("test_a_live_setting_hqptuner_refused_does_not_read_as_a_refusal_by_hqplayer", async () => {
  const ours = await liveFailure([rejected(PCM_1X)]);
  const theirs = await liveFailure([{ setting: PCM_1X, code: "daemon_refused", error: SETTER_REASON }]);
  assert.notEqual(ours, theirs);
});

// The level rides the live half of the pending buffer, `{live: {volume: {value}}}`
// (tests/js/eqstage/eqstage-summary.test.js stages it there), and the report
// names only the setting, so the level the user sees comes from what was sent.
test("test_a_volume_level_hqptuner_refused_names_the_level_that_was_sent", async () => {
  await trees();
  route({
    staged: { live: { volume: { value: UNREADABLE_LEVEL } }, http: {} },
    apply: { live: [{ setting: "volume", ok: false, code: "invalid_input", error: SETTER_REASON }] },
  });
  await refreshConfig();
  await applyAll();
  assert.ok(String(verdict(lastApply).text).includes(UNREADABLE_LEVEL), String(verdict(lastApply).text));
});

// --- summarize: a missing output device the report cannot name ------------------
// `UnfixableDevice.want` is nullable on the wire (docs/openapi.json), so a report
// can lack the device's name; the absent value is never printed as one.

test("test_a_missing_output_device_with_no_name_never_shows_the_word_null", async () => {
  await trees();
  route({
    apply: {
      persistent: {
        applied: false,
        reason: "unavailable",
        diff: { net_device: {} },
        unfixable: { net_device: { want: null, available: [] } },
      },
    },
  });
  await applyAll();
  const text = String(verdict(lastApply).text);
  assert.ok(!/\bnull\b/i.test(text), text);
});

// --- summarize: a persistent lane that failed for another reason ----------------
// Beyond "unconverged", the persistent lane's verdict names its reason and the
// settings in its diff, each by the label of the control that edits it. A key no
// control edits is shown as its words, underscores turned to spaces. Reasons and
// unlabelled keys are the fixture's own; labels are copy (docs/testing.md rule 9).

const OTHER_REASON = "timeout";

/**
 * The verdict text a persistent failure with this reason and diff left behind.
 *
 * @param {string} reason
 * @param {Record<string, unknown>} diff
 * @returns {Promise<string>}
 */
async function persistFailure(reason, diff) {
  await trees();
  route({ apply: { persistent: { applied: false, reason, diff } } });
  await applyAll();
  return String(verdict(lastApply).text);
}

test("test_a_persistent_failure_shows_a_labelled_setting_without_its_wire_key", async () => {
  const text = await persistFailure(OTHER_REASON, { volume_max: {} });
  assert.ok(!text.includes("volume_max"), text);
});

test("test_a_persistent_failure_shows_an_unlabelled_setting_with_its_underscores_as_spaces", async () => {
  const text = await persistFailure(OTHER_REASON, { [UNLABELLED]: {} });
  assert.ok(text.includes(UNLABELLED.replaceAll("_", " ")), text);
});

test("test_a_persistent_failure_never_shows_an_unlabelled_setting_as_its_raw_key", async () => {
  const text = await persistFailure(OTHER_REASON, { [UNLABELLED]: {} });
  assert.ok(!text.includes(UNLABELLED), text);
});
