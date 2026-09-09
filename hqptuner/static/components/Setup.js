// The connection panel: where the daemon is, who HQPTuner is to it, and
// whether the password is kept. It is the whole of an install's onboarding, so
// it renders over the app rather than inside a tab, and it is a sibling of the
// `.app` div rather than a child: `.app.offline` dims at `--o-dim` on exactly
// the condition that opens this panel, and a child would dim with it.
//
// Discovery runs on open, with no user action. One answer fills the host field;
// several are listed and none is chosen, because choosing would be a guess. A
// row prints what the daemon said about itself, and product and platform are
// absent whenever the per-daemon control exchange failed, so the row degrades
// to its address and name rather than to nothing.
import { useEffect, useRef } from "preact/hooks";
import { html } from "../lib/dom.js";
import { Card } from "./common.js";
import {
  setupOpen,
  daemons,
  discovering,
  form,
  hostTouched,
  verdict,
  closeSetup,
  detectHosts,
  fillHost,
  submitConnection,
} from "../store/setup.js";

/**
 * @param {string} key the form field to write
 * @param {string | boolean} value
 */
function setField(key, value) {
  form.value = { ...form.value, [key]: value };
}

/** One found daemon, as itself: address and name always, product and platform when it said them. */
function daemonRow(/** @type {{address: string, name: string, product?: string, platform?: string}} */ d) {
  const said = [d.product, d.platform].filter(Boolean).join(", ");
  return html`
    <button
      type="button"
      class="setup-daemon ${form.value.host === d.address ? "on" : ""}"
      onClick=${() => {
        hostTouched.value = true;
        setField("host", d.address);
      }}
    >
      <span class="t-value">${d.address}</span>
      <span class="t-label">${d.name}</span>
      ${said && html`<span class="t-caption">${said}</span>`}
    </button>
  `;
}

// Nothing is drawn while the sweep runs, and nothing when it found nobody: the
// words for either state are copy, and copy is the owner's. The host field is
// what the panel is asking for, and it is already there.
function found() {
  if (discovering.value || !daemons.value.length) return null;
  return html`<div class="setup-found">${daemons.value.map(daemonRow)}</div>`;
}

/**
 * @param {string} key
 * @param {string} label
 * @param {string} type
 * @param {string} [placeholder]
 */
function textRow(key, label, type, placeholder) {
  // The host row carries Connect, beside the address it dials: the daemon coming up
  // later is answered by trying this address again, with nothing else to restate.
  const trailing = key === "host";
  return html`
    <label class="setup-row">
      <span class="t-label">${label}</span>
      <span class="setup-input">
        <input
          type=${type}
          placeholder=${placeholder || ""}
          value=${/** @type {Record<string, string>} */ (form.value)[key]}
          onInput=${(/** @type {{ target: HTMLInputElement }} */ e) => {
            if (key === "host") hostTouched.value = true;
            setField(key, e.target.value);
          }}
        />
        ${
          trailing &&
          html`<button type="button" disabled=${discovering.value} onClick=${detectHosts}>Detect</button>
          <button type="button" onClick=${() => submitConnection()}>Connect</button>`
        }
      </span>
    </label>
  `;
}

// What the last press of Connect had to say. The empty-address case is the one that
// carries links: the address is the only field the user can be told what to put in,
// and only when the daemon is on the machine they are already looking at.
/** @type {Record<string, string>} */
const VERDICTS = {
  saved: "Connected.",
  "no-host": "Enter the address of your HQPlayer Embedded machine.",
  connecting: "Connecting…",
  refused: "HQPlayer refused that username and password.",
  unreachable: "Nothing is answering at that address. Start HQPlayer Embedded, then press Connect again.",
  "no-8088":
    "HQPTuner needs HQPlayer's management username and password. " +
    "Set them with hqplayerd -u <username> <password>, or on HQPlayer's own web page at port 8088.",
  "no-answer":
    "HQPlayer answered, but its settings page at port 8088 did not. Restart HQPlayer Embedded, then press Connect again.",
};

/** One "(enter it for me)" link: the address it names goes straight into the host field. */
function hostLink(/** @type {string} */ address) {
  return html`<button type="button" class="setup-fill" data-host=${address} onClick=${() => fillHost(address)}>
    ${"(enter it for me)"}
  </button>`;
}

