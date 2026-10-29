// Behavioral suite for `mount` in lib/dom.js: it renders a tree with Preact's `render` and nothing more. It reads and
// writes no global and chains no Preact `options` hook, so the document Preact builds nodes through is the one the
// host supplies: none when no page is hosted, even though the root lives in a page with a document of its own.
//
// Each case builds its pages with fakePage (tests/js/support/page.js); `hostPage` is the only writer of the global
// document and of Preact's schedules. Preact's options are read once before lib/dom.js loads, after every module that
// installs hooks of its own (preact/hooks, @preact/signals) has loaded, so the options cases can tell whether loading
// and using `mount` hooked anything, read while a tree is mounted and once it is unmounted, the page still hosted.
// With a page hosted, the tree reaches the root, its nodes built in the hosted page's document, not the root's own;
// once the first render and every microtask after it have run, the hosted page's document is still the global one,
// and a redraw scheduled then builds there too.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/mount.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { h, options } from "preact";
import { useState } from "preact/hooks";
import "@preact/signals";

import { fakeClock } from "../support/clock.js";
import { fakePage, hostPage } from "../support/page.js";

/** Preact's options with a value, by name, as they stand now. */
const optionsNow = () => new Map(Object.entries(options).filter(([, value]) => value !== undefined));

const optionsBefore = optionsNow();
const { mount } = await import("../../../hqptuner/static/lib/dom.js");

/** Two fresh pages: `host`, the one Preact will render through, and `other`, the one the root lives in. */
function twoPages() {
  const { clock } = fakeClock();
  return { host: fakePage({ clock }), other: fakePage({ clock }) };
}

/**
 * Preact's options as they stand before lib/dom.js loaded, plus the two schedules `hostPage` has just set: what they
 * read while a page is hosted and nothing else has hooked them.
 */
const optionsWhileHosted = () =>
  new Map([
    ...optionsBefore,
    ["debounceRendering", options.debounceRendering],
    ["requestAnimationFrame", options.requestAnimationFrame],
  ]);

test("while a mounted tree is on the page, Preact's options are the hosted page's alone", () => {
  const { host, other } = twoPages();
  const release = hostPage(host);
  const expected = optionsWhileHosted();
  try {
    mount(h("p", null, "hi"), other.doc.body);
    host.settle();
    assert.deepEqual(optionsNow(), expected);
  } finally {
    mount(null, other.doc.body);
    release();
  }
});

test("once a mounted tree is unmounted, Preact's options are the hosted page's alone", () => {
  const { host, other } = twoPages();
  const release = hostPage(host);
  const expected = optionsWhileHosted();
  try {
    mount(h("p", null, "hi"), other.doc.body);
    host.settle();
    mount(null, other.doc.body);
    host.settle();
    assert.deepEqual(optionsNow(), expected);
  } finally {
    release();
  }
});

test("with a page hosted, mounting a tree renders it into the root, its nodes built in the hosted page's document", () => {
  const { host, other } = twoPages();
  const release = hostPage(host);
  try {
    mount(h("p", null, "hi"), other.doc.body);
    host.settle();
    const rendered = other.doc.body.firstChild;
    const mounted = {
      children: other.doc.body.childNodes.length,
      name: rendered.nodeName.toLowerCase(),
      text: rendered.textContent,
      inHostedDocument: rendered.ownerDocument === host.doc,
    };
    mount(null, other.doc.body);
    host.settle();
    assert.deepEqual(
      { ...mounted, childrenUnmounted: other.doc.body.childNodes.length },
      { children: 1, name: "p", text: "hi", inHostedDocument: true, childrenUnmounted: 0 },
    );
  } finally {
    release();
  }
});

/** A component drawing `<p>hi</p>` until `retag` names another tag, which Preact then redraws on the page's schedule. */
function retaggable() {
  const made = {
    /** @type {(tag: string) => void} */
    retag: () => {},
    Tagged() {
      const [tag, setTag] = useState("p");
      made.retag = setTag;
      return h(tag, null, "hi");
    },
  };
  return made;
}

/** Every microtask queued so far, and every one those queue, has run. */
const microtasksRun = () => new Promise((resolve) => setImmediate(resolve));

test("with a page hosted, once a mounted tree's render and its microtasks have run, the hosted page's document is still the global one", async () => {
  const { host, other } = twoPages();
  const release = hostPage(host);
  const { Tagged } = retaggable();
  try {
    mount(h(Tagged, null), other.doc.body);
    host.settle();
    await microtasksRun();
    assert.equal(/** @type {{ document?: unknown }} */ (globalThis).document, host.doc);
  } finally {
    mount(null, other.doc.body);
    host.settle();
    release();
  }
});

test("with a page hosted, a mounted tree redrawn once its render and its microtasks have run builds in the hosted page's document", async () => {
  const { host, other } = twoPages();
  const release = hostPage(host);
  const made = retaggable();
  try {
    mount(h(made.Tagged, null), other.doc.body);
    host.settle();
    await microtasksRun();
    made.retag("span");
    host.settle();
    const redrawn = other.doc.body.firstChild;
    assert.deepEqual(
      {
        children: other.doc.body.childNodes.length,
        name: redrawn.nodeName.toLowerCase(),
        inHostedDocument: redrawn.ownerDocument === host.doc,
      },
      { children: 1, name: "span", inHostedDocument: true },
    );
  } finally {
    mount(null, other.doc.body);
    host.settle();
    release();
  }
});

test("with no page hosted, mounting a tree puts nothing in the root's own document", () => {
  const { other } = twoPages();
  try {
    mount(h("p", null, "hi"), other.doc.body);
  } catch {
    // Preact finding no global document to build through may throw; the case reads only what reached the root.
  }
  assert.equal(other.doc.body.childNodes.length, 0);
});
