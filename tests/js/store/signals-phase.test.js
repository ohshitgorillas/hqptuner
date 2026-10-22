import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { health, phase, generation } from "../../../hqptuner/static/store/signals.js";

const INITIAL_GENERATION = 17;
const LATER_GENERATION = 23;
const CONNECTED_AT = 1234;
const PHASES = ["Down", "Reachable", "Ready", "Alarm"];

afterEach(() => {
  health.value = null;
});

/**
 * @param {string} standing
 * @param {number} token
 */
function report(standing, token) {
  health.value = {
    phase: standing,
    generation: token,
    connected_at: CONNECTED_AT,
    credentials_ok: false,
    address_found: true,
  };
}

for (const standing of PHASES) {
  // Break: retain an earlier phase or infer one from credential or connection facts.
  test(`test_phase_follows_the_health_report_when_it_says_${standing}`, () => {
    report("Ready", INITIAL_GENERATION);
    const initial = phase.value;
    report(standing, INITIAL_GENERATION);
    assert.deepEqual([initial, phase.value], ["Ready", standing]);
  });
}

// Break: count phase transitions in the browser instead of taking the served token.
test("test_generation_stays_at_the_served_token_when_phase_changes", () => {
  report("Ready", INITIAL_GENERATION);
  const initial = generation.value;
  report("Down", INITIAL_GENERATION);
  assert.deepEqual([initial, generation.value], [INITIAL_GENERATION, INITIAL_GENERATION]);
});

// Break: refresh generation only when the phase changes, or increment it locally.
test("test_generation_follows_a_new_served_token_with_the_same_phase", () => {
  report("Ready", INITIAL_GENERATION);
  const initial = generation.value;
  report("Ready", LATER_GENERATION);
  assert.deepEqual([initial, generation.value], [INITIAL_GENERATION, LATER_GENERATION]);
});
