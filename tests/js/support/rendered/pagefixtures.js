// What the list and page suites share: the open list's markup and opener, the lists' reset and settle, the meter stream
// over the EventSource fake, the preset table read off the easy presets, and the running engine written onto the
// wire-side signals for the conversion suites.
//
// Not a *.test.js file on purpose: the runner glob would execute it.

import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { OptionList } from "../../../../hqptuner/static/components/faceplate/lists/OptionList.js";
import {
  config,
  engineState,
  engineStatus,
  enums,
  liveOverride,
  metadata,
  staged,
} from "../../../../hqptuner/static/store/signals.js";
import { openList } from "../../../../hqptuner/static/store/faceplate/view.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/plate.js";
import { plainNames } from "../../../../hqptuner/static/store/ui/prefs.js";
import { flushNarrowing } from "../../../../hqptuner/static/store/narrow/persist.js";
import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { elements } from "../markup.js";
import { fakeClock } from "../clock.js";
import { lastStream, useEventSource } from "../eventsource.js";
import { seedReadings } from "../readings.js";
import { favoritesWire } from "../wire/favoriteswire.js";
import { loadLists, resetLists } from "../listsfixture.js";

/** @typedef {import("../markup.js").MarkupElement} MarkupElement */

/**
 * Every element the open list draws, in document order.
 *
 * @returns {MarkupElement[]}
 */
export const listMarkup = () => elements(render(html`<${OptionList} />`)).sort((a, b) => a.start - b.start);

/**
 * Open a key's list over the body with `value` running in its field, at `stage`; a pick calls `pick`.
 *
 * @param {string} key
 * @param {string} [value]
 * @param {(v: string) => unknown} [pick]
 * @param {"1x" | "nx"} [stage]
 */
export function openKey(key, value = "", pick = () => undefined, stage = key.endsWith("_nx") ? "nx" : "1x") {
  openList.value = { key, stage, value, pick };
}

/** Start a list case: the favorites wire answering, every list signal reset, the lists loaded. */
export async function freshLists() {
  favoritesWire();
  resetLists();
  await loadLists();
}

/** End a list case: wait out the narrowing write a case may have queued. */
export async function settleLists() {
  await flushNarrowing();
}

/**
 * Open a fresh feed over one /api/status object at play, and send a geometry event for `channels` channels.
 *
 * @param {number} [channels]
 */
export function stream(channels = 2) {
  closeMeterFeed();
  useEventSource();
  engineStatus.value = { status: { state: "2" }, metering: true, metadata: { samplerate: "44100" } };
  openMeterFeed(fakeClock().clock);
  lastStream()?.emit("geometry", { nyquist: 22050, channels, centers: [1000, 2000] });
}

/**
 * The preset table read off `presets`: each preset's version knob (the one whose every position names another
 * preset), the subsets that have one, the flagships their positions name, the top-level presets, every nested pair,
 * and the position a preset's knobs rest at.
 *
 * @template {{ id: string, knobs: { id: string, default: string, options: string[] }[] }} P
 * @param {P[]} presets
 */
export function presetTable(presets) {
  const ids = new Set(presets.map((p) => p.id));
  /** @param {P} preset */
  const versionKnob = (preset) => preset.knobs.find((k) => k.options.every((o) => ids.has(o) && o !== preset.id));
  const subsets = presets.filter((p) => versionKnob(p) !== undefined);
  const flagships = [...new Set(subsets.flatMap((p) => /** @type {{ options: string[] }} */ (versionKnob(p)).options))];
  return {
    subsets,
    flagships,
    top: presets.filter((p) => versionKnob(p) === undefined),
    nested: flagships.flatMap((under) =>
      subsets.map((sub) => ({ under, sub, vk: String(/** @type {{ id: string }} */ (versionKnob(sub)).id) })),
    ),
    /** @param {P} p */
    resting: (p) => Object.fromEntries(p.knobs.map((k) => [k.id, k.default])),
  };
}

/**
 * Write one running engine onto the wire-side signals: the state, the enumerations, one status frame, the direct SDM
 * form field unset, nothing staged, the overlays and the plate's design size.
 *
 * @param {{ state: Record<string, string>, lists: object, status: object, overlays: object }} engine
 */
export async function writeEngine({ state, lists, status, overlays }) {
  engineState.value = state;
  enums.value = lists;
  engineStatus.value = status;
  config.value = { fields: [{ name: "direct_sdm" }] };
  await seedReadings({ direct_sdm: false });
  staged.value = { live: {}, http: {} };
  liveOverride.value = {};
  metadata.value = overlays;
  plainNames.value = false;
  viewport.value = { w: 1080, h: 810 };
}
