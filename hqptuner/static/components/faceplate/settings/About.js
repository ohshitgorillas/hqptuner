// The settings page under the drawers. About HQPlayer: the engine identity as a row of labelled VFD windows across the
// full width, then the backup download and restore upload beside their line. About HQPTuner: the version line and the
// state download and upload, then the prose.

import { computed, signal } from "@preact/signals";
import { html } from "../../../lib/dom.js";
import { api } from "../../../lib/api.js";
import { health } from "../../../store/signals.js";
import { duringEngineWrite } from "../../../store/enginewrite.js";
import { errText } from "../../../lib/errtext.js";
import { importState, importStatus } from "../../../store/stateimport.js";
import { Section } from "../Page.js";

const info = computed(() => (health.value && health.value.info) || {});
const release = computed(() => (health.value && health.value.release) || "");
const license = computed(() => (health.value && health.value.license) || {});
const appVersion = computed(() => (health.value && health.value.app_version) || "");

/**
 * @param {{ valid?: string | number | boolean } | null | undefined} l the health payload's `license` block
 * @returns {string}
 */
const licenseLabel = (l) => {
  if (!l || l.valid == null) return "";
  const v = String(l.valid).toLowerCase();
  const trial = v === "" || v === "0" || v === "false" || v === "trial";
  return trial ? "FALSE" : "TRUE";
};

const BACKUP =
  "Download a backup of the daemon's configuration, or restore one — served by hqplayerd's own /backup and /restore routes.";

const restoreStatus = signal("");

/**
 * @param {{ target: HTMLInputElement }} e the file input's change event
 */
async function onRestore(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  restoreStatus.value = "restoring…";
  try {
    await duringEngineWrite(() => api.restore(file));
    restoreStatus.value = "Restored — daemon restarting.";
  } catch (err) {
    restoreStatus.value = `Failed: ${errText(err)}`;
  }
}

/**
 * Import a chosen state file; the store reports how it went.
 *
 * @param {{ target: HTMLInputElement }} e the file input's change event
 */
async function onStateImport(e) {
  const file = e.target.files && e.target.files[0];
  // Cleared so that choosing the same file again fires another change.
  e.target.value = "";
  if (file) await importState(file);
}

/**
 * A push button that opens a file picker, its input hidden inside the label.
 *
 * @param {string} label
 * @param {string} accept
 * @param {string} testid
 * @param {(e: { target: HTMLInputElement }) => Promise<void>} onChange
 */
const filePick = (label, accept, testid, onChange) =>
  html`<label class="btn"
    >${label}<input type="file" accept=${accept} hidden data-testid=${testid} onChange=${onChange}
  /></label>`;

/**
 * @param {string} href
 * @param {string} label
 */
const ext = (href, label) => html`<a href=${href} target="_blank" rel="noopener noreferrer">${label}</a>`;

function Identity() {
  const i = info.value;
  const rows = [
    ["Product", i.product],
    ["Version", release.value],
    ["Engine", i.engine],
    ["Licensed", licenseLabel(license.value)],
    ["Platform", i.platform],
  ].filter((r) => r[1]);
  return html`
    <div class="idrow span" role="list" aria-label="Engine identity">
      ${rows.map(
        ([k, v]) => html`<div class="vfd" role="listitem"><span class="l">${k}</span><span class="v">${v}</span></div>`,
      )}
    </div>
  `;
}

/** The settings page: About HQPlayer, then About HQPTuner. */
export function About() {
  return html`
    <main class="page spage">
      <${Section} id="about-hqplayer" title="About HQPlayer" bodyCls="pairs">
        <${Identity} />
        <div class="inline">
          <a class="btn" href="/api/backup" download data-testid="backup-download">Download backup</a>
          ${filePick("Upload backup", ".zip,.xml", "backup-upload", onRestore)}
        </div>
        <div class="man">
          <p>${BACKUP}</p>
          ${restoreStatus.value ? html`<p class="mnote">${restoreStatus.value}</p>` : null}
        </div>
      <//>
      <${Section} id="about-hqptuner" title="About HQPTuner" bodyCls="pairs">
        <div class="stack">
          <span class="cap"
            >${appVersion.value ? `HQPTuner ${appVersion.value} · ` : ""}Released under the${" "}
            ${ext("https://opensource.org/license/mit", "MIT License")}.</span
          >
          <div class="inline">
            <a class="btn" href="/api/state-export" download data-testid="state-export">Download state</a>
            ${filePick("Upload state", ".zip", "state-import", onStateImport)}
          </div>
        </div>
        <div class="man">
          <p>HQPTuner is a project by user oh shit, gorillas! to bring out the untapped UX potential of HQPlayer Embedded.</p>
          <p>
            Most credit goes to Jussi Laako/Signalyst. I'm just plugging into what he does and trying to make it easy and
            pretty. Thanks, Jussi!
          </p>
          <p>
            HQPTuner is free and always will be. If it enhances your audio experience, then it's done its job and a simple
            "thank you" is all the payment I need. That said, if you really want your specific "thank you" to be
            financial, I won't stop you from ${ext("https://ko-fi.com/ohshitgorillas", "buying me a coffee")}. Just don't
            say I strong-armed you into it ;)
          </p>
          ${importStatus.value ? html`<p class="mnote">${importStatus.value}</p>` : null}
        </div>
      <//>
    </main>
  `;
}
