// Behavioral suite for store/live/ — the live controls' store: the values and
// option lists its controls read, and the one path they write by.
//
// Every case drives the exported `engineState` / `enums` signals with
// the shapes /api/state and /api/enumerations actually serve, and every write
// goes out over a faked `globalThis.fetch` on the real REST path.
//
// The fake enumerations deliberately give each item an index that differs from
// its value. State reports the LIST INDEX and the config-form domain these
// controls speak is the enum ID, so a fixture where the two
// coincide could not tell a correct join from no join at all.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/store/live/live.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { writeLive } from "../../../../hqptuner/static/store/live/write.js";
import { liveControl as control, liveState, resetLive as reset } from "../../support/wire/livepresetwire.js";

test("test_the_filter_control_reads_the_enum_id_the_engine_is_using", async () => {
  await reset();
  assert.equal(control("filter").value, "25");
});

test("test_writing_a_control_posts_one_field_to_the_live_lane", async () => {
  const w = await reset();
  await writeLive("filter", "40");
  assert.deepEqual(w.posts, [{ fields: { filter: "40" } }]);
});

// --- a write the backend refused outright -------------------------------------
// A Control API command the daemon receives and never answers comes back as 503
// with FastAPI's `detail` string (a plain string, not the per-field object a 409
// carries). The write may well have landed on the engine before the silence — the
// daemon's own log shows the command accepted — so the store cannot assume
// nothing changed: it re-reads State rather than leaving the controls describing
// an engine that has moved.

const STALL_DETAIL = "State: no reply within 5.0s (the daemon may have restarted)";

// The engine ends up on filterNx index 0, enum ID 0 (`none`) — neither the 25 the
// signals were seeded with nor the 40 the write asked for. So this value can only
// come from an actual /api/state re-read: a store that kept the old value fails,
// and so does one that optimistically applied the written value.
const REFUSED = () => ({ status: 503, detail: STALL_DETAIL, mirrored: { ...liveState(), filterNx: "0" } });

test("test_a_write_the_backend_refused_re_reads_the_engines_state", async () => {
  await reset(REFUSED());
  await writeLive("filter", "40");
  assert.equal(control("filter").value, "0");
});
