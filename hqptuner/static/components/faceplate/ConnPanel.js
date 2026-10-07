// The connection panel as a faceplate sheet: v1's fields and copy (components/Setup.js) over store/setup.js, from the
// body's top to the plate's foot, so the header and the knob's lamp stay in view. Escape is the Plate's (closeTop).

import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { plate } from "../../store/faceplate/view.js";
import {
  setupOpen,
  discovering,
  form,
  hostTouched,
  pageHost,
  verdict,
  closeSetup,
  detectHosts,
  fillHost,
  submitConnection,
} from "../../store/setup.js";

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

/** Addresses that name the machine HQPTuner runs on, which the browser cannot follow. */
const SERVER_SIDE_ONLY = ["127.0.0.1", "localhost", "::1", "host.docker.internal"];

/**
 * @param {string} key the form field to write
 * @param {string | boolean} value
 */
function setField(key, value) {
  form.value = { ...form.value, [key]: value };
}

/**
 * One text field in the builders' name-window shape.
 *
 * @param {string} key
 * @param {string} label
 * @param {string} type
 * @param {string} [placeholder]
 */
function field(key, label, type, placeholder) {
  return html`
    <label class="vfd bname">
      <span class="l">${label}</span>
      <input
        type=${type}
        class="bnin"
        placeholder=${placeholder || ""}
        value=${/** @type {Record<string, string>} */ (form.value)[key]}
        onInput=${(/** @type {{ target: HTMLInputElement }} */ e) => {
          if (key === "host") hostTouched.value = true;
          setField(key, e.target.value);
        }}
      />
    </label>
  `;
}

/** The host field with Detect and Connect beside it. */
function hostRow() {
  return html`
    <div class="crow">
      ${field("host", "Host", "text")}
      <button type="button" class="btn sm" data-testid="conn-detect" disabled=${discovering.value} onClick=${detectHosts}>
        Detect
      </button>
      <button type="button" class="btn sm" data-testid="conn-connect" onClick=${() => submitConnection()}>Connect</button>
    </div>
  `;
}

/** One "(enter it for me)" link: the address it names goes straight into the host field. */
function hostLink(/** @type {string} */ address) {
  return html`<button type="button" class="cfill" data-host=${address} onClick=${() => fillHost(address)}>
    ${"(enter it for me)"}
  </button>`;
}

/** What to put in the address field, with the two same-machine fills. */
function hostHelp() {
  return html`
    <p class="man">${"Enter the address of your HQPlayer Embedded machine. If HQPlayer is running on the same machine you're using now..."}</p>
    <ul class="copts">
      <li class="man">${'If running HQPTuner in Docker, enter "host.docker.internal" '}${hostLink("host.docker.internal")}</li>
      <li class="man">${'Otherwise, enter "127.0.0.1" '}${hostLink("127.0.0.1")}</li>
    </ul>
  `;
}

/** The daemon's own page, built from an address the browser can reach. */
function authLink() {
  const host = form.value.host.trim();
  const reachable = !host || SERVER_SIDE_ONLY.includes(host) ? pageHost.value : host;
  return html`<a href=${`http://${reachable}:8088/auth`} target="_blank" rel="noreferrer" data-testid="daemon-auth-link">
    ${"default web page at port 8088"}
  </a>`;
}

/** The report on the last press of Connect, or nothing before the first one. */
function report() {
  const v = verdict.value;
  if (!v) return null;
  return html`<p class="man">${VERDICTS[v] || ""}</p>`;
}

/** @param {boolean} remember which option this radio is */
function rememberRow(remember, /** @type {string} */ label) {
  return html`
    <label class="chk">
      <input
        type="radio"
        name="setup-remember"
        checked=${form.value.remember === remember}
        onChange=${() => setField("remember", remember)}
      />
      <span>${label}</span>
    </label>
  `;
}

/**
 * Set the sheet's top to the body's top on the plate.
 *
 * @param {HTMLElement | null} el
 */
function place(el) {
  const face = el?.closest(".plate");
  if (!el || !face) return;
  const b = /** @type {HTMLElement | null} */ (face.querySelector(".body"));
  el.style.top = `${b?.offsetTop ?? 0}px`;
}

/** The connection panel, always drawn; closed, it carries `data-closed`. */
export function ConnPanel() {
  const open = setupOpen.value;
  const fit = plate.value;
  const ref = useRef(/** @type {HTMLElement | null} */ (null));
  useLayoutEffect(() => place(ref.current), [open, fit]);
  useEffect(() => {
    if (open) ref.current?.querySelector("input")?.focus();
  }, [open]);
  return html`
    <aside
      ref=${ref}
      class="sheet csheet"
      role="dialog"
      aria-label="Connection"
      data-testid="conn-panel"
      data-verdict=${verdict.value || ""}
      data-closed=${open ? undefined : ""}
      inert=${!open}
    >
      <div class="shead"><span class="t">Connection</span></div>
      <div class="cbody">
        <p class="man">${"HQPTuner needs two things to run: the address of your HQPlayer Embedded daemon, and its credentials."}</p>
        <p class="man">
          ${"If you haven't set the credentials already, do that by running "}
          <code>${"hqplayerd -u <username> <password>"}</code>${" on the HQPlayer machine, or change it from the "}${authLink()}${
            ". The " + 'defaults are "hqplayer" and "password"; if they don\'t work, changing them usually will.'
          }
        </p>
        ${hostRow()} ${report()} ${hostHelp()} ${field("username", "Username", "text")}
        ${field(
          "password",
          "Password",
          "password",
          form.value.hasPassword ? "Leave blank to keep the stored password" : "Leave empty to keep the default",
        )}
        <div class="crem">
          ${rememberRow(true, "Let HQPTuner store my password")} ${rememberRow(false, "Ask every time HQPTuner starts")}
        </div>
        <div class="cbtns">
          <button type="button" class="btn" data-testid="conn-save" onClick=${() => submitConnection(true)}>Save</button>
          <button type="button" class="btn" data-testid="conn-close" onClick=${closeSetup}>Close</button>
        </div>
      </div>
    </aside>
  `;
}
