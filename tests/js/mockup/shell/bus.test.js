// Behavioral suite for mockup/scripts/lib/bus.js: a named-event bus the mockup's components share instead of the window.
// A subscriber hears its own name's emits with their detail, in subscription order, until it unsubscribes; one that
// throws is reported and does not stop the rest.
//
// Run: node --test tests/js/mockup/bus.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { createBus } from "../../../../mockup/scripts/lib/bus.js";

/**
 * A bus whose listener failures land in `errors` instead of the platform's report.
 */
function quietBus() {
  /** @type {unknown[]} */
  const errors = [];
  return { bus: createBus((err) => errors.push(err)), errors };
}

test("test_a_subscriber_hears_the_detail_it_was_emitted_with", () => {
  const { bus } = quietBus();
  /** @type {unknown[]} */
  const heard = [];
  bus.on("tick", (d) => heard.push(d));
  bus.emit("tick", 7);
  assert.deepEqual(heard, [7]);
});

test("test_a_subscriber_hears_every_emit_of_its_name", () => {
  const { bus } = quietBus();
  let n = 0;
  bus.on("tick", () => (n += 1));
  bus.emit("tick");
  bus.emit("tick");
  assert.equal(n, 2);
});

test("test_a_subscriber_does_not_hear_another_name", () => {
  const { bus } = quietBus();
  let n = 0;
  bus.on("tick", () => (n += 1));
  bus.emit("tock");
  assert.equal(n, 0);
});

test("test_an_emit_nobody_hears_does_not_throw", () => {
  const { bus } = quietBus();
  assert.doesNotThrow(() => bus.emit("tick", 1));
});

test("test_subscribers_run_in_subscription_order", () => {
  const { bus } = quietBus();
  /** @type {string[]} */
  const order = [];
  bus.on("tick", () => order.push("a"));
  bus.on("tick", () => order.push("b"));
  bus.on("tick", () => order.push("c"));
  bus.emit("tick");
  assert.deepEqual(order, ["a", "b", "c"]);
});

test("test_an_unsubscribed_subscriber_hears_no_further_emits", () => {
  const { bus } = quietBus();
  let n = 0;
  const off = bus.on("tick", () => (n += 1));
  bus.emit("tick");
  off();
  bus.emit("tick");
  assert.equal(n, 1);
});

test("test_unsubscribing_one_subscriber_leaves_the_others", () => {
  const { bus } = quietBus();
  /** @type {string[]} */
  const order = [];
  bus.on("tick", () => order.push("a"));
  const off = bus.on("tick", () => order.push("b"));
  bus.on("tick", () => order.push("c"));
  off();
  bus.emit("tick");
  assert.deepEqual(order, ["a", "c"]);
});

test("test_unsubscribing_twice_leaves_the_others", () => {
  const { bus } = quietBus();
  let n = 0;
  const off = bus.on("tick", () => {});
  bus.on("tick", () => (n += 1));
  off();
  off();
  bus.emit("tick");
  assert.equal(n, 1);
});

test("test_a_subscriber_added_during_an_emit_hears_only_later_emits", () => {
  const { bus } = quietBus();
  let n = 0;
  const once = bus.on("tick", () => {
    once();
    bus.on("tick", () => (n += 1));
  });
  bus.emit("tick");
  bus.emit("tick");
  assert.equal(n, 1);
});

test("test_a_subscriber_removed_during_an_emit_before_its_turn_is_not_called", () => {
  const { bus } = quietBus();
  let n = 0;
  /** @type {() => void} */
  let offLater = () => {};
  bus.on("tick", () => offLater());
  offLater = bus.on("tick", () => (n += 1));
  bus.emit("tick");
  assert.equal(n, 0);
});

test("test_a_throwing_subscriber_does_not_stop_the_next", () => {
  const { bus } = quietBus();
  let n = 0;
  bus.on("tick", () => {
    throw new Error("boom");
  });
  bus.on("tick", () => (n += 1));
  bus.emit("tick");
  assert.equal(n, 1);
});

test("test_a_throwing_subscriber_is_reported", () => {
  const { bus, errors } = quietBus();
  const err = new Error("boom");
  bus.on("tick", () => {
    throw err;
  });
  bus.emit("tick");
  assert.deepEqual(errors, [err]);
});

test("test_a_throwing_subscriber_does_not_throw_from_the_emit", () => {
  const { bus } = quietBus();
  bus.on("tick", () => {
    throw new Error("boom");
  });
  assert.doesNotThrow(() => bus.emit("tick"));
});

test("test_two_buses_do_not_share_subscribers", () => {
  const a = quietBus().bus;
  const b = quietBus().bus;
  let n = 0;
  a.on("tick", () => (n += 1));
  b.emit("tick");
  assert.equal(n, 0);
});
