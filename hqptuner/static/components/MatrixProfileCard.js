// Matrix profile card — step 5 of the delivery order (matrix-spec §8), rebuilt
// for round 5. The four signals below are private to this module and have no
// writer outside it.
//
// Nothing here reloads the engine. A load is the live 4321 lane
// (MatrixSetProfile: instant, playback undisturbed, post-process untouched) plus
// a staged pipeline set, so the choice also persists; a save or a delete is a
// staged <matrix_profile> config edit, because hqplayerd registers a saved
// profile in memory only and never writes the element — a profile saved its way
// is gone at the next daemon start. Save and Load are therefore one lane each,
// and neither is ever refused for playback state.
import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import { api } from "../lib/api.js";
import { effectivePipelines } from "../store/resolve.js";
import { stagePipelines } from "../store/actions.js";
import { refreshConfig } from "../store/sync.js";
import {
  savedProfiles,
  matrixActiveProfile,
  isLiveProfile,
  profileRows,
  stageProfileSave,
  stageProfileDelete,
} from "../store/profiles.js";
import { notesVisible } from "../store/prefs.js";
import { Card } from "./tabs/common.js";

const profileSel = signal(null); // picker value; null = follow the active profile
const profileNewName = signal("");
const profileBusy = signal("");
const profileNote = signal("");

// A load has two halves and each is worth having on its own: the live switch
// makes it audible now, the staged rows make it survive. A profile the daemon has
// never read — saved in this session, not yet applied — has no live half.
async function loadProfile(name) {
  const rows = name ? profileRows(name) : null;
  if (rows) await stagePipelines(rows);
  if (!name || isLiveProfile(name)) {
    await api.matrixProfile("switch", name);
    await refreshConfig();
    return rows ? "loaded — live, and staged so it persists" : "loaded — live, no reload";
  }
  return "staged — this profile lands at your next apply";
}

async function act(action, run) {
  profileBusy.value = action;
  profileNote.value = "";
  try {
    profileNote.value = await run();
  } catch (e) {
    profileNote.value = `${action} failed: ${e.message}`;
  } finally {
    profileBusy.value = "";
  }
}

function ProfileNote({ children }) {
  return notesVisible.value ? html`<div class="field-note">${children}</div>` : null;
}

// Save: name box + its button. An existing name is allowed — HQPTuner writes the
// element, so a save onto a name replaces it (the daemon's own route silently
// no-ops instead).
function ProfileSaveRow({ saved, busy }) {
  const newName = profileNewName.value.trim();
  const exists = saved.includes(newName);
  return html`
    <div class="mtx-profile-row">
      <input
        type="text"
        placeholder="profile name"
        value=${profileNewName.value}
        disabled=${!!busy}
        onInput=${(e) => (profileNewName.value = e.target.value)}
      />
      <button
        type="button"
        class="mtx-tool"
        disabled=${!!busy || !newName}
        title=${exists ? `Replace "${newName}" with the current matrix` : "Save the current matrix under this name"}
        onClick=${() =>
          act("save", async () => {
            await stageProfileSave(newName, effectivePipelines.value);
            profileNewName.value = "";
            return exists ? `"${newName}" will be replaced at your next apply` : "staged — applies at your next apply";
          })}
      >
        ${exists ? "Replace" : "Save"}
      </button>
    </div>
  `;
}

export function ProfileCard() {
  const saved = savedProfiles.value;
  const active = matrixActiveProfile.value;
  const sel = profileSel.value ?? (active === "[Default]" ? "" : active);
  const busy = profileBusy.value;
  return html`
    <${Card} title="Profile" bodyClass="mtx-profile">
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
            title="Load this profile into the running matrix — live, no engine reload"
            onClick=${() => act("load", () => loadProfile(sel))}
          >
            Load
          </button>
          <button
            type="button"
            class="mtx-tool mtx-remove"
            disabled=${!!busy || !sel}
            title="Delete this saved profile"
            onClick=${() =>
              act("delete", async () => {
                await stageProfileDelete(sel);
                profileSel.value = null;
                return "staged — applies at your next apply";
              })}
          >
            Delete
          </button>
          ${
            // Only true for a profile the daemon read at startup. For one saved
            // in this session and not applied yet, Load stages its rows and the
            // tag would be a lie, so it says what will actually happen.
            !sel || isLiveProfile(sel)
              ? html`<span class="mtx-live-tag">live — no reload</span>`
              : html`<span class="mtx-live-tag">stages — applies at next apply</span>`
          }
        </div>
        <${ProfileNote}>
          Load takes effect immediately, during playback as well — no engine reload, and your crossfeed, DAC
          correction and loudness settings are left alone. The profile's pipelines are also staged, so the choice
          persists once you apply; a live switch on its own is dropped at the next daemon restart.
        <//>
        <${ProfileSaveRow} saved=${saved} busy=${busy} />
        <${ProfileNote}>
          Saves the matrix you are looking at, staged edits included, under this name — saving onto a name that
          exists replaces it. Saving and deleting land with your next apply, which is also what makes them stick:
          HQPlayer keeps a saved profile in memory only and forgets it when the daemon restarts, so HQPTuner writes
          the profile into the configuration itself. A profile saved this way but not yet applied loads by staging
          its pipelines, since HQPlayer only knows the profiles it read at startup.
        <//>
        ${profileNote.value ? html`<div class="mtx-issues">${profileNote.value}</div>` : null}
    <//>
  `;
}
