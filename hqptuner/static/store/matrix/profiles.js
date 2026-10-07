// Saved matrix profiles (protocol.md "Saved matrix profiles do not persist"). Nothing here
// reaches into the store core's private signals — it
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
import { matrixConfig } from "../signals.js";
import { effective } from "../resolve.js";
import { edit } from "../actions.js";

const SAVE = "matrix_profile_save";
const DELETE = "matrix_profile_delete";

const fileProfiles = computed(() => (matrixConfig.value && matrixConfig.value.file_profiles) || {});

// Names the daemon itself knows, from the live 4321 lane, falling back to the
// /matrix form's datalist when credentials keep the live list empty.
const daemonProfiles = computed(() => {
  const m = matrixConfig.value || {};
  if (m.live_profiles && m.live_profiles.length) return m.live_profiles;
  return ((m.profiles && m.profiles.options) || []).map((/** @type {SchemaOption} */ o) => o.value).filter(Boolean);
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
    return JSON.parse(/** @type {string} */ (json));
  } catch {
    return null; // corrupt staged value — treat as nothing staged
  }
}

// The staged delete's profile name. The staged value is always JSON
// {name, presets}, presets empty when no stored presets are targeted.
function stagedDeleteName() {
  const value = effective(DELETE);
  if (!value) return null;
  try {
    const parsed = JSON.parse(/** @type {string} */ (value));
    return parsed && typeof parsed === "object" ? parsed.name : null;
  } catch {
    return null; // corrupt staged value — treat as nothing staged
  }
}

export const savedProfiles = computed(() => {
  const staging = stagedSave();
  const names = new Set([...Object.keys(fileProfiles.value), ...daemonProfiles.value]);
  if (staging && staging.name) names.add(staging.name);
  const dropped = stagedDeleteName();
  if (dropped) names.delete(dropped);
  return [...names].sort((a, b) => a.localeCompare(b));
});

// Whether a live switch can reach this profile. A profile saved in this session
// and not applied yet cannot be: the daemon only knows what it read at startup.
/** Whether a live MatrixSetProfile switch can reach this profile name. */
export const isLiveProfile = (/** @type {string} */ name) => daemonProfiles.value.includes(name);

// A profile the config carries: {rows, post}. Null for a name only the daemon
// knows (saved through its own route, before HQPTuner owned profiles).
const fileProfile = (/** @type {string} */ name) => fileProfiles.value[name] || null;

// The rows a load would install: the staged save's own rows when that is the
// profile in question, else what the config carries. Null when only the daemon
// knows the name — there are no rows to stage, so such a load is live-only.
/**
 * The pipeline rows a load of this profile would stage, or null when only the
 * daemon knows the name.
 *
 * @param {string} name
 * @returns {import("../resolve.js").PipelineRow[] | null}
 */
export function profileRows(name) {
  const staging = stagedSave();
  if (staging && staging.name === name) return staging.rows;
  const profile = fileProfile(name);
  return profile ? profile.rows : null;
}

// The post-process chain a load would install, keyed by wire field name. `{}` for
// a profile carrying no chain (saved before profiles stored one), and for a name
// with a save staged this session — that save captures the chain that is already
// live, so a load of it has nothing to install. Null for a name only the daemon
// knows, matching profileRows.
/**
 * The post-process chain a load of this profile would stage, keyed by wire field
 * name, or null when only the daemon knows the name.
 *
 * @param {string} name
 * @returns {Record<string, string> | null}
 */
export function profilePost(name) {
  const staging = stagedSave();
  if (staging && staging.name === name) return {};
  const profile = fileProfile(name);
  return profile ? profile.post || {} : null;
}

// Rows arrive canonical from effectivePipelines, so they go out as they came.
// `presets` names the stored presets the verb also fans out to at apply; a
// save with no targets goes on the wire as {name, rows}.
/** Stage a profile save carrying the given rows, and the stored presets it fans out to. */
export const stageProfileSave = (
  /** @type {string} */ name,
  /** @type {import("../resolve.js").PipelineRow[]} */ rows,
  /** @type {string[]} */ presets = [],
) => edit(SAVE, JSON.stringify(presets.length ? { name, rows, presets } : { name, rows }));
// A delete is always {name, presets} on the wire, `presets` empty when
// nothing was targeted.
/** Stage a profile delete, and the stored presets it fans out to. */
export const stageProfileDelete = (/** @type {string} */ name, /** @type {string[]} */ presets = []) =>
  edit(DELETE, JSON.stringify({ name, presets }));

// Each stored preset's saved profile names (/api/matrix preset_profiles) — the
// fan-out pickers' read model. {} until the poll delivers one.
export const presetProfiles = computed(() => (matrixConfig.value && matrixConfig.value.preset_profiles) || {});
