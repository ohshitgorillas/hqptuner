// The matrix profile picker is its own lane: MatrixSetProfile is a live 4321
// switch, not a config field, so it never goes through POST /api/config/live. It
// also never stages here — the tabs view's card is where a profile is saved to
// the configuration; this one only switches the running matrix. A profile saved
// in this session and not applied yet is therefore unreachable: the daemon knows
// only the profiles it read at startup.
import { signal } from "@preact/signals";
import { html } from "../../lib/dom.js";
import { errText } from "../../lib/errtext.js";
import { api } from "../../lib/api.js";
import { liveMatrixOpen } from "../../store/prefs.js";
import { refreshConfig } from "../../store/sync.js";
import { savedProfiles, matrixActiveProfile, isLiveProfile } from "../../store/matrix/profiles.js";
import { descriptionFor } from "../../store/matrix/descriptions.js";
import { Dropdown } from "../controls/index.js";
import { Card } from "../common.js";
import { cardCollapse } from "./collapse.js";

const profileBusy = signal(false);
const profileError = signal("");

/** @param {string} name */
async function switchProfile(name) {
  profileBusy.value = true;
  profileError.value = "";
  try {
    await api.matrixProfile("switch", name);
    await refreshConfig();
  } catch (e) {
    profileError.value = errText(e);
  } finally {
    profileBusy.value = false;
  }
}

/** @param {string[]} saved */
function profileOptions(saved) {
  return [
    { value: "", label: "[Default]" },
    ...saved.map((n) => ({
      value: n,
      label: n,
      disabled: !isLiveProfile(n),
      reason: isLiveProfile(n) ? "" : "not loaded by the engine",
    })),
  ];
}

/** The LIVE page's matrix profile card: which profile the running matrix is on. */
export function MatrixProfileCard() {
  const active = matrixActiveProfile.value;
  // What the user wrote about the profile that is running, if they wrote
  // anything. No box and no empty state: LIVE is a status page, and an empty
  // frame here would be a control that does nothing. The description reads in
  // the content gray against the muted caption below it, which is what separates
  // the user's own words from ours.
  const described = descriptionFor(active);
  return html`
    <${Card} id="matrix-profile" title="Matrix profile" collapse=${cardCollapse("matrix", liveMatrixOpen)}>
      <div class="field">
        <label>Profile</label>
        <div class="control">
          <${Dropdown}
            value=${active === "[Default]" ? "" : active}
            options=${profileOptions(savedProfiles.value)}
            disabled=${profileBusy.value}
            onChange=${switchProfile}
          />
        </div>
        ${described ? html`<div class="live-desc">${described.text}</div>` : null}
        <div class="field-note">
          Switches the running matrix immediately — no engine reload, and your crossfeed, DAC correction and loudness
          settings are left alone. A live switch alone is dropped at the next daemon restart; save it from the Matrix tab
          to keep it.
        </div>
        ${profileError.value ? html`<div class="live-error">${profileError.value}</div>` : null}
      </div>
    <//>
  `;
}
