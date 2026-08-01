// Saved matrix profiles (matrix-spec.md "Probe findings — saved"). Split out of the store core at
// the file-length gate; nothing here reaches into its private signals — it
// stages through `edit` and reads staged values through `effective`, the same
// public seams every other store module uses.
//
// Two sources, and they mean different things:
//   file_profiles  — the <matrix_profile> elements the CONFIG carries. A profile
//                    here persists, and it carries its rows.
//   matrixProfiles — what the DAEMON read at startup (MatrixListProfiles). The
//                    only names a live MatrixSetProfile can reach.
// HQPTuner owns the element because hqplayerd never writes one: its /matrix/save
// registers the name in memory and the config it writes omits it, so a profile
// saved that way dies at the next daemon start. A save or a delete is therefore
// an ordinary staged config edit, and the picker shows the union of both sources
// plus a name staged but not yet applied — which exists as far as the user is
// concerned, and is the one case a load cannot switch live.
import { computed } from "@preact/signals";
import { matrixConfig } from "./signals.js";
import { effective } from "./resolve.js";
import { edit } from "./actions.js";

const SAVE = "matrix_profile_save";
const DELETE = "matrix_profile_delete";

const fileProfiles = computed(() => (matrixConfig.value && matrixConfig.value.file_profiles) || {});

// Names the daemon itself knows, from the live 4321 lane, falling back to the
// /matrix form's datalist when credentials keep the live list empty.
const daemonProfiles = computed(() => {
  const m = matrixConfig.value || {};
  if (m.live_profiles && m.live_profiles.length) return m.live_profiles;
  return ((m.profiles && m.profiles.options) || []).map((o) => o.value).filter(Boolean);
});

export const matrixActiveProfile = computed(() => {
  const m = matrixConfig.value || {};
  const name = m.live_active || (m.active !== "[Default]" ? m.active : "");
  return name || "[Default]";
});

function stagedSave() {
  const json = effective(SAVE);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null; // corrupt staged value — treat as nothing staged
  }
}

export const savedProfiles = computed(() => {
  const staging = stagedSave();
  const names = new Set([...Object.keys(fileProfiles.value), ...daemonProfiles.value]);
  if (staging && staging.name) names.add(staging.name);
  const dropped = effective(DELETE);
  if (dropped) names.delete(dropped);
  return [...names].sort((a, b) => a.localeCompare(b));
});

// Whether a live switch can reach this profile. A profile saved in this session
// and not applied yet cannot be: the daemon only knows what it read at startup.
export const isLiveProfile = (name) => daemonProfiles.value.includes(name);

// The rows a load would install: the staged save's own rows when that is the
// profile in question, else what the config carries. Null when only the daemon
// knows the name (saved through its own route, before HQPTuner owned profiles) —
// there are no rows to stage, so such a load is live-only.
export function profileRows(name) {
  const staging = stagedSave();
  if (staging && staging.name === name) return staging.rows;
  return fileProfiles.value[name] || null;
}

// Rows arrive canonical from effectivePipelines, so they go out as they came.
export const stageProfileSave = (name, rows) => edit(SAVE, JSON.stringify({ name, rows }));
export const stageProfileDelete = (name) => edit(DELETE, name);
