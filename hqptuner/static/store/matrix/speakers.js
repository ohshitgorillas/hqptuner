import { computed } from "@preact/signals";
import { api } from "../../lib/api.js";
import { errText } from "../../lib/errtext.js";
import { UNCONFIRMED, formDraft } from "../core/forms.js";

/** @typedef {{ level?: string, distance?: string }} ChannelEdit */
/** @typedef {import("../faceplate/drawers/speakers.js").SpeakersForm} SpeakersForm */

const keys = ["enabled"];

/** @param {SpeakersForm} form @returns {Record<string, unknown>} */
function formValues(form) {
  const values = /** @type {Record<string, unknown>} */ ({ ...form });
  for (const channel of form.channels ?? []) {
    for (const kind of ["level", "distance"]) {
      const key = `${channel.index}.${kind}`;
      if (!keys.includes(key)) keys.push(key);
      values[key] = Number(channel[kind]);
    }
  }
  return values;
}

/** @param {Record<string, unknown>} values */
function channelEdits(values) {
  const channels = /** @type {Record<string, ChannelEdit>} */ ({});
  for (const [key, value] of Object.entries(values)) {
    const [index, kind] = key.split(".");
    if (kind !== "level" && kind !== "distance") continue;
    channels[index] ??= {};
    channels[index][kind] = String(value);
  }
  return channels;
}

export const speakerForm = formDraft({
  area: "apply",
  eager: false,
  keys,
  load: async () => formValues((await api.speakers()).data),
  write: async (values) => {
    const { report } = await api.applySpeakers({
      enabled: !!(values.enabled ?? speakerForm.base.value?.enabled),
      channels: channelEdits(values),
    });
    if (!report.applied) throw new Error(UNCONFIRMED);
  },
});

export const speakers = computed(() => /** @type {SpeakersForm | null} */ (speakerForm.base.value));
export const speakersBusy = speakerForm.busy;
/** Whether the form shown may differ from what the daemon holds: a write has landed and its readback has not, or the last read failed. */
export const speakersStale = speakerForm.stale;
export const speakersError = computed(() => (speakerForm.error.value === null ? "" : errText(speakerForm.error.value)));

/** Draft the speaker-processing switch. @param {boolean} on */
export function setSpeakersGate(on) {
  if (on === !!speakers.value?.enabled) speakerForm.remove("enabled");
  else speakerForm.set("enabled", on);
}

/** Refresh the daemon's form through its read lifecycle. */
export const loadSpeakers = () => speakerForm.reload();

/**
 * Apply the speaker switch and channel edits through the shared form lifecycle.
 * @param {boolean} enabled
 * @param {Record<string, ChannelEdit>} channels
 * @returns {Promise<boolean>}
 */
export function applySpeakers(enabled, channels) {
  setSpeakersGate(enabled);
  for (const [index, row] of Object.entries(channels)) {
    for (const [kind, value] of Object.entries(row)) speakerForm.set(`${index}.${kind}`, Number(value));
  }
  return speakerForm.apply();
}
