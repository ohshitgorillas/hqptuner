// The connection panel's link to the daemon's own page, rendered with the host
// field naming the machine HQPTuner runs on.

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Setup } from "../../../../hqptuner/static/components/Setup.js";
import { setupOpen, form, pageHost } from "../../../../hqptuner/static/store/setup.js";
import { attr, elements } from "../../support/markup.js";

const OPEN = setupOpen.value;
const FORM = form.value;
const PAGE_HOST = pageHost.value;

afterEach(() => {
  setupOpen.value = OPEN;
  form.value = FORM;
  pageHost.value = PAGE_HOST;
});

// The host name the daemon-auth-link anchor points at, or undefined when the
// markup carries no such anchor.
/** @param {string} out */
function authLinkHostname(out) {
  const link = elements(out).find((el) => attr(el, "data-testid") === "daemon-auth-link");
  const href = link && attr(link, "href");
  return href ? new URL(href).hostname : undefined;
}

test("a host field naming the server's own machine links the daemon page through the host the page was served from", () => {
  const served = "192.168.1.40";
  setupOpen.value = true;
  form.value = { ...FORM, host: "host.docker.internal" };
  pageHost.value = served;
  const out = render(html`<${Setup} />`);
  assert.equal(authLinkHostname(out), served);
});
