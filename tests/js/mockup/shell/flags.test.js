// Behavioral suite for mockup/scripts/model/flags.js: one URL fragment read once into the typed mock flags the mockup
// opens on (display size, scenario, raised alerts, connection lamp, wire style, daemon mode, snapshot set, pipeline set,
// and the Station builder's mock failures).
//
// Every case is a fragment in and one field out. The fragments carry the leading `#` the platform's location.hash does.
//
// Run: node --test tests/js/mockup/flags.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { hashFlags } from "../../../../mockup/scripts/model/shell/flags.js";

//: Display sizes, scenarios and alert kinds the fragment may name; anything else it names is ignored.
const SIZES = [{ id: "10.2" }, { id: "11" }, { id: "13" }];
const SCENES = [{ id: "idle" }, { id: "pcm1x" }, { id: "dsd64" }];
const KINDS = ["clip", "speed", "apod"];

/**
 * The flags a fragment opens on, against the fixture sizes, scenes and kinds.
 *
 * @param {string} hash
 */
const flags = (hash) => hashFlags(hash, SIZES, SCENES, KINDS);

test("test_a_known_size_in_the_fragment_is_the_size", () => {
  assert.equal(flags("#size-13").size, "13");
});

test("test_a_dotted_size_id_is_read_whole", () => {
  assert.equal(flags("#size-10.2").size, "10.2");
});

test("test_a_size_found_after_other_flags_is_read", () => {
  assert.equal(flags("#scene-idle,size-11").size, "11");
});

test("test_an_unknown_size_gives_no_size", () => {
  assert.equal(flags("#size-12").size, null);
});

test("test_an_empty_fragment_gives_no_size", () => {
  assert.equal(flags("").size, null);
});

test("test_a_known_scene_in_the_fragment_is_the_scene", () => {
  assert.equal(flags("#scene-dsd64").scene, "dsd64");
});

test("test_an_unknown_scene_gives_no_scene", () => {
  assert.equal(flags("#scene-dsd512").scene, null);
});

test("test_an_empty_fragment_gives_no_scene", () => {
  assert.equal(flags("").scene, null);
});

test("test_listed_alert_kinds_are_raised_in_fragment_order", () => {
  assert.deepEqual(flags("#alerts-speed,clip").alerts, ["speed", "clip"]);
});

test("test_an_unknown_alert_kind_is_dropped", () => {
  assert.deepEqual(flags("#alerts-clip,bogus").alerts, ["clip"]);
});

test("test_no_alerts_flag_raises_none", () => {
  assert.deepEqual(flags("#scene-idle").alerts, []);
});

test("test_conn_busy_opens_the_lamp_busy", () => {
  assert.equal(flags("#conn-busy").conn, "busy");
});

test("test_conn_lost_opens_the_lamp_lost", () => {
  assert.equal(flags("#conn-lost").conn, "lost");
});

test("test_an_unknown_conn_state_opens_the_lamp_ok", () => {
  assert.equal(flags("#conn-down").conn, "ok");
});

test("test_no_conn_flag_opens_the_lamp_ok", () => {
  assert.equal(flags("").conn, "ok");
});

test("test_a_fragment_of_exactly_routed_draws_the_routed_wire", () => {
  assert.equal(flags("#routed").wire, "routed");
});

test("test_routed_beside_another_flag_keeps_the_trunk_wire", () => {
  assert.equal(flags("#routed,size-13").wire, "trunk");
});

test("test_no_wire_flag_draws_the_trunk_wire", () => {
  assert.equal(flags("").wire, "trunk");
});

test("test_mode_auto_anywhere_leaves_the_daemon_in_auto", () => {
  assert.equal(flags("#scene-idle,mode-auto").modeAuto, true);
});

test("test_no_mode_auto_flag_leaves_the_daemon_as_set", () => {
  assert.equal(flags("#scene-idle").modeAuto, false);
});

test("test_many_opens_the_many_snapshot_set", () => {
  assert.equal(flags("#many").snapshots, "many");
});

test("test_long_opens_the_long_snapshot_set", () => {
  assert.equal(flags("#long").snapshots, "long");
});

test("test_many_wins_over_long", () => {
  assert.equal(flags("#long,many").snapshots, "many");
});

test("test_no_snapshot_flag_opens_the_default_set", () => {
  assert.equal(flags("").snapshots, "default");
});

test("test_71_opens_the_eight_channel_pipelines", () => {
  assert.equal(flags("#71").pipelines, "mch8");
});

test("test_mch_opens_the_multichannel_pipelines", () => {
  assert.equal(flags("#mch").pipelines, "mch");
});

test("test_dense_opens_the_dense_pipelines", () => {
  assert.equal(flags("#dense").pipelines, "dense");
});

test("test_71_wins_over_mch", () => {
  assert.equal(flags("#mch,71").pipelines, "mch8");
});

test("test_mch_wins_over_dense", () => {
  assert.equal(flags("#dense,mch").pipelines, "mch");
});

test("test_no_pipeline_flag_opens_the_stereo_pipelines", () => {
  assert.equal(flags("").pipelines, "stereo");
});

test("test_naa_none_hides_the_naa_until_refresh", () => {
  assert.equal(flags("#naa-none").naaNone, true);
});

test("test_no_naa_flag_shows_the_naa", () => {
  assert.equal(flags("").naaNone, false);
});

test("test_ipv6_fail_fails_the_ipv6_check", () => {
  assert.equal(flags("#ipv6-fail").ipv6Fail, true);
});

test("test_no_ipv6_flag_passes_the_ipv6_check", () => {
  assert.equal(flags("").ipv6Fail, false);
});

test("test_usb_fail_gone_fails_the_usb_check_as_gone", () => {
  assert.equal(flags("#usb-fail-gone").usbFail, "gone");
});

test("test_usb_fail_none_fails_the_usb_check_as_none", () => {
  assert.equal(flags("#usb-fail-none").usbFail, "none");
});

test("test_an_unknown_usb_failure_passes_the_usb_check", () => {
  assert.equal(flags("#usb-fail-late").usbFail, null);
});

test("test_dsd48_no_detects_no_48k_dsd", () => {
  assert.equal(flags("#dsd48-no").dsd48No, true);
});

test("test_no_dsd48_flag_detects_48k_dsd", () => {
  assert.equal(flags("").dsd48No, false);
});
