// Boot suite for hqptuner/static/app.js on a document with no `#app`: `boot(doc, clock)` boots nothing there. It asks
// the wire for nothing, opens no stream and leaves the document as it was handed in, however far the clock moves
// (docs/superpowers/specs/rebuild-integrate-design.md, Modules).
//
// The page is the fake page (tests/js/support/page.js) on the fake clock (tests/js/support/clock.js); the wire is the
// fetch fake (tests/js/support/wire/wire.js) behind a log of every path it is handed, the staging paths it answers
// itself included, and the EventSource fake (tests/js/support/eventsource.js). The document as it was handed in is the
// attributes and inline style of its `html`, `head` and `body`, its title, the children of its head and the markup of
// its body. Its own file: the stores boot starts live for the life of the process.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/app/no-app.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { boot } from "../../../hqptuner/static/app.js";
import { fakeClock } from "../support/clock.js";
import { lastStream, useEventSource } from "../support/eventsource.js";
import { fakePage } from "../support/page.js";
import { quiesce, stagingWire } from "../support/wire/wire.js";

/** How far the case moves the clock after boot, ms: a minute, past any poll or retry the app starts. */
const MINUTE_MS = 60_000;

/**
 * The global the wire fake installs its `fetch` on, viewed as an optional member, as the wire fake views it.
 *
 * @type {{ fetch?: unknown }}
 */
const env = globalThis;

/**
 * What a document's `html`, `head` and `body` carry beyond their children: attributes and inline style, and its title.
 *
 * @param {any} doc
 */
const dress = (doc) => {
  const of = (/** @type {any} */ el) => ({ attributes: el.attributes, style: el.style.cssText });
  return { html: of(doc.documentElement), head: of(doc.head), body: of(doc.body), title: doc.title };
};

test("test_a_document_with_no_app_element_boots_nothing", async () => {
  useEventSource();
  /** @type {string[]} every path the page asked the wire for */
  const asked = [];
  const wire = stagingWire();
  const served = /** @type {(path: string, opts?: object) => Promise<unknown>} */ (env.fetch);
  env.fetch = (/** @type {string} */ path, /** @type {object | undefined} */ opts) => {
    asked.push(path);
    return served(path, opts);
  };
  const { clock, advance } = fakeClock();
  const { doc } = fakePage({ clock, html: "<main></main>" });
  const handedIn = dress(doc);
  boot(doc, clock);
  advance(MINUTE_MS);
  await quiesce(wire);
  assert.deepEqual(
    {
      asked,
      stages: wire.stages,
      stream: lastStream(),
      head: doc.head.childNodes.length,
      body: doc.body.innerHTML,
      dress: dress(doc),
    },
    { asked: [], stages: [], stream: null, head: 0, body: "<main></main>", dress: handedIn },
  );
});
