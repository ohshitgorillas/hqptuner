// Per-track apodizing-event history — the data behind the Engine Health card's
// density strip. The daemon reports `apod` as a cumulative counter, so the
// strip's shape comes from per-poll increases: one bin per Status poll while
// PLAYING, cleared when the track changes.
//
// A bin carries the poll cadence in force when it was appended rather than a
// timestamp. Two reasons: the daemon's `position`/`length` fields have no
// documented unit, and a wall clock in the store would be the only one in the
// module graph. Cadence per bin is enough — a window of W seconds is the newest
// run of bins whose recorded cadences sum to no more than W — and it degrades
// honestly, since a page that polls slower simply records coarser bins.
//
// Visibility is stateful, not a threshold on the current reading: the strip
// appears on the first event of a track and stays up for as long as playback
// continues, so a burst in an opening section does not vanish from the card the
// moment the burst ends. It comes back down only when playback stops, or when a
// track plays through to its end without a single event.
import { signal, computed, effect } from "@preact/signals";
import { engineStatus } from "./signals.js";
import { fastPollMs } from "./ui.js";
import { apodWindow } from "./prefs.js";

const PLAYING = 2;

// An hour of bins at the 1 s cadence, two at 2 s. Past this the oldest go: the
// strip is a monitor, not a record, and an unbounded array on a track that never
// ends (a radio stream carries one serial indefinitely) is a leak.
const MAX_BINS = 3600;

/**
 * @typedef {{ ms: number, n: number }} Bin
 *   One poll's worth of history: `ms` the poll cadence recorded at append,
 *   `n` the apodizing events counted in that interval.
 *
 * @typedef {object} TrackState
 * @property {string | undefined | null} serial
 *   The track this history belongs to, as the daemon reported it.
 * @property {number | null} apodPrev
 *   Last observed cumulative counter, or null before the baseline poll.
 * @property {boolean} sawEvent
 *   Whether this track has produced any event at all.
 * @property {number | null} remain
 *   Last observed remaining seconds, for the play-to-the-end test.
 */

const bins = signal(/** @type {Bin[]} */ ([]));
const track = signal(/** @type {TrackState} */ ({ serial: null, apodPrev: null, sawEvent: false, remain: null }));
const visible = signal(false);

/** This track's bins, oldest first. */
export const apodBins = computed(() => bins.value);

/** Whether the density strip shows at all. */
export const apodStripVisible = computed(() => visible.value);

const num = (/** @type {string | number | undefined | null} */ v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * @typedef {object} StatusFrame
 * @property {string} [state]
 * @property {string} [track_serial]
 * @property {string} [apod]
 * @property {string} [remain_min]
 * @property {string} [remain_sec]
 */

// Remaining seconds off the two fields that state their own unit. Null when
// neither is readable, which the end-of-track test treats as "not known to have
// finished" rather than as zero.
/**
 * @param {StatusFrame} st
 * @returns {number | null}
 */
function remainSeconds(st) {
  const m = num(st.remain_min);
  const s = num(st.remain_sec);
  if (m === null && s === null) return null;
  return (m || 0) * 60 + (s || 0);
}

// A track that ran to its end with nothing to show retires the strip. A track
// left early does not: the user skipping past a quiet intro says nothing about
// whether the rest of it would have been quiet.
/**
 * @param {TrackState} t
 * @returns {boolean}
 */
const playedOutClean = (t) => t.serial != null && !t.sawEvent && t.remain === 0;

/** @type {(() => void) | null} */
let dispose = null;

/**
 * Register the bin-accumulation effect once, and hand back its disposer.
 *
 * Idempotent for the same reason `initHealth` is: the effects would share this
 * module's signals, so a second registration would append two bins per poll and
 * halve the strip's time base.
 *
 * @returns {() => void}
 */
export function initApodHistory() {
  if (dispose) return dispose;
  const registered = effect(() => {
    const st = (engineStatus.value || {}).status;
    if (!st) return;
    rollTrack(st);
    if (Number(st.state) !== PLAYING) {
      if (visible.peek()) visible.value = false;
      return;
    }
    accumulate(st);
  });
  dispose = registered;
  return registered;
}

// Start a new track's history, settling the outgoing track's visibility first.
// Everything else about the strip survives the change — a run of playback keeps
// one continuous strip, per the visibility rule above.
/**
 * @param {StatusFrame} st
 * @returns {void}
 */
function rollTrack(st) {
  const t = track.peek();
  if (st.track_serial === t.serial) return;
  if (playedOutClean(t)) visible.value = false;
  track.value = { serial: st.track_serial, apodPrev: null, sawEvent: false, remain: null };
  bins.value = [];
}

// One poll's step. The first poll of a track only takes the baseline: the
// counter's absolute value carries the whole session's events, so a bin built
// against no previous reading would put every event since the daemon started
// into this track's first interval.
/**
 * @param {StatusFrame} st
 * @returns {void}
 */
function accumulate(st) {
  const apod = num(st.apod) || 0;
  const remain = remainSeconds(st);
  const t = track.peek();
  if (t.apodPrev === null) {
    track.value = { ...t, apodPrev: apod, remain };
    return;
  }
  const n = Math.max(0, apod - t.apodPrev);
  const next = bins.peek().concat([{ ms: fastPollMs.peek(), n }]);
  bins.value = next.length > MAX_BINS ? next.slice(next.length - MAX_BINS) : next;
  track.value = { ...t, apodPrev: apod, sawEvent: t.sawEvent || n > 0, remain };
  if (n > 0 && !visible.peek()) visible.value = true;
}

// The slice the strip draws: the newest bins that fit the chosen window, walked
// back from the right edge (now) until the next bin would overflow it. A window
// shorter than a single bin's cadence therefore shows nothing, which is the
// truthful answer — that window holds no complete observation.
export const apodVisibleBins = computed(() => {
  const all = apodBins.value;
  const w = apodWindow.value;
  if (w === "all") return all;
  const budget = (num(w) || 0) * 1000;
  let used = 0;
  let i = all.length;
  while (i > 0 && used + all[i - 1].ms <= budget) {
    used += all[i - 1].ms;
    i--;
  }
  return all.slice(i);
});
