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
import { html } from "../lib/dom.js";
import { Card } from "./common.js";
import {
  setupOpen,
  daemons,
  discovering,
  form,
  hostTouched,
  closeSetup,
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
 */
function textRow(key, label, type) {
  return html`
    <label class="setup-row">
      <span class="t-label">${label}</span>
      <input
        type=${type}
        value=${/** @type {Record<string, string>} */ (form.value)[key]}
        onInput=${(/** @type {{ target: HTMLInputElement }} */ e) => {
          if (key === "host") hostTouched.value = true;
          setField(key, e.target.value);
        }}
      />
    </label>
  `;
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
  if (!setupOpen.value) return null;
  return html`
    <div class="setup-scrim">
      <div class="setup-panel">
        <${Card} title="Connection" cardClass="setup-card">
          <p class="t-caption">
            HQPTuner needs two things to run: the address of your HQPlayer Embedded daemon, and its credentials.
          </p>
          <p class="t-caption">
            If you haven't set the credentials already, do that with
            <code>${"hqplayerd -u <username> <password>"}</code>, or from the default web page at port 8088. The
            defaults are "hqplayer" and "password".
          </p>
          ${textRow("host", "Host", "text")} ${found()} ${textRow("username", "Username", "text")}
          ${textRow("password", "Password", "password")}
          <div class="setup-remember">
            ${rememberRow(true, "Let HQPTuner store my password")}
            ${rememberRow(false, "Ask every time HQPTuner starts")}
          </div>
          <div class="setup-buttons">
            <button type="button" onClick=${() => submitConnection()}>Save</button>
            <button type="button" onClick=${closeSetup}>Close</button>
          </div>
        <//>
      </div>
    </div>
  `;
}
