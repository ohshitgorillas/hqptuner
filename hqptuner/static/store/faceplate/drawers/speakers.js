// The Speakers drawer's store half: its own form over the daemon's /speakers form (store/matrix/speakers.js). The
// switch and each channel's level and distance are held here as edits over what the daemon holds, never in the config
// staging buffer: the write is the form's own POST, which reloads the engine, so the drawer's own apply group runs it.
// The speaker set is a view choice, which channels the drawer lists, and never stages: the daemon keeps all eight.
// Level trims do nothing while Direct SDM runs; distances still apply. The DOM half is
// components/faceplate/drawers/Speakers.js.

import { computed, signal } from "@preact/signals";
import { truthy } from "../../../lib/coerce.js";
import { runningValue } from "../../resolve.js";
import { enumPref } from "../../ui/prefs.js";
import { applySpeakers, speakers } from "../../matrix/speakers.js";

/**
 * @typedef {import("../../matrix/speakers.js").ChannelEdit} ChannelEdit
 * @typedef {{ id: string, label: string, channels: number[] }} SpeakerSet  a set and the channel indices it lists
 * @typedef {{ min?: number, max?: number, step?: number }} BoxLimits  a number box's bounds, where the form gave them
 */

/**
 * One channel of the staged form: the daemon's slot with the drawer's edits over it.
 *
 * @typedef {object} DraftChannel
 * @property {number} index  the daemon's slot (readme §1.9 order)
 * @property {string} name   the daemon's label, LFE shown as Sub
 * @property {number} level  dBFS
 * @property {number} distance  cm
 * @property {BoxLimits} levelBox
 * @property {BoxLimits} distanceBox
 */

/**
 * The staged form and whether it differs from the daemon's.
 *
 * @typedef {object} SpeakerDraft
 * @property {boolean} loaded  the daemon's form has been read
 * @property {boolean} enabled  the switch, edited or the daemon's
 * @property {string} set  the set on view
 * @property {number[]} shown  the channel indices the set lists
 * @property {DraftChannel[]} channels  every channel the form carries
 * @property {boolean} differs  an edit would change what the daemon holds
 */

/**
 * The /speakers form as store/matrix/speakers.js holds it.
 *
 * @typedef {{ enabled?: boolean, channels?: FormChannel[] }} SpeakersForm
 * @typedef {{ index: number, label: string, level: unknown, distance: unknown, [limit: string]: unknown }} FormChannel
 */

/** The speaker sets, in menu order (v1 components/speakers/Card.js, owner copy). @type {SpeakerSet[]} */
export const SETS = [
  { id: "2.0", label: "2.0 — stereo", channels: [0, 1] },
  { id: "2.1", label: "2.1 — stereo + sub", channels: [0, 1, 3] },
  { id: "3.0", label: "3.0 — stereo + center", channels: [0, 1, 2] },
  { id: "3.1", label: "3.1 — stereo + center + sub", channels: [0, 1, 2, 3] },
  { id: "5.1", label: "5.1 — surround", channels: [0, 1, 2, 3, 4, 5] },
  { id: "7.1", label: "7.1 — surround + sides", channels: [0, 1, 2, 3, 4, 5, 6, 7] },
];

// The set is a browser preference under v1's own key, so the set picked on either shell is the one both open on.
const [speakerSet, setSpeakerSet] = enumPref(
  "hqptuner.speakerSet",
  SETS.map((s) => s.id),
  SETS[0].id,
);

/** Each channel's pending edits, by index as a string: exactly the overlay the POST takes. */
const edits = signal(/** @type {Record<string, ChannelEdit>} */ ({}));
/** The switch as edited; null follows the daemon's. */
const gateEdit = signal(/** @type {boolean | null} */ (null));

/** @param {unknown} v */
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** @param {unknown} v  a form limit, absent where the input carried none */
const limit = (v) => (v === undefined || v === null || v === "" ? undefined : num(v));

/**
 * @param {FormChannel} c
 * @param {"level" | "distance"} kind
 * @returns {BoxLimits}
 */
const box = (c, kind) => ({
  min: limit(c[`${kind}_min`]),
  max: limit(c[`${kind}_max`]),
  step: limit(c[`${kind}_step`]),
});

// The daemon calls slot 3 LFE; the drawer, like v1, shows the box on the floor as a sub. Display name only.
/** @param {string} label */
const displayName = (label) => (label === "LFE" ? "Sub" : label);

