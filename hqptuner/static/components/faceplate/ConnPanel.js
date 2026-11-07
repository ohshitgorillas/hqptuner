// The connection panel as a faceplate sheet: the connection fields over store/connpanel.js, from the body's top to the
// plate's foot, so the header and the knob's lamp stay in view. Escape is the Plate's (closeTop).

import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { plate } from "../../store/faceplate/plate.js";
import { panelOpen } from "../../store/faceplate/view.js";
import { useBodyResize } from "./Popover.js";
/** @typedef {import("../../store/connpanel.js").ConnPanelStore} ConnPanelStore */

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
function setField(/** @type {ConnPanelStore} */ panel, key, value) {
  panel.form.value = { ...panel.form.value, [key]: value };
}

/**
 * One text field in the builders' name-window shape.
 *
 * @param {string} key
 * @param {string} label
 * @param {{ type: string, placeholder?: string }} options
 */
function field(/** @type {ConnPanelStore} */ panel, key, label, options) {
  const { type, placeholder } = options;
  return html`
  <label class="vfd bname">
    <span class="l">${label}</span>
    <input
      type=${type}
      class="bnin"
      placeholder=${placeholder || ""}
      value=${/** @type {Record<string, string>} */ (panel.form.value)[key]}
      onInput=${(/** @type {{ target: HTMLInputElement }} */ e) => {
        if (key === "host") panel.hostTouched.value = true;
        setField(panel, key, e.target.value);
      }}
    />
  </label>
`;
}

/** The host field with Detect and Connect beside it. */
function hostRow(/** @type {ConnPanelStore} */ panel) {
  return html`
  <div class="crow">
    ${field(panel, "host", "Host", { type: "text" })}
    <button type="button" class="btn sm" data-testid="conn-detect" disabled=${panel.discovering.value} onClick=${panel.detectHosts}>
      Detect
    </button>
    <button type="button" class="btn sm" data-testid="conn-connect" onClick=${() => panel.submitConnection()}>Connect</button>
  </div>
`;
}

/** One "(enter it for me)" link: the address it names goes straight into the host field. */
function hostLink(/** @type {ConnPanelStore} */ panel, /** @type {string} */ address) {
  return html`<button type="button" class="cfill" data-host=${address} onClick=${() => panel.fillHost(address)}>
  ${"(enter it for me)"}
</button>`;
}

/** What to put in the address field, with the two same-machine fills. */
function hostHelp(/** @type {ConnPanelStore} */ panel) {
  return html`
  <p class="man">${"Enter the address of your HQPlayer Embedded machine. If HQPlayer is running on the same machine you're using now..."}</p>
  <ul class="copts">
    <li class="man">${'If running HQPTuner in Docker, enter "host.docker.internal" '}${hostLink(panel, "host.docker.internal")}</li>
    <li class="man">${'Otherwise, enter "127.0.0.1" '}${hostLink(panel, "127.0.0.1")}</li>
  </ul>
`;
}

/** The daemon's own page, built from an address the browser can reach. */
function authLink(/** @type {ConnPanelStore} */ panel) {
  const host = panel.form.value.host.trim();
  const reachable = !host || SERVER_SIDE_ONLY.includes(host) ? panel.pageHost.value : host;
  return html`<a href=${`http://${reachable}:8088/auth`} target="_blank" rel="noreferrer" data-testid="daemon-auth-link">
  ${"default web page at port 8088"}
</a>`;
}

/** The report on the last press of Connect, or nothing before the first one. */
function report(/** @type {ConnPanelStore} */ panel) {
  const v = panel.verdict.value;
  if (!v) return null;
  return html`<p class="man">${VERDICTS[v] || ""}</p>`;
}

/** @param {boolean} remember which option this radio is */
function rememberRow(/** @type {ConnPanelStore} */ panel, remember, /** @type {string} */ label) {
  return html`
  <label class="chk">
    <input
      type="radio"
      name="setup-remember"
      checked=${panel.form.value.remember === remember}
      onChange=${() => setField(panel, "remember", remember)}
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

/** The connection panel sheet.
 * @param {{ panel: ConnPanelStore }} props
 */
export function ConnPanel({ panel }) {
  const open = panelOpen.value;
  const fit = plate.value;
  const ref = useRef(/** @type {HTMLElement | null} */ (null));
  useLayoutEffect(() => place(ref.current), [open, fit]);
  useBodyResize(ref, () => place(ref.current));
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
      data-verdict=${panel.verdict.value || ""}
      data-closed=${open ? undefined : ""}
      inert=${!open}
    >
      <div class="shead"><span class="t">Connection</span></div>
      <div class="cbody">
        <p class="man">${"HQPTuner needs two things to run: the address of your HQPlayer Embedded daemon, and its credentials."}</p>
        <p class="man">
          ${"If you haven't set the credentials already, do that by running "}
          <code>${"hqplayerd -u <username> <password>"}</code>${" on the HQPlayer machine, or change it from the "}${authLink(panel)}${
            ". The " + 'defaults are "hqplayer" and "password"; if they don\'t work, changing them usually will.'
          }
        </p>
        ${hostRow(panel)} ${report(panel)} ${hostHelp(panel)} ${field(panel, "username", "Username", { type: "text" })}
        ${field(panel, "password", "Password", {
          type: "password",
          placeholder: panel.form.value.hasPassword
            ? "Leave blank to keep the stored password"
            : "Leave empty to keep the default",
        })}
        <div class="crem">
          ${rememberRow(panel, true, "Let HQPTuner store my password")} ${rememberRow(panel, false, "Ask every time HQPTuner starts")}
        </div>
        <div class="cbtns">
          <button type="button" class="btn" data-testid="conn-save" onClick=${() => panel.submitConnection(true)}>Save</button>
          <button type="button" class="btn" data-testid="conn-close" onClick=${panel.closePanel}>Close</button>
        </div>
      </div>
    </aside>
  `;
}
