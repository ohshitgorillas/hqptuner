// Behavioral suite for an apply the daemon refused because it refused the
// management credential: the persistent lane's report carries the code
// `credentials_refused` and a sentence saying why. The apply's verdict
// (`lastApply`, what the apply caption shows) must read as the credential
// refusal, the verdict whose caption is that sentence, and not as a generic
// daemon error that happens to carry it. The sentence is the fixture's own.
//
// Driven over the fake wire in tests/js/support/threetrees.js; no store
// function is stubbed.

import test from "node:test";
import assert from "node:assert/strict";

import { applyAll } from "../../../hqptuner/static/store/actions.js";
import { lastApply } from "../../../hqptuner/static/store/signals.js";
import { route, trees } from "../support/threetrees.js";

//: The error code a refused credential carries on the wire.
const CREDENTIALS_REFUSED = "credentials_refused";

//: The refusal's sentence, invented by this fixture.
const REFUSAL_SENTENCE = "fixture: the daemon turned the management pair away";

//: The verdict a credential refusal with its sentence reads as
//: (tests/js/store/apply-summary.test.js, CREDENTIAL_REFUSALS).
const CREDENTIAL_VERDICT = "persist-credentials";

/**
 * The verdict the last apply recorded. A case whose apply recorded nothing has
 * lost its own premise rather than its assertion.
 *
 * @returns {NonNullable<typeof lastApply.value>}
 */
function verdict() {
  if (lastApply.value === null) throw new Error("expected an apply verdict, none was recorded");
  return lastApply.value;
}

test("test_an_apply_refused_for_a_refused_credential_reads_as_a_credential_refusal", async () => {
  await trees();
  route({ apply: { persistent: { applied: false, code: CREDENTIALS_REFUSED, error: REFUSAL_SENTENCE } } });
  await applyAll();
  assert.equal(verdict().code, CREDENTIAL_VERDICT);
});
