// Matrix profile card — step 5 of the delivery order (matrix-spec §8), rebuilt
// for round 5. The four signals below are private to this module and have no
// writer outside it.
//
// Nothing here reloads the engine. A load is the live 4321 lane and nothing
// else (MatrixSetProfile: instant, playback undisturbed), so it lasts until the
// daemon restarts — HQPlayer's own semantics for the switch. A profile is a
// whole matrix context, `<post_process>` included (readme §1.11.2), so the
// switch installs the profile's plugin chain along with its rows. A save or a delete is a staged <matrix_profile> config edit,
// because hqplayerd registers a saved profile in memory only and never writes
// the element — a profile saved its way is gone at the next daemon start. Save
// and Load are therefore one lane each, and neither is ever refused for
// playback state.
import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { html, wheelGuard } from "../lib/dom.js";
import { api } from "../lib/api.js";
import { errText } from "../lib/errtext.js";
import { config } from "../store/signals.js";
import { effectivePipelines } from "../store/resolve.js";
import { stagePipelines } from "../store/actions.js";
import { refreshConfig } from "../store/sync.js";
import {
  savedProfiles,
  matrixActiveProfile,
  isLiveProfile,
  profileRows,
  profilePost,
  presetProfiles,
  stageProfileSave,
  stageProfileDelete,
  profileSavePending,
} from "../store/profiles.js";
import { descriptionFor, descriptionError, queueDescription, flushDescriptions } from "../store/descriptions.js";
import { askChoices } from "../store/ask.js";
import { notesVisible } from "../store/prefs.js";
import { Ask } from "./Ask.js";
import { Card } from "./common.js";

const OWNER = "matrix-profile";

// What a staged save still needs, stated on the card for as long as it needs it.
// Not a manual note and so not gated on the description preference: a
// description explains a control, this states the consequence of using one. A
// save is a staged <matrix_profile> config edit, and the only thing that writes
// it out is Apply, whose persistent lane restarts the engine — so a profile
// saved and never applied is gone. The line names Apply because there is no
// separate restart control to point at, and it follows the staged edit rather
// than standing on the card forever: Discard takes the save back, and the line
// would be describing nothing.
const SAVE_CONSEQUENCE = "Restart the engine (Apply) to finalize the save.";

const profileSel = signal(null); // picker value; null = follow the active profile
const profileNewName = signal("");
const profileBusy = signal("");
const profileNote = signal("");
// What the user is typing into the description box, and which profile it is for.
// A draft rather than a value read straight off the store because the config
// poll refreshes every two seconds: a box bound to stored text would be rewritten
// mid-sentence. Null means "nothing being typed" and the box shows what is
// stored. Cleared whenever the box binds to a different profile.
const draft = signal(/** @type {{ name: string, text: string } | null} */ (null));

// A load is the live switch, and staging is not part of it: the switch already
// installs the whole matrix context — rows and post-process chain — in the
// running engine, so staging it too would only pend a config write whose sole
// effect at apply is an engine restart that changes nothing. Persisting a matrix
// is what Save is for. The one profile with no live half is one the daemon has
// never read — saved in this session, not yet applied — and staging is the only
// lane it has, which means staging its chain as well as its rows.
/**
 * Switches the running engine to saved matrix profile `name` and refreshes config;
 * a profile the daemon has never read is staged instead.
 *
 * @public — the Load button's action, and the seam the profile suite drives.
 * @param {string} name the saved profile's name; "" is the default profile
 * @returns {Promise<void>}
 */
export async function loadProfile(name) {
  if (!name || isLiveProfile(name)) {
    await api.matrixProfile("switch", name);
    await refreshConfig();
    return;
  }
  const rows = profileRows(name);
  if (rows) await stagePipelines(rows, profilePost(name) || {});
}

// Which stored presets the profile verb should also land in. Saving offers
// every stored preset; deleting offers only the presets that actually hold the
// profile. The current preset is pinned checked — the staged edit writes the
// applied config regardless, and pinning keeps the picker honest about that.
// Resolves the chosen names, [] when there is nothing to ask (no popup), or
// null when the user backs out.
/**
 * @param {string} profileName
 * @param {boolean} saving true for a save, false for a delete
 * @returns {Promise<string[] | null>}
 */
