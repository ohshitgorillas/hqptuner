// Matrix profile card — step 5 of the delivery order (matrix-spec §8). Split
// out of MatrixTab.js verbatim; the four profile signals below are private to
// this module and have no writer outside it.
import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import { api } from "../lib/api.js";
import { matrixProfiles, matrixActiveProfile, refreshConfig } from "../store/state.js";
import { notesVisible } from "../store/prefs.js";

// The picker + Switch rides the live 4321 lane (zero reload — the one lane the
// "applies live" indicator is true for, probe findings); Load/Save-as-new/Delete
// ride the form lane, which reloads the engine ~3 s, interrupting playback.
// A named Load also replaces the post-process state — captioned,
// since the daemon gives no warning.
const profileSel = signal(null); // picker value; null = follow the active profile
const profileNewName = signal("");
const profileBusy = signal("");
const profileNote = signal("");

async function profileAct(action, name) {
  profileBusy.value = action;
  profileNote.value = "";
  try {
    await api.matrixProfile(action, name);
    profileNote.value = action === "switch" ? `switched — live, no reload` : `${action} done`;
    if (action === "delete") profileSel.value = null;
    if (action === "save") profileNewName.value = "";
    await refreshConfig();
  } catch (e) {
    profileNote.value = `${action} failed: ${e.message}`;
  } finally {
    profileBusy.value = "";
  }
}

// Two lanes, two visually distinct rows (design-pass item 5): the primary row is
// the live 4321 switch (zero reload); the secondary row is the form-lane
// load/delete (~3 s engine reload, playback-interrupting). Captions sit BELOW
// their row at caption measure, gated by the Feature-descriptions toggle like
// every tab — one gate, three captions.
function ProfileNote({ children }) {
  return notesVisible.value ? html`<div class="field-note">${children}</div>` : null;
}

// Save-as-new: name box + its button. The daemon silently ignores a save to an
// existing name, so an existing name disables the button and says why.
function ProfileSaveRow({ saved, busy }) {
  const newName = profileNewName.value.trim();
  const exists = saved.includes(newName);
  return html`
    <div class="mtx-profile-row">
      <input
        type="text"
        placeholder="new profile name"
        value=${profileNewName.value}
        disabled=${!!busy}
        onInput=${(e) => (profileNewName.value = e.target.value)}
      />
      <button
        type="button"
        class="mtx-tool"
        disabled=${!!busy || !newName || exists}
        title=${
          exists
            ? "That name exists — the daemon silently ignores a save to an existing profile (delete it first)"
            : "Save the current matrix as a new profile"
        }
        onClick=${() => profileAct("save", newName)}
      >
        Save as new
      </button>
    </div>
  `;
}

export function ProfileCard() {
  const saved = matrixProfiles.value;
  const active = matrixActiveProfile.value;
  const sel = profileSel.value ?? (active === "[Default]" ? "" : active);
  const busy = profileBusy.value;
  return html`
    <section class="card">
      <div class="card-head">Profile</div>
      <div class="card-body mtx-profile">
        <div class="mtx-read-row">
          <dt>Active</dt>
          <dd>${active}</dd>
        </div>
        <div class="mtx-profile-row mtx-profile-primary">
          <select value=${sel} disabled=${!!busy} onChange=${(e) => (profileSel.value = e.target.value)}>
            <option value="">[Default]</option>
            ${saved.map((n) => html`<option value=${n}>${n}</option>`)}
          </select>
          <button
            type="button"
            class="mtx-tool mtx-primary"
            disabled=${!!busy}
            title="Switch the running matrix to this profile — live, no engine reload"
            onClick=${() => profileAct("switch", sel)}
          >
            Switch
          </button>
          <span class="mtx-live-tag">live — no reload</span>
        </div>
        <${ProfileNote}>
          Profiles can be switched at any time, during playback as well — no engine reload. The switch is
          live-only: the daemon reverts to its saved configuration on restart.
        <//>
        <div class="mtx-profile-row">
          <button
            type="button"
            class="mtx-tool"
            disabled=${!!busy}
            title="Load this saved profile into the matrix configuration (~3 s engine reload)"
            onClick=${() => profileAct("load", sel)}
          >
            Load
          </button>
          <button
            type="button"
            class="mtx-tool mtx-remove"
            disabled=${!!busy || !sel}
            title="Delete this saved profile"
            onClick=${() => profileAct("delete", sel)}
          >
            Delete
          </button>
        </div>
        <${ProfileNote}>
          Load replaces the pipelines (engine must be idle; two ~3 s engine reloads). HQPlayer's own load also
          clears the post-process settings — crossfeed, DAC correction, loudness — but HQPTuner restores them for
          you afterwards.
        <//>
        <${ProfileSaveRow} saved=${saved} busy=${busy} />
        <${ProfileNote}>
          Saves the current matrix as a new named profile. The daemon silently ignores a save to an existing name
          — delete the old profile first.
        <//>
        ${profileNote.value ? html`<div class="mtx-issues">${profileNote.value}</div>` : null}
      </div>
    </section>
  `;
}
