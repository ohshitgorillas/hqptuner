// The connection panel's link to the daemon's own page, rendered with the host
// field naming the machine HQPTuner runs on.

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { Setup } from "../../../../hqptuner/static/components/Setup.js";
import {
  setupOpen,
  loggedOut,
  verdict,
  loginSentence,
  form,
  pageHost,
} from "../../../../hqptuner/static/store/setup.js";
import { attr, elements } from "../../support/markup.js";

const OPEN = setupOpen.value;
const FORM = form.value;
const PAGE_HOST = pageHost.value;
const VERDICT = verdict.value;
const SENTENCE = loginSentence.value;

afterEach(() => {
  loggedOut.value = false;
  verdict.value = VERDICT;
  loginSentence.value = SENTENCE;
  setupOpen.value = OPEN;
  form.value = FORM;
  pageHost.value = PAGE_HOST;
});

/**
 * Whether the rendered panel holds the control with this test id.
 *
 * @param {string} out
 * @param {string} id
 * @returns {boolean}
 */
const has = (out, id) => elements(out).some((el) => attr(el, "data-testid") === id);

// The host name the daemon-auth-link anchor points at, or undefined when the
// markup carries no such anchor.
/** @param {string} out */
function authLinkHostname(out) {
  const link = elements(out).find((el) => attr(el, "data-testid") === "daemon-auth-link");
  const href = link && attr(link, "href");
  return href ? new URL(href).hostname : undefined;
}

/** @param {string} out */
function authLinkHref(out) {
  const link = elements(out).find((el) => attr(el, "data-testid") === "daemon-auth-link");
  return link && attr(link, "href");
}

for (const kase of [
  { name: "an IPv6 host field", host: "2001:db8::5", page: "", href: "http://[2001:db8::5]:8088/auth" },
  { name: "an IPv4 host field", host: "10.0.0.9", page: "", href: "http://10.0.0.9:8088/auth" },
  {
    name: "a server-side address with a bare IPv6 page host",
    host: "::1",
    page: "2001:db8::7",
    href: "http://[2001:db8::7]:8088/auth",
  },
  {
    name: "a server-side address with a bracketed IPv6 page host",
    host: "::1",
    page: "[2001:db8::7]",
    href: "http://[2001:db8::7]:8088/auth",
  },
]) {
  test(`test_the_daemon_link_for_${kase.name.replaceAll(" ", "_")}_is_the_url_the_browser_follows`, () => {
    setupOpen.value = true;
    form.value = { ...FORM, host: kase.host };
    pageHost.value = kase.page;
    assert.equal(authLinkHref(render(html`<${Setup} />`)), kase.href);
  });
}

test("a host field naming the server's own machine links the daemon page through the host the page was served from", () => {
  const served = "192.168.1.40";
  setupOpen.value = true;
  form.value = { ...FORM, host: "host.docker.internal" };
  pageHost.value = served;
  const out = render(html`<${Setup} />`);
  assert.equal(authLinkHostname(out), served);
});

// --- the login screen: the same panel, without the controls whose routes need a login ---

/** The panel as a browser with no login sees it. */
function loggedOutPanel() {
  setupOpen.value = true;
  loggedOut.value = true;
  return render(html`<${Setup} />`);
}

/** The panel as the Connection panel is opened from the status pill. */
function openPanel() {
  setupOpen.value = true;
  return render(html`<${Setup} />`);
}

for (const id of ["setup-close", "setup-detect", "setup-connect"]) {
  test(`test_the_panel_has_${id}_when_logged_in`, () => {
    assert.equal(has(openPanel(), id), true);
  });

  test(`test_the_login_screen_has_no_${id}`, () => {
    assert.equal(has(loggedOutPanel(), id), false);
  });
}

test("test_the_login_screen_keeps_both_remember_radios", () => {
  assert.equal(elements(loggedOutPanel()).filter((el) => attr(el, "type") === "radio").length, 2);
});

test("test_the_login_screen_keeps_the_host_username_and_password_rows", () => {
  assert.equal(
    elements(loggedOutPanel()).filter((el) => el.name === "input" && attr(el, "type") !== "radio").length,
    3,
  );
});

test("test_a_login_that_could_not_be_checked_gets_a_report_under_the_panel", () => {
  verdict.value = "not-answered";
  assert.equal(loggedOutPanel().includes('<p class="t-caption"></p>'), false);
});

test("test_a_login_refused_for_a_pinned_value_shows_the_sentence_the_backend_sent", () => {
  verdict.value = "pinned";
  loginSentence.value = "sentinel-from-the-backend";
  assert.equal(loggedOutPanel().includes("sentinel-from-the-backend"), true);
});

test("test_a_save_or_login_refused_for_its_host_shows_the_sentence_the_backend_sent", () => {
  verdict.value = "rejected";
  loginSentence.value = "sentinel-from-the-backend";
  assert.equal(loggedOutPanel().includes("sentinel-from-the-backend"), true);
});

test("test_the_remember_choice_carries_a_caption", () => {
  const notes = elements(openPanel()).filter((el) => attr(el, "data-testid") === "setup-remember-note");
  assert.deepEqual(
    notes.map((el) => attr(el, "class")),
    ["t-caption"],
  );
});