/** The daemon's form, or none before its first read. */
const form = () => /** @type {SpeakersForm | null} */ (speakers.value);

/**
 * The daemon's channel at an index.
 *
 * @param {number} index
 */
const daemonChannel = (index) => (form()?.channels ?? []).find((c) => c.index === index);

/**
 * Draft one field of one channel. A box emptied or holding no number, or one back at the daemon's value, is no edit:
 * the field falls back to what the daemon holds.
 *
 * @param {number} index
 * @param {"level" | "distance"} kind
 * @param {string | number} value
 */
function draftField(index, kind, value) {
  const key = String(index);
  const row = { ...(edits.value[key] ?? {}) };
  const text = String(value).trim();
  const held = daemonChannel(index);
  const blank = text === "" || !Number.isFinite(Number(text));
  if (blank || (held && Number(text) === num(held[kind]))) delete row[kind];
  else row[kind] = text;
  const next = { ...edits.value, [key]: row };
  if (Object.keys(row).length === 0) delete next[key];
  edits.value = next;
}

/**
 * Draft a channel's level trim.
 *
 * @param {number} index
 * @param {string | number} value  dBFS
 */
export const setChannelLevel = (index, value) => draftField(index, "level", value);

/**
 * Draft a channel's distance.
 *
 * @param {number} index
 * @param {string | number} value  cm
 */
export const setChannelDistance = (index, value) => draftField(index, "distance", value);

/**
 * Draft the speaker-processing switch. Back at the daemon's, it is no edit.
 *
 * @param {boolean} on
 */
export function setSpeakersGate(on) {
  gateEdit.value = on === !!form()?.enabled ? null : on;
}

/**
 * Pick the set the drawer lists. A set outside the list is turned away; a pick never stages.
 *
 * @param {string} id
 */
export const pickSpeakerSet = (id) => setSpeakerSet(id);

/** Drop every edit: the switch and each channel's level and distance fall back to the daemon's. The set stays. */
export function discardDraft() {
  edits.value = {};
  gateEdit.value = null;
}

/**
 * Whether the drafted switch differs from the daemon's.
 *
 * @param {SpeakersForm | null} f
 */
const gateDiffers = (f) => gateEdit.value !== null && gateEdit.value !== !!f?.enabled;

/**
 * Whether one channel's edits differ from what the daemon holds now, which a later read can have moved onto them.
 *
 * @param {number} index
 * @param {ChannelEdit} row
 */
function rowDiffers(index, row) {
  const held = daemonChannel(index);
  const kinds = /** @type {("level" | "distance")[]} */ (["level", "distance"]);
  return kinds.some((kind) => row[kind] !== undefined && (!held || num(row[kind]) !== num(held[kind])));
}

/**
 * The staged form: the daemon's channels with the edits over them, the switch, the set on view, and whether any edit
 * would change what the daemon holds.
 *
 * @returns {SpeakerDraft}
 */
export function speakerDraft() {
  const f = form();
  const set = SETS.find((s) => s.id === speakerSet.value) ?? SETS[0];
  const channels = (f?.channels ?? []).map((c) => {
    const e = edits.value[String(c.index)] ?? {};
    return {
      index: c.index,
      name: displayName(c.label),
      level: num(e.level ?? c.level),
      distance: num(e.distance ?? c.distance),
      levelBox: box(c, "level"),
      distanceBox: box(c, "distance"),
    };
  });
  return {
    loaded: f !== null,
    enabled: gateEdit.value ?? !!f?.enabled,
    set: set.id,
    shown: set.channels,
    channels,
    differs: gateDiffers(f) || Object.entries(edits.value).some(([k, row]) => rowDiffers(Number(k), row)),
  };
}

/** Whether the drawer holds an edit to apply. */
export const staged = computed(() => speakerDraft().differs);

/** Whether the level trims are dead: Direct SDM is running, bypassing the volume control the trims ride on. */
export const levelsDead = () => truthy(runningValue("direct_sdm"));

/**
 * Send the draft through the form's own POST, which reloads the engine. A draft the daemon confirms is dropped, the
 * form then reading the daemon's new values; an unconfirmed one is kept. Nothing staged sends nothing.
 *
 * @returns {Promise<boolean>} whether the daemon confirmed the new values
 */
export async function applyDraft() {
  if (!staged.value) return false;
  const done = await applySpeakers(speakerDraft().enabled, edits.value);
  if (done) discardDraft();
  return done;
}
