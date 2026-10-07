// Behavioral suite for hqptuner/static/components/faceplate/drawers/pipelines/upload.js, the DSP pipelines drawer's
// filter upload: a file posted to the daemon's filter route answers the path the daemon stored it under, and a refused
// one answers no path and the daemon's reason.
//
// The wire is faked at the real REST path (tests/js/support/wire/wire.js); nothing of the drawer's is stubbed.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-drawers/drawers-pipelines-upload.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { uploadFilter } from "../../../../hqptuner/static/components/faceplate/drawers/pipelines/upload.js";
import { bad, ok, stagingWire } from "../../support/wire/wire.js";

/**
 * Answer the filter route with `reply`.
 *
 * @param {import("../../support/wire/wire.js").FakeResponse} reply
 */
const filterRoute = (reply) => stagingWire({ routes: (path) => (path === "/api/matrix/filter" ? reply : undefined) });

const wav = () => new File([new Uint8Array(8)], "room.wav");

test("test_an_uploaded_filter_answers_the_path_the_daemon_stored_it_under", async () => {
  filterRoute(ok({ path: "/filters/room.wav" }));
  const got = await uploadFilter(wav());
  assert.equal(got.path, "/filters/room.wav");
});

test("test_a_refused_upload_answers_no_path_and_the_daemons_reason", async () => {
  filterRoute(bad(500, "disk full"));
  const got = await uploadFilter(wav());
  assert.deepEqual([got.path, got.note.includes("disk full")], ["", true]);
});