async function pickPresets(profileName, saving) {
  const membership = presetProfiles.value;
  const active = (config.value && config.value.active) || "";
  /** @param {string} name */
  const holds = (name) => (membership[name] || []).includes(profileName);
  /** @type {ChoiceOption[]} */
  const options = Object.keys(membership)
    .sort((a, b) => a.localeCompare(b))
    .filter((name) => saving || holds(name) || name === active)
    .map((name) => ({
      value: name,
      label: name === active ? `${name} (current)` : name,
      checked: name === active || holds(name),
      disabled: name === active,
    }));
  if (!options.some((o) => !o.disabled)) return options.filter((o) => o.checked).map((o) => o.value);
  // askChoices is declared as resolving `unknown` because store/ask.js serves
  // three kinds through one promise; the choices kind resolves the checked
  // values, or null when the user backs out.
  return /** @type {Promise<string[] | null>} */ (askChoices(OWNER, "Select the presets for the profile:", options));
}

// Success is visually obvious (staged chips, the picker, the live tag), so an
// action only ever writes a note on failure.
/**
 * @param {string} action the verb, shown as the busy marker and in a failure note
 * @param {() => Promise<void>} run
 * @returns {Promise<void>}
 */
async function act(action, run) {
  profileBusy.value = action;
  profileNote.value = "";
  try {
    await run();
  } catch (e) {
    profileNote.value = `${action} failed: ${errText(e)}`;
  } finally {
    profileBusy.value = "";
  }
}

/**
 * @param {{ children?: unknown }} props
 */
function ProfileNote({ children }) {
  return notesVisible.value ? html`<div class="field-note">${children}</div>` : null;
}

// Save: name box + its button. An existing name is allowed — HQPTuner writes the
// element, so a save onto a name replaces it (the daemon's own route silently
// no-ops instead).
/**
 * @param {{ saved: string[], busy: string }} props
 */
function ProfileSaveRow({ saved, busy }) {
  const newName = profileNewName.value.trim();
  const exists = saved.includes(newName);
  return html`
    <div class="control">
      <input
        type="text"
        placeholder="profile name"
        value=${profileNewName.value}
        disabled=${!!busy}
        onInput=${(/** @type {{ target: HTMLInputElement }} */ e) => (profileNewName.value = e.target.value)}
      />
      <button
        type="button"
        class="mtx-tool"
        disabled=${!!busy || !newName}
        title=${exists ? `Replace "${newName}" with the current matrix` : "Save the current matrix under this name"}
        onClick=${() =>
          act("save", async () => {
            const targets = await pickPresets(newName, true);
            if (targets === null) return;
            await stageProfileSave(newName, effectivePipelines.value, targets);
            profileNewName.value = "";
            // Move the picker onto what was just saved, so the description box
            // stays bound to the same profile as the name field empties under it.
            profileSel.value = newName;
          })}
      >
        ${exists ? "Replace" : "Save"}
      </button>
    </div>
  `;
}

// The description box. It binds to the name in the Save-as field while there is
// one, and to the picker's selection otherwise: the moment a description exists
// in the user's head is the moment they are naming the profile, so making them
// save first and come back to describe it would be the wrong order. After a save
// the name field clears and the picker moves to the new name, which is the same
// profile — so the text on screen keeps standing for the same thing.
//
// [Default] takes no description: it is not a saved profile and has no name to
// key one by, so the box is present and disabled rather than absent, and says
// which of the two the user has to do first.
/**
 * @param {string} updated an entry's ISO-8601 stamp
 * @returns {string}
 */
