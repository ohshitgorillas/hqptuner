// Behavioral suite for `mount` in lib/dom.js with no page hosted: it is Preact's `render` and nothing more, so it
// writes no global, and the global `document` Preact builds nodes through is the host's to supply
// (docs/superpowers/specs/rebuild-integrate-design.md, Modules, and the Homes row "Rendering a tree"). With no host
// there is none, and mounting a tree into a root that lives in a page with a document of its own leaves none in place
// once `mount` has returned, whether or not Preact could build the tree.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/lib/mount-host.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { h } from "preact";

import { mount } from "../../../hqptuner/static/lib/dom.js";
import { fakeClock } from "../support/clock.js";
import { fakePage } from "../support/page.js";

/** A page holding the root `#app`. */
function rootPage() {
  const page = fakePage({ clock: fakeClock().clock, html: '<div id="app"></div>' });
  return { page, root: page.doc.getElementById("app") };
}

test("test_with_no_page_hosted_mount_leaves_no_global_document_in_place_when_it_returns", () => {
  const { root } = rootPage();
  try {
    mount(h("p", null, "hi"), root);
  } catch {
    // Preact finding no global document to build through may throw; only the global left behind is the claim.
  }
  assert.equal(Object.hasOwn(globalThis, "document"), false);
});