// What to put in the address field, standing under it rather than waiting on a
// failed press: it is read while the field is being filled, which is before the
// user has anything to be told off about.
function hostHelp() {
  return html`<div class="setup-report">
    <p class="t-caption">${"Enter the address of your HQPlayer Embedded machine. If HQPlayer is running on the same machine you're using now..."}</p>
    <ul class="setup-options">
      <li class="t-caption">${'If running HQPTuner in Docker, enter "host.docker.internal" '}${hostLink("host.docker.internal")}</li>
      <li class="t-caption">${'Otherwise, enter "127.0.0.1" '}${hostLink("127.0.0.1")}</li>
    </ul>
  </div>`;
}

// Addresses that name the machine HQPTuner runs on rather than one the browser can
// follow: loopback is the browser's own machine, and the Docker alias resolves only
// inside the container.
const SERVER_SIDE_ONLY = ["127.0.0.1", "localhost", "::1", "host.docker.internal"];

// The daemon's own page, always a link, built from an address the browser can reach.
//
// The host field is what HQPTuner dials from where HQPTuner runs, and this link is
// followed by the browser, so the two are not interchangeable. When the field names
// the machine HQPTuner is on, the daemon is on that machine too, and the browser is
// already talking to it: the address in the URL bar is the one that reaches it.
//
// It opens in its own tab: this panel is where the credentials are typed, so
// navigating away from it would lose them.
function eightyEightyEight() {
  const host = form.value.host.trim();
  const reachable = !host || SERVER_SIDE_ONLY.includes(host) ? window.location.hostname : host;
  return html`<a href=${`http://${reachable}:8088/auth`} target="_blank" rel="noreferrer">
    ${"default web page at port 8088"}
  </a>`;
}

/** The report on the last press of Connect, or nothing before the first one. */
function report() {
  const v = verdict.value;
  if (!v) return null;
  return html`<div class="setup-report"><p class="t-caption">${VERDICTS[v] || ""}</p></div>`;
}

/** @param {boolean} remember which option this radio is */
function rememberRow(remember, /** @type {string} */ label) {
  return html`
    <label class="setup-radio">
      <input
        type="radio"
        name="setup-remember"
        checked=${form.value.remember === remember}
        onChange=${() => setField("remember", remember)}
      />
      <span class="t-label">${label}</span>
    </label>
  `;
}

/** The connection panel, or nothing while it is closed. */
export function Setup() {
  const open = setupOpen.value;
  const panel = useRef(null);
  // Escape closes, and the first field takes focus on open. The page behind is
  // made inert by App while this is up, so the keyboard cannot walk out of the
  // panel into controls the user cannot see — a Tab-and-Enter out there staged
  // an engine change during review.
  useEffect(() => {
    if (!open) return undefined;
    /** @type {HTMLElement | null} */
    const root = panel.current;
    const first = root && root.querySelector("input");
    if (first) /** @type {HTMLInputElement} */ (first).focus();
    /** @param {KeyboardEvent} e */
    const onKey = (e) => {
      if (e.key === "Escape") closeSetup();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return html`
    <div
      class="setup-scrim"
      ref=${panel}
      onClick=${(/** @type {{ target: EventTarget | null, currentTarget: EventTarget | null }} */ e) => {
        // Only the scrim itself: a click that started on the card is the user
        // working in the panel, not asking to leave it.
        if (e.target === e.currentTarget) closeSetup();
      }}
    >
      <!-- What the readings after a save said, as an attribute rather than a
           sentence: the sentence is copy and copy is the owner's, and until
           there is one this is what a reader of the DOM has to go on. -->
      <div class="setup-panel" data-verdict=${verdict.value || ""}>
        <${Card} title="Connection" cardClass="setup-card">
          <p class="t-caption">
            HQPTuner needs two things to run: the address of your HQPlayer Embedded daemon, and its credentials.
          </p>
          <p class="t-caption">
            ${"If you haven't set the credentials already, do that by running "}
            <code>${"hqplayerd -u <username> <password>"}</code>${" on the HQPlayer machine, or change it from the "}${eightyEightyEight()}${
              ". The " + 'defaults are "hqplayer" and "password"; if they don\'t work, changing them usually will.'
            }
          </p>
          ${textRow("host", "Host", "text")} ${report()} ${hostHelp()} ${found()}
          ${textRow("username", "Username", "text")}
          ${textRow("password", "Password", "password", form.value.hasPassword ? "Leave blank to keep the stored password" : "")}
          <div class="setup-remember">
            ${rememberRow(true, "Let HQPTuner store my password")}
            ${rememberRow(false, "Ask every time HQPTuner starts")}
          </div>
          <div class="setup-buttons">
            <button type="button" onClick=${() => submitConnection(true)}>Save</button>
            <button type="button" onClick=${closeSetup}>Close</button>
          </div>
        <//>
      </div>
    </div>
  `;
}