function editedOn(updated) {
  const at = new Date(updated);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// Which profile the box is describing, and what it is showing: the draft while
// one is being typed for that profile, the stored text otherwise. `bound` is ""
// when neither a saved profile nor a new name is in play — [Default].
/**
 * @param {string} sel the picker's selection
 * @returns {{ bound: string, stored: { text: string, updated: string } | null, text: string, unsaved: boolean }}
 */
function describing(sel) {
  const bound = profileNewName.value.trim() || sel;
  const stored = bound ? descriptionFor(bound) : null;
  const storedText = stored ? stored.text : "";
  const d = draft.value;
  const text = d && d.name === bound ? d.text : storedText;
  return { bound, stored, text, unsaved: text !== storedText };
}

// The one line under the box, saying which of three things is true: the write
// failed, the text has not been written yet, or here is when it last was.
/**
 * @param {{ stored: { text: string, updated: string } | null, unsaved: boolean }} props
 */
function DescriptionState({ stored, unsaved }) {
  if (descriptionError.value) {
    return html`<span class="mtx-issues">Description not saved — ${descriptionError.value}. Your text is here.</span>`;
  }
  if (unsaved) return "Saves when you pause typing.";
  return stored ? `Edited ${editedOn(stored.updated)}` : "";
}

/**
 * @param {{ sel: string }} props
 */
function DescriptionField({ sel }) {
  const { bound, stored, text, unsaved } = describing(sel);
  // A description is written where the user is, and left behind where they are
  // not: a card that unmounts on a tab switch takes the box with it, and the
  // paragraph in it has to reach the server on the way out.
  useEffect(() => () => void flushDescriptions(), []);
  return html`
    <div class="field">
      <label>Description${bound ? ` — ${bound}` : ""}</label>
      <textarea
        class="mtx-desc"
        rows="4"
        placeholder=${
          bound
            ? "Room, mic, target, date — whatever the name can't hold."
            : "Pick a saved profile, or name one above, to describe it."
        }
        disabled=${!bound}
        value=${text}
        onInput=${(/** @type {{ target: HTMLTextAreaElement }} */ e) => {
          draft.value = { name: bound, text: e.target.value };
          queueDescription(bound, e.target.value);
        }}
        onBlur=${() => void flushDescriptions()}
      ></textarea>
      <div class="mtx-desc-state"><${DescriptionState} stored=${stored} unsaved=${unsaved} /></div>
    </div>
  `;
}

// The saved-profile picker and its two actions. Load runs live; Delete asks
// which presets the removal should reach before it touches anything.
/**
 * @param {{ saved: string[], sel: string, busy: string }} props
 */
function SavedProfilesField({ saved, sel, busy }) {
  return html`
        <div class="field">
          <label>Saved profiles</label>
          <div class="control">
          <select
            value=${sel}
            disabled=${!!busy}
            onWheel=${wheelGuard}
            onChange=${(/** @type {{ target: HTMLSelectElement }} */ e) => (profileSel.value = e.target.value)}
          >
            <option value="">[Default]</option>
            ${saved.map((n) => html`<option value=${n}>${n}</option>`)}
          </select>
          <button
            type="button"
            class="mtx-tool mtx-primary"
            disabled=${!!busy}
            title="Load this profile into the running matrix"
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
                const targets = await pickPresets(sel, false);
                if (targets === null) return;
                await stageProfileDelete(sel, targets);
                profileSel.value = null;
              })}
          >
            Delete
          </button>
        </div>
        <${ProfileNote}>
          Profiles load live with no engine restart. A profile holds the whole matrix: the settings in General, the
          current pipelines, and the crossfeed, DAC correction and loudness that run with them.
        <//>
        </div>
  `;
}

/**
 * Renders the Profile card: the active matrix profile, the saved-profile picker
 * with its load/delete actions, and the save-as row.
 */
export function ProfileCard() {
  const saved = savedProfiles.value;
  const active = matrixActiveProfile.value;
  const sel = profileSel.value ?? (active === "[Default]" ? "" : active);
  const busy = profileBusy.value;
  return html`
    <${Card} title="Profile" bodyClass="mtx-profile">
        <div class="field">
          <label>Active</label>
          <div class="t-value">${active}</div>
        </div>
        <${SavedProfilesField} saved=${saved} sel=${sel} busy=${busy} />
        <div class="field">
          <label>Save as</label>
          <${ProfileSaveRow} saved=${saved} busy=${busy} />
          <${ProfileNote}>
            Save the current Matrix settings to one or more presets.
          <//>
          ${profileSavePending.value ? html`<div class="mtx-save-note">${SAVE_CONSEQUENCE}</div>` : null}
        </div>
        <${DescriptionField} sel=${sel} />
        <${Ask} owner=${OWNER} />
        ${profileNote.value ? html`<div class="mtx-issues">${profileNote.value}</div>` : null}
    <//>
  `;
}
