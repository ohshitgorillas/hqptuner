// The rig the meter store suites (tests/js/store/meter/) share: the boot every case that drives the feed or the loop
// starts from, the Ready connection the apodizing suites start on, the bursts and the committed capture the painters'
// suites play, and the stereo scene a stopped loop hands its painters. No test() and no assert lives here: every
// assertion stays at its call site in the suite that owns it. Not a *.test.js file on purpose: the runner glob would
// execute it.

import { readFileSync } from "node:fs";

import { samplesToMs, secondsToMs } from "../../../../hqptuner/static/lib/timebase.js";
import { closeMeterFeed, initMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { initMeterLoop } from "../../../../hqptuner/static/store/meter/loop.js";
import { setSpectrumOffset } from "../../../../hqptuner/static/store/meter/delay.js";
import { playhead } from "../../../../hqptuner/static/store/meter/playhead.js";
import { initSpectrogram } from "../../../../hqptuner/static/store/meter/spectrogram.js";
import { apodBins, initApodHistory } from "../../../../hqptuner/static/store/apodhistory.js";
import { engineStatus, health } from "../../../../hqptuner/static/store/signals.js";
import { setApodWindow } from "../../../../hqptuner/static/store/ui/prefs.js";
import { lastStream, useEventSource } from "../eventsource.js";
import { useStorage } from "../storage.js";
import { newTrack, poll, setPollStep } from "../apodpolls.js";
import { RATE_44K, RATE_48K, geometry } from "../meterfeed.js";

/** @typedef {import("../../../../hqptuner/static/lib/clock.js").Clock} Clock */

/**
 * A feed to send: wall ms after the case starts, and the frames that land together then.
 *
 * @typedef {{ wall: number, frames: Array<{ at: number, n: number }> }} Landing
 */

/**
 * Every store the feed and the loop suites drive, back to a fresh playing track with the feed open on `clock`, the loop
 * too where `loop` is set, at the spectrum offset `delayS` where one is given.
 *
 * @param {Clock} clock
 * @param {{ delayS?: number, loop?: boolean }} [options]
 */
export function bootMeter(clock, { delayS, loop = false } = {}) {
  engineStatus.value = { metering: false };
  useEventSource();
  useStorage();
  setApodWindow("30");
  if (delayS !== undefined) setSpectrumOffset(String(delayS));
  initApodHistory();
  initSpectrogram();
  newTrack();
  poll();
  initMeterFeed(clock);
  if (loop) initMeterLoop(clock);
}

/** The lifecycle generation of the Ready connection the apodizing cases start on. */
const GEN = 3;

/** A playback position no apodizing table reaches: playback, ms. */
export const ELSEWHERE_MS = 1000;

/** The newest apodizing bin's stamp as the history holds it: playback, ms; null where the bin carries none. */
export const newestAt = () => apodBins.value.at(-1)?.at;

/**
 * Open a fresh feed on `clock` and send it the 48 kHz geometry.
 *
 * @param {Clock} clock
 */
export function openFeed48k(clock) {
  closeMeterFeed();
  useEventSource();
  openMeterFeed(clock);
  lastStream()?.emit("geometry", geometry(RATE_48K));
}

/**
 * A new playing track on a Ready connection, with no playhead, the poll seam stepping one bin a poll, and a fresh 48 kHz
 * feed open on `clock`.
 *
 * @param {Clock} clock
 */
export function readyTrack48k(clock) {
  health.value = { phase: "Ready", generation: GEN };
  useStorage();
  playhead.value = null;
  setPollStep(1);
  newTrack();
  openFeed48k(clock);
}

/** Event lengths, samples at 44.1 kHz, in turn: 22.7, 17.3, 19.3 and 23.1 ms, two of each. */
export const LENGTHS = [1000, 1000, 765, 765, 850, 850, 1020, 1020];

/** Burst sizes in turn, and how far each burst lands off the schedule its music sets, wall ms, early and late. */
const OFF_SCHEDULE_MS = [0, -20, 25, -10, 30, -25, 15, -5, 20, -30];

/** Bursts per generated feed. */
const BURSTS = 30;

/**
 * The landings of `BURSTS` bursts of `sizes` frames in turn at 44.1 kHz, LENGTHS in turn; a burst lands where the music
 * before it would have ended on the wall, off by OFF_SCHEDULE_MS in turn and `lead` earlier, never before the burst
 * before it.
 *
 * @param {number[]} sizes
 * @param {number} [lead]  wall ms each burst after the first lands before its music plays at the delay
 * @returns {Landing[]}
 */
export function generatedLandings(sizes, lead = 0) {
  /** @type {Landing[]} */
  const landings = [];
  let at = 0;
  let sent = 0;
  let wall = 0;
  for (let k = 0; k < BURSTS; k++) {
    const frames = Array.from({ length: sizes[k % sizes.length] }, () => ({ at, n: LENGTHS[sent++ % LENGTHS.length] }));
    wall = Math.max(wall, k ? samplesToMs(at, RATE_44K) + OFF_SCHEDULE_MS[k % OFF_SCHEDULE_MS.length] - lead : 0);
    landings.push({ wall, frames });
    for (const f of frames) {
      f.at = at;
      at += f.n;
    }
  }
  return landings;
}

/** The committed capture of the dev container's feed, read, never written. */
const CAPTURE_FILE = new URL("../../../support/fixtures/meter_feed_capture.json", import.meta.url);

/** The capture's paint wait, wall ms: 60 Hz. */
const CAPTURE_PAINT_MS = secondsToMs(1) / 60;

/**
 * The delays a feed runs at, as the stores take them: the spectrum offset the user types, s, and the engine's output
 * delay as Status reports it, whole microseconds, where the engine reports one.
 *
 * @typedef {{ offsetS: number, outputDelayUs?: string }} Delays
 */

/**
 * Give the stores `delays` the way they arrive: the offset typed, the engine's output delay in a status poll.
 *
 * @param {Delays} delays
 */
export function setDelays({ offsetS, outputDelayUs }) {
  setSpectrumOffset(String(offsetS));
  if (outputDelayUs !== undefined) poll({ output_delay: outputDelayUs });
}

/**
 * The first `limit` frames of the committed capture as a feed: each frame lands at its own recorded time, at the
 * capture's geometry, painted at 60 Hz, at the delays the capture was taken under.
 *
 * @param {number} [limit]
 * @returns {{ rate: number, channels: number, bins: number, landings: Landing[], delays: Delays, gaps: number[] }}
 */
export function capturedFeed(limit = Infinity) {
  const raw = JSON.parse(readFileSync(CAPTURE_FILE, "utf8"));
  const named = (/** @type {string} */ name) =>
    raw.events.filter((/** @type {{ event: string }} */ ev) => ev.event === name);
  const geo = JSON.parse(named("geometry")[0].data);
  const landings = named("frame")
    .slice(0, limit)
    .map((/** @type {{ t_ms: number, data: string }} */ ev) => {
      const { at, n } = JSON.parse(ev.data);
      return { wall: ev.t_ms, frames: [{ at, n }] };
    });
  const delays = { offsetS: raw.owner_spectrum_offset_s, outputDelayUs: raw.engine_output_delay };
  return { rate: geo.rate, channels: geo.channels, bins: geo.bins, landings, delays, gaps: [CAPTURE_PAINT_MS] };
}

/**
 * Where each frame of `landings` starts and ends and how long it lasts at `rate`, playback ms, read through the time
 * base from the whole samples the suite sends.
 *
 * @param {Landing[]} landings
 * @param {number} rate
 * @returns {{ starts: number[], ends: number[], lengths: number[] }}
 */
export function frameTimes(landings, rate) {
  const frames = landings.flatMap((l) => l.frames);
  return {
    starts: frames.map((f) => samplesToMs(f.at, rate)),
    ends: frames.map((f) => samplesToMs(f.at + f.n, rate)),
    lengths: frames.map((f) => samplesToMs(f.n, rate)),
  };
}

/** Channels the cases that clear the scene run at, so the claim reaches past the first. */
export const STEREO = 2;

/** Bins in each channel of the geometry those cases run at. */
export const BINS = 4;

/** One channel of a scene with nothing heard: every level, and every one of its bins, at -Infinity dBFS. */
export const SILENT = { peak: -Infinity, rms: -Infinity, bins: Array.from({ length: BINS }, () => -Infinity) };
