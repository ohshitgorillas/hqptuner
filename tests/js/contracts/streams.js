// The replay streams of the smoothness suites: how data arrives around a track start, reproduced from what the three
// captures measure, each with a heard clock known to the sample. No test() and no assert lives here, and no clock is read:
// every number below is written down.
//
// A stream is a schedule (tests/js/contracts/schedules.js) for `replay` plus `reads`: the stretches of wall time in which
// one track is heard, and for each the stamp the music heard at a wall time sits at. The suites compare the playhead the
// replay hands back to that stamp. The heard clock is generated first and the arrivals are derived from it, so it is
// never read from a Status sample, from a fit, or from the code under test. Status `position` is a field a stream sends,
// moving in the engine's step, and nothing here reads it back.
//
// THE HEARD-CLOCK RULE (an assumption, the same for every start of every stream). A stretch is a run of frames at one
// rate with no stretch of silence on the wire inside it. After its opening rush the stamps run at a steady lead over wall
// time (`mean` below); the line they then follow is the stretch's settled line, and a stamp is on the wire at the wall time
// that line reaches it. The music at a stamp is heard `output_delay` after that wall time, `output_delay` being the value
// the stream's own Status reports at that rate. So the music heard at wall time t sits at the stamp the settled line holds
// at t less that delay. A frame dropped on the wire moves every stamp after it by the music it lost, and a drift
// moves the settled line against wall time; both move the heard stamp with the line. Supporting readings, none a
// per-start offset: the settled lead holds within about 50 ms after the rush (block B of CAPTURE.md); the settled lead is
// 419 to 539 ms and `output_delay` is 500 to 506 ms, the same size, which reads as the engine's output delay of music
// metered in a burst at the start; Status `position` leaves 0 about 1.0 s after a rate change's serial change, which is the first frame
// (about 0.2 s after the serial change) plus `output_delay`, and about 0.2 s after a serial change that stops nothing;
// `position` advances at one second per wall second. The music before the settled line's first stamp is pre-roll nobody
// hears. Nothing outside the opening stretch depends on the pre-roll.
//
// THE JOIN ASSUMPTION. What a fresh reader receives was not captured (the late-connect runs were cut). A join here
// receives the arrivals of the stretch from the join on, counted from 0 as `MeterFeed.reset` makes them, after one
// `geometry` event, and the heard clock is the stretch's re-based to the join's stamp count.
//
// MEASURED VALUES. First capture: `.venv/bin/python -I scripts/probes/meter/arrival_patterns.py
// tests/support/fixtures/meter_start_capture.json`. Second capture: the same with
// `tests/support/fixtures/meter_start_capture_2.json`. Third capture: the same with
// `tests/support/fixtures/meter_start_capture_3.json`. Every figure below is a line of one of those three outputs; none is
// a value read off a fit.
//   Opening rush, "lead at +0,100,200,300,500 ms" and "mean lead +5..+9 s":
//     first capture 96000, serial 33: 11, 232, 357, 559, 518 ms, mean 514 ms, within 50 ms of it at +256 ms.
//     first capture 44100, serial 35: 23, 221, 434, 566, 536 ms, mean 539 ms, at +231 ms.
//     second capture 44100, serial 16: 23, 230, 367, 561, 524 ms, mean 514 ms, at +238 ms.
//     second capture 96000, serial 17: 11, 106, 137, 265, 455 ms, mean 419 ms, at +355 ms.
//     second capture 44100, serial 18: 23, 139, 352, 538, 507 ms, mean 514 ms, at +296 ms.
//     third capture 192000, a start from stopped (serial 20, "resume ... first frame"): 5, 238, 370, 569, 533 ms, mean
//     526 ms, at +243 ms. Third capture 44100, serial 21: 23, 233, 369, 585, 548 ms, mean 577 ms, at +274 ms. Third
//     capture 192000, serial 22: 5, 224, 344, 467, 503 ms, mean 498 ms, at +280 ms.
//   Frames stop and resume at a rate change ("frame gap over 250 ms: start ... ms long", "resume t=", "serial a->b at"):
//     first capture serial 33: the last frame 952 ms before the serial change, 1168 ms with no frames, resuming 217 ms
//     after it; State 0 from 1072 ms before it. Serial 35: 970 ms, 1159 ms, 189 ms; State 0 from 1075 ms before it.
//     second capture serial 16: no frames from 1258 ms before the serial change (a 300 ms gap, one frame, then 1145 ms,
//     joined here into one) until 189 ms after it; serial 17: 1144 ms before, 1360 ms, resuming 216 ms after;
//     serial 18: 1147 ms before, 1328 ms, resuming 181 ms after. State stays 2 in the second capture; its Status reads
//     that straddle each serial change take 935, 999 and 934 ms ("reads over 500 ms").
//     third capture serial 21: the last frame 961 ms before the serial change, 1145 ms with no frames, resuming 184 ms
//     after it; State 0 from 1057 ms before it, and the Status read that straddles it takes 856 ms. Serial 22: 1142 ms,
//     1350 ms, 209 ms; State 0 from 1035 ms before it, the straddling read 835 ms.
//   Same-rate changes: 44100 and 96000 in the first capture, 96000 in the second show no geometry event and no gap except
//     the first capture's serial 34: a frame gap of 296 ms starting 264 ms before the serial change, "+1000..+5000 ms:
//     median lead -107 ms against before". The stream drops 107 ms of music there. Serial 31 and the second capture's
//     serial 14 start from stopped with frames already arriving.
//   The third capture's gapless 192000 change (serial 23): no frame gap over 250 ms and no stamp break; "+1000..+5000 ms:
//     median lead -104 ms against before (spread 191 ms)", about the 106.7 ms of five events at 192000. The stream sends
//     it as a change that leaves the frames as they were: the stamps show no loss of music.
//   Steady play at 44100: "mean lead in first bin -1347 ms, in last bin -900 ms, change +446 ms" over bins 130 to 290 s
//     of the first capture (2.97 ms per second), "-2382 ms, -2042 ms, change +339 ms" over bins 190 to 350 s of the second
//     (2.12 ms per second). 96000 is flat in both ("change -1 ms"). The drift here starts at the last track and its start
//     is an assumption: the captures give the gain across a stretch, not where it begins.
//   `output_delay` per rate ("output_delay by Status samplerate"): first capture 502358 us at 44100, 501364 at 96000;
//     second capture 505827 at 44100, 500427 at 96000; third capture 500166 at 192000, 505827 at 44100. The one stale
//     sample at each rate change in the first capture is not sent. "moves of position": 106.7 and 213.3 ms, so `position`
//     moves in 106.67 ms steps.
//   Event grain (CAPTURE.md block D): 1024 samples per event at 44100, 2048 at 96000, and five events arrive together. The
//     third capture's `frame` events (read off the fixture's events, not a line of the script) carry n = 4096 at 192000
//     (21.3 ms, inside the measured 17.3 to 23.2 ms) and 1024 at 44100, and arrive five at a time in 186 of 188 groups at
//     192000.
//   Status cadence: the app's own `status_interval` of 1.0 s between reads, the reply time on top.
//
// The streams: the first capture's start sequence, the second's and the third's, each replayed as the reader that holds
// the connection receives it, with a page joining late at two points in each start's opening stretch; and the first capture's shape,
// where State is not playing across each rate change, once more as the app's reader receives it (it drops, then rejoins
// 0 to 2.0 s after Status shows playing) at three points of that window; the third capture's shape does the same, State
// being 0 across both of its rate changes. The second capture's shape has State staying playing, so the app's reader holds
// there and is the first reader. The third capture's shape is the only one at 192000: a start from stopped, a change to
// 44100, a change back and a gapless change, on the capture's own gaps, rushes and Status reads.
//
// THE MADE-UP STREAMS. What is heard in a made-up stream is the playback clock the stream is generated from: the settled
// line less `output_delay`, by the heard-clock rule above, the same for every start. A stretch with a `made` entry draws
// its frames and its bursts from a seeded stream: frame lengths come from the pools of the generated schedules (17.4 to
// 23.1 ms, all inside the 17.3 to 23.2 ms measured feed event range) and change in the middle of the stretch;
// a burst of 1 to 12 frames (up to the 262 ms the arrival measurement shows between
// bursts) lands where its last stamp is on the line, early or late by up to 40 ms against it. The opening rush of a
// made-up rate change and start is a backlog landing ahead of wall time and then holding its lead, drawn from the
// measured sizes: leads of 18, 170, 340, 545 and 500 ms at +0, 100, 200, 300 and 500 ms (the measured 11 to 23 ms at +0, and
// 538 to 566 ms at +300) and a settled lead of 490 ms (the measured 419 to 539 ms).
//   made_up_bursty: a start from stopped at 44100 whose first frames land after a rush, a gapless same-rate track change,
//     and a rate change to 96000 after a rush, each frame length changing mid-feed.
//   made_up_stamps_faster and made_up_stamps_slower: one 44100 stretch of two tracks, a start from stopped and a gapless
//     same-rate change, whose stamps gain on wall time at 2.5 ms per second in one and lose 2.5 ms per second in the other,
//     from the first track's start to the end of the second. 2.5 ms per second lies between the 2.97 and 2.12 ms per second
//     of the two captures ("mean lead in first bin ... change" lines of
//     `.venv/bin/python -I scripts/probes/meter/arrival_patterns.py tests/support/fixtures/meter_start_capture.json` and
//     the same with `meter_start_capture_2.json`; Steady play at 44100 above). The heard clock follows the line, so the
//     drift is the stamps against wall time, as in the captured streams.

import { lengths, paintsEvery, random } from "./schedules.js";

/** @typedef {import("./schedules.js").Schedule} Schedule */
/**
 * One heard stretch of one track: its wall window and the stamp the music heard at a wall time sits at, in playback ms at
 * the track's geometry rate, the axis the playhead is in.
 *
 * @typedef {object} Read
 * @property {string} kind  what starts the track
 * @property {number} serial
 * @property {number} rate  Hz
 * @property {number} from  wall, ms: the opening stretch is over
 * @property {number} to  wall, ms
 * @property {(t: number) => number} heard
 */
/**
 * @typedef {object} Stream
 * @property {string} name
 * @property {string} group  the capture's shape it reproduces: streams of one group are the same music
 * @property {string} point  where its reader joined: the reader that holds is one point, each join another
 * @property {Schedule} schedule
 * @property {Read[]} reads
 */

const MS = 1000;
//: The opening stretch, ms after a serial change (or after a join): a rush builds in at most 355 ms and frames resume at
//: most 217 ms after the serial change, 572 ms in all, and a join needs the same again to settle. Twice the figure.
const OPEN_MS = 1500;
//: A track's lag is read until this long before the next serial change: State goes to 0 up to 1075 ms before it, and
//: the frames of a second capture's rate change stop up to 1258 ms before it.
const CLOSE_MS = 1300;
const PAINT_MS = 50;
const READ_DELAY_MS = 1;
const STATUS_GAP_MS = 1000;
const STATUS_PHASE_MS = 500;
const POSITION_STEP_MS = 320 / 3;
const OFFSET_S = 0.69;
const EVENT_SAMPLES = /** @type {Record<number, number>} */ ({ 44100: 1024, 96000: 2048, 192000: 4096 });
const GROUP = 5;
const LEAD_AT_MS = [0, 100, 200, 300, 500];
const JOINS_MS = [400, 900];
const REJOINS_MS = [300, 1000, 1900];
const US = 1000;

/**
 * @typedef {object} Rush
 * @property {number[]} lead  stamps over wall time at LEAD_AT_MS after the resume, ms
 * @property {number} mean  the settled lead
 */
/**
 * A stretch whose frames and bursts are drawn from a seeded stream instead of the fixed grouping of the captures.
 *
 * @typedef {object} Made
 * @property {number} seed
 * @property {number[]} burst  the fewest and the most frames in a burst
 * @property {number} jitter  wall ms a burst may land early or late against where its last stamp is on the line
 */
/**
 * @typedef {object} Stretch
 * @property {number} rate
 * @property {number} from  wall ms of its first frame
 * @property {number} to  wall ms after which no frame arrives
 * @property {Rush | null} rush
 * @property {{ at: number, ms: number, lost: number } | null} drop  a gap in the frames that loses `lost` ms of music
 * @property {{ from: number, per: number } | null} drift  stamps gain `per` ms on each wall ms after `from`
 * @property {Made} [made]
 */
/**
 * @typedef {object} Track
 * @property {number} serial
 * @property {number} T  wall ms Status reports the serial
 * @property {string} kind
 * @property {number} rate
 * @property {number} stopped  ms before T that State is 0
 * @property {number} slow  ms the Status read after T less 1000 takes, 0 for none
 * @property {number} hear  wall ms its first sample is heard
 */

/** @type {(l: number[], mean: number) => Rush} */
const rush = (lead, mean) => ({ lead, mean });

/**
 * The stamps the wire has delivered `w` wall ms into stretch `s`, ms from its first stamp, raw of any loss.
 *
 * @param {Stretch} s
 * @param {number} w
 */
function rawLead(s, w) {
  const dt = w - s.from;
  const k = s.rush ? LEAD_AT_MS.filter((x) => x <= dt).length - 1 : -1;
  const rs = s.rush;
  let lead = 0;
  if (rs && k >= 0 && k < LEAD_AT_MS.length - 1) {
    lead = rs.lead[k] + ((rs.lead[k + 1] - rs.lead[k]) * (dt - LEAD_AT_MS[k])) / (LEAD_AT_MS[k + 1] - LEAD_AT_MS[k]);
  } else if (rs) {
    lead = rs.mean;
  }
  return dt + lead;
}

/**
 * The drift and the loss of stretch `s` at wall time `w`, ms.
 *
 * @param {Stretch} s
 * @param {number} w
 */
function bent(s, w) {
  const drift = s.drift && w > s.drift.from ? s.drift.per * (w - s.drift.from) : 0;
  const lost = s.drop && w >= s.drop.at + s.drop.ms ? s.drop.lost : 0;
  return drift - lost;
}

/**
 * The stamps on the wire by wall time `w`: the opening rush, then the settled line; nothing arrives in a dropped gap.
 *
 * @param {Stretch} s
 * @param {number} w
 */
function arrived(s, w) {
  if (s.drop && w >= s.drop.at && w < s.drop.at + s.drop.ms) return rawLead(s, s.drop.at) + bent(s, s.drop.at);
  return rawLead(s, w) + bent(s, w);
}

/**
 * The settled line of stretch `s` at wall time `w`, ms from its first stamp: where the stamps stand once the rush is over.
 *
 * @param {Stretch} s
 * @param {number} w
 */
const settled = (s, w) => w - s.from + (s.rush ? s.rush.mean : 0) + bent(s, w);

/**
 * The events of stretch `s`, in groups of GROUP that land together when the last of the group is on the wire, stamped in
 * samples from `at0` on; a made-up stretch lands them in bursts of its own.
 *
 * @param {Stretch} s
 * @param {number} at0
 */
function events(s, at0) {
  return s.made ? madeEvents(s, s.made, at0) : fixedEvents(s, at0);
}

/**
 * The events of a made-up stretch: frames whose lengths change mid-feed, in bursts drawn from `made`. A burst is due when
 * its last stamp is on the line (`arrived`) and lands up to `made.jitter` ms before or after that, never before a burst
 * ahead of it.
 *
 * @param {Stretch} s
 * @param {Made} made
 * @param {number} at0
 */
function madeEvents(s, { seed, burst: [lo, hi], jitter }, at0) {
  const rand = random(seed);
  const ns = lengths(rand, s.rate, arrived(s, s.to));
  /** @type {Array<{ t: number, n: number, at: number }>} */
  const feed = [];
  let [w, at, music, last] = [Math.ceil(s.from), at0, 0, Math.ceil(s.from)];
  for (let i = 0; i < ns.length;) {
    const group = ns.slice(i, i + lo + Math.floor(rand() * (hi - lo + 1)));
    i += group.length;
    music += (group.reduce((a, b) => a + b, 0) * MS) / s.rate;
    while (w < s.to && arrived(s, w) + 1e-6 < music) w++;
    if (arrived(s, w) + 1e-6 < music) break;
    last = Math.max(last, Math.round(Math.min(s.to, Math.max(s.from, w + (rand() * 2 - 1) * jitter))));
    for (const n of group) {
      feed.push({ t: last, n, at });
      at += n;
    }
  }
  return { feed, end: at };
}

/**
 * The events of a captured stretch: groups of GROUP, each landing when the last of it is on the wire.
 *
 * @param {Stretch} s
 * @param {number} at0
 */
function fixedEvents(s, at0) {
  const n = EVENT_SAMPLES[s.rate];
  const ms = (n * MS) / s.rate;
  /** @type {Array<{ t: number, n: number, at: number }>} */
  const feed = [];
  let sent = 0;
  for (let w = Math.ceil(s.from); w <= s.to; w++) {
    for (const have = arrived(s, w); (sent + GROUP) * ms <= have + 1e-6;) {
      for (let k = 0; k < GROUP; k++, sent++) feed.push({ t: w, n, at: at0 + sent * n });
    }
  }
  return { feed, end: at0 + sent * n };
}

/**
 * Everything a stream is made of, before it is cut into a schedule.
 *
 * @typedef {object} Spec
 * @property {string} name
 * @property {Record<number, number>} outputDelay  us per rate
 * @property {Stretch[]} stretches
 * @property {Track[]} tracks
 * @property {number} end  wall ms the stream ends
 * @property {boolean} appReads  the first capture's shape: the app's reader drops at each rate change and rejoins
 */

/**
 * The Status fields the engine reports for a read sent at `sent`.
 *
 * @param {Spec} spec
 * @param {number} sent
 * @returns {Record<string, string>}
 */
function fieldsAt(spec, sent) {
  const { tracks } = spec;
  const now = tracks.filter((x) => x.T <= sent).at(-1);
  const next = tracks.find((x) => x.T > sent);
  const stopped = !now || (next !== undefined && next.stopped > 0 && sent >= next.T - next.stopped);
  const track = now ?? tracks[0];
  const played = !stopped && sent >= track.hear ? sent - track.hear : 0;
  return {
    state: stopped ? "0" : "2",
    track_serial: String(now ? now.serial : track.serial - 1),
    position: ((Math.floor(played / POSITION_STEP_MS) * POSITION_STEP_MS) / MS).toFixed(17),
    output_delay: String(spec.outputDelay[track.rate]),
  };
}

/**
 * The Status reads of the stream, one after another: each is sent a cadence after the last arrived, and the one that
 * straddles a track marked `slow` takes that long to answer. The fields are those at the time it was sent.
 *
 * @param {Spec} spec
 * @returns {Array<{ sent: number, t: number, fields: Record<string, string> }>}
 */
function statusReads(spec) {
  /** @type {Array<{ sent: number, t: number, fields: Record<string, string> }>} */
  const out = [];
  const slow = spec.tracks.filter((x) => x.slow > 0);
  const done = new Set();
  for (let sent = STATUS_PHASE_MS; sent < spec.end;) {
    const mark = slow.find((x) => !done.has(x) && sent >= x.T - STATUS_GAP_MS);
    if (mark) done.add(mark);
    const t = sent + (mark ? mark.slow : READ_DELAY_MS);
    out.push({ sent, t, fields: fieldsAt(spec, sent) });
    sent = t + STATUS_GAP_MS;
  }
  return out;
}

/**
 * The stream whose reader holds its connection, and the pieces the joined streams are cut from.
 *
 * @typedef {ReturnType<typeof whole>} Whole
 * @param {Spec} spec
 */
function whole(spec) {
  let at0 = 0;
  /** @type {Array<{ t: number, n: number, at: number }>} */
  const feed = [];
  const parts = spec.stretches.map((s) => {
    const part = events(s, at0);
    const start = at0;
    at0 = part.end;
    feed.push(...part.feed);
    return { s, start, feed: part.feed };
  });
  return { spec, feed, parts, reads: statusReads(spec) };
}

/**
 * The stamp, playback ms at the stretch's rate, the music heard at wall time `t` sits at.
 *
 * @param {Spec} spec
 * @param {Whole["parts"][number]} part
 * @param {number} t
 */
function heardStamp(spec, part, t) {
  const delay = spec.outputDelay[part.s.rate] / US;
  return (part.start * MS) / part.s.rate + settled(part.s, t - delay);
}

/**
 * The part of the stream whose stretch began last at or before wall time `t`.
 *
 * @param {Whole["parts"]} parts
 * @param {number} t
 */
const partAt = (parts, t) => /** @type {Whole["parts"][number]} */ (parts.filter((p) => p.s.from <= t).at(-1));

/**
 * The reads of each track, from the end of its opening stretch to the start of the next serial change's run-up.
 *
 * @param {Whole} all
 * @param {{ rebase?: number, after?: number, only?: number }} [cut]  `rebase`: stamp ms the stream's own stamps are
 *   counted from, 0 for the reader that holds; `after`: wall ms before which no read starts; `only`: the one serial to read
 * @returns {Read[]}
 */
function reads({ spec, parts }, { rebase = 0, after = 0, only = -1 } = {}) {
  return spec.tracks
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => only < 0 || x.serial === only)
    .map(({ x, i }) => {
      const last = i === spec.tracks.length - 1;
      const part = partAt(parts, x.T + OPEN_MS);
      return {
        kind: x.kind,
        serial: x.serial,
        rate: x.rate,
        from: Math.max(x.T + OPEN_MS, after),
        to: last ? spec.end - CLOSE_MS : spec.tracks[i + 1].T - CLOSE_MS,
        heard: (/** @type {number} */ t) => heardStamp(spec, part, t) - rebase,
      };
    });
}

/**
 * The schedule of the stream between wall times `a` and `b`: the frames, geometry and Status that reach the page then.
 *
 * @param {Whole} all
 * @param {string} name
 * @param {{ a: number, b: number, geometry: Array<{ t: number, rate: number }>, feed: Whole["feed"] }} cut
 * @returns {Schedule}
 */
function schedule({ spec, reads: polled }, name, { a, b, geometry, feed }) {
  const status = polled.filter((r) => r.t >= a && r.t <= b).map((r) => ({ t: r.t, fields: r.fields }));
  if (!status.length || status[0].t > a) status.unshift({ t: a, fields: fieldsAt(spec, a) });
  return {
    name,
    rate: geometry[0].rate,
    delay: OFFSET_S,
    paints: paintsEvery(b, () => PAINT_MS).filter((t) => t >= a),
    feed,
    geometry,
    status,
  };
}

/**
 * The stream as a reader that joins at wall time `j` receives it: one `geometry` event, then the stretch's arrivals from
 * there on counted from 0, for the one track `track`, the page starting at wall time `from`.
 *
 * @param {Whole} all
 * @param {{ j: number, from: number, track: Track }} join
 * @param {string} name
 * @param {string} point
 * @returns {Stream}
 */
function joined(all, { j, from, track }, name, point) {
  const part = partAt(all.parts, j);
  const after = j + OPEN_MS;
  const [read] = reads(all, { after, only: track.serial });
  const kept = part.feed.filter((e) => e.t >= j && e.t <= read.to + PAINT_MS);
  const base = kept[0].at;
  const rebase = (base * MS) / part.s.rate;
  const sched = schedule(all, name, {
    a: from,
    b: read.to + PAINT_MS,
    geometry: [{ t: j, rate: part.s.rate }],
    feed: kept.map((e) => ({ t: e.t, n: e.n, at: e.at - base })),
  });
  return {
    name,
    group: all.spec.name,
    point,
    schedule: sched,
    reads: reads(all, { rebase, after, only: track.serial }),
  };
}

/**
 * Every stream of `spec`: the reader that holds, the page joining late in each track's opening stretch, and for the
 * first capture's shape the app's reader rejoining at each rate change.
 *
 * @param {Spec} spec
 * @returns {Stream[]}
 */
function streams(spec) {
  const all = whole(spec);
  const name = `${spec.name}_held_reader`;
  const geometry = spec.stretches.map((s) => ({ t: s.from, rate: s.rate }));
  const holds = {
    name,
    group: spec.name,
    point: "the reader that holds",
    schedule: schedule(all, name, { a: 0, b: spec.end, geometry, feed: all.feed }),
    reads: reads(all),
  };
  const late = spec.tracks.flatMap((track) =>
    JOINS_MS.map((d) => {
      const j = track.T + d;
      const point = `a page joining ${d} ms after the serial change`;
      return joined(all, { j, from: j, track }, `${name}_joined_${d}_ms_after_serial_${track.serial}`, point);
    }),
  );
  const rejoined = spec.appReads
    ? spec.tracks
        .filter((x) => x.stopped > 0)
        .flatMap((track) => {
          const shown = all.reads.find((r) => r.t >= track.T && r.fields.state === "2");
          const from = shown ? shown.t : track.T;
          return REJOINS_MS.map((d) =>
            joined(
              all,
              { j: from + d, from, track },
              `${spec.name}_apps_reader_rejoined_${d}_ms_after_status_shows_playing_serial_${track.serial}`,
              `the app's reader rejoining ${d} ms after Status shows playing`,
            ),
          );
        })
    : [];
  return [holds, ...late, ...rejoined];
}

/** @type {Spec} */
const FIRST = {
  name: "capture_1_shape",
  outputDelay: { 44100: 502358, 96000: 501364 },
  end: 99000,
  appReads: true,
  stretches: [
    { rate: 44100, from: 0, to: 27048, rush: null, drop: null, drift: null },
    {
      rate: 96000,
      from: 28217,
      to: 51030,
      rush: rush([11, 232, 357, 559, 518], 514),
      drop: { at: 39736, ms: 296, lost: 107 },
      drift: null,
    },
    {
      rate: 44100,
      from: 52189,
      to: 99000,
      rush: rush([23, 221, 434, 566, 536], 539),
      drop: null,
      drift: { from: 64000, per: 0.00297 },
    },
  ],
  tracks: [
    { serial: 31, T: 4000, kind: "start_from_stopped_at_44100", rate: 44100, stopped: 0, slow: 0, hear: 4100 },
    { serial: 32, T: 16000, kind: "same_rate_change_at_44100", rate: 44100, stopped: 0, slow: 0, hear: 16100 },
    {
      serial: 33,
      T: 28000,
      kind: "rate_change_44100_to_96000",
      rate: 96000,
      stopped: 1072,
      slow: 0,
      hear: 28217 + 501,
    },
    { serial: 34, T: 40000, kind: "same_rate_change_at_96000", rate: 96000, stopped: 0, slow: 0, hear: 40100 },
    {
      serial: 35,
      T: 52000,
      kind: "rate_change_96000_to_44100",
      rate: 44100,
      stopped: 1075,
      slow: 0,
      hear: 52189 + 502,
    },
    { serial: 36, T: 64000, kind: "steady_play_at_44100_with_drift", rate: 44100, stopped: 0, slow: 0, hear: 64100 },
  ],
};

/** @type {Spec} */
const SECOND = {
  name: "capture_2_shape",
  outputDelay: { 44100: 505827, 96000: 500427 },
  end: 99000,
  appReads: false,
  stretches: [
    { rate: 96000, from: 0, to: 26742, rush: null, drop: null, drift: null },
    { rate: 44100, from: 28189, to: 38856, rush: rush([23, 230, 367, 561, 524], 514), drop: null, drift: null },
    { rate: 96000, from: 40216, to: 50853, rush: rush([11, 106, 137, 265, 455], 419), drop: null, drift: null },
    {
      rate: 44100,
      from: 52181,
      to: 99000,
      rush: rush([23, 139, 352, 538, 507], 514),
      drop: null,
      drift: { from: 64000, per: 0.00212 },
    },
  ],
  tracks: [
    { serial: 14, T: 4000, kind: "start_from_stopped_at_96000", rate: 96000, stopped: 0, slow: 0, hear: 4100 },
    { serial: 15, T: 16000, kind: "same_rate_change_at_96000", rate: 96000, stopped: 0, slow: 0, hear: 16100 },
    { serial: 16, T: 28000, kind: "rate_change_96000_to_44100", rate: 44100, stopped: 0, slow: 935, hear: 28189 + 506 },
    { serial: 17, T: 40000, kind: "rate_change_44100_to_96000", rate: 96000, stopped: 0, slow: 999, hear: 40216 + 500 },
    { serial: 18, T: 52000, kind: "rate_change_96000_to_44100", rate: 44100, stopped: 0, slow: 934, hear: 52181 + 506 },
    { serial: 19, T: 64000, kind: "steady_play_at_44100_with_drift", rate: 44100, stopped: 0, slow: 0, hear: 64100 },
  ],
};

/** @type {Spec} */
const THIRD = {
  name: "capture_3_shape",
  outputDelay: { 44100: 505827, 192000: 500166 },
  end: 64000,
  appReads: true,
  stretches: [
    { rate: 192000, from: 4218, to: 27039, rush: rush([5, 238, 370, 569, 533], 526), drop: null, drift: null },
    { rate: 44100, from: 28184, to: 38858, rush: rush([23, 233, 369, 585, 548], 577), drop: null, drift: null },
    { rate: 192000, from: 40209, to: 64000, rush: rush([5, 224, 344, 467, 503], 498), drop: null, drift: null },
  ],
  tracks: [
    { serial: 20, T: 4000, kind: "start_from_stopped_at_192000", rate: 192000, stopped: 0, slow: 0, hear: 4218 + 500 },
    {
      serial: 21,
      T: 28000,
      kind: "rate_change_192000_to_44100",
      rate: 44100,
      stopped: 1057,
      slow: 856,
      hear: 28184 + 506,
    },
    {
      serial: 22,
      T: 40000,
      kind: "rate_change_44100_to_192000",
      rate: 192000,
      stopped: 1035,
      slow: 835,
      hear: 40209 + 500,
    },
    { serial: 23, T: 52000, kind: "same_rate_change_at_192000", rate: 192000, stopped: 0, slow: 0, hear: 52100 },
  ],
};

const BURSTS = [1, 12];
const JITTER_MS = 40;
const MADE_RUSH = rush([18, 170, 340, 545, 500], 490);
const MADE_OUTPUT_DELAY = { 44100: 503000, 96000: 501000 };
const DRIFT_PER_MS = 0.0025;
const DRIFT_FROM_MS = 4000;
const DRIFT_END_MS = 64000;

/** @type {Spec} */
const BURSTY = {
  name: "made_up_bursty",
  outputDelay: MADE_OUTPUT_DELAY,
  end: 44000,
  appReads: false,
  stretches: [
    {
      rate: 44100,
      from: 4217,
      to: 27048,
      rush: MADE_RUSH,
      drop: null,
      drift: null,
      made: { seed: 11, burst: BURSTS, jitter: JITTER_MS },
    },
    {
      rate: 96000,
      from: 28217,
      to: 44000,
      rush: MADE_RUSH,
      drop: null,
      drift: null,
      made: { seed: 12, burst: BURSTS, jitter: JITTER_MS },
    },
  ],
  tracks: [
    { serial: 1, T: 4000, kind: "start_from_stopped_at_44100", rate: 44100, stopped: 0, slow: 0, hear: 4217 + 503 },
    { serial: 2, T: 16000, kind: "same_rate_change_at_44100", rate: 44100, stopped: 0, slow: 0, hear: 16100 },
    { serial: 3, T: 28000, kind: "rate_change_44100_to_96000", rate: 96000, stopped: 0, slow: 0, hear: 28217 + 501 },
  ],
};

/**
 * A 44100 stretch of two tracks whose stamps drift against wall time by `per` ms on each wall ms.
 *
 * @param {string} name
 * @param {number} per
 * @param {number} seed
 * @returns {Spec}
 */
const drifting = (name, per, seed) => ({
  name,
  outputDelay: MADE_OUTPUT_DELAY,
  end: DRIFT_END_MS,
  appReads: false,
  stretches: [
    {
      rate: 44100,
      from: 0,
      to: DRIFT_END_MS,
      rush: null,
      drop: null,
      drift: { from: DRIFT_FROM_MS, per },
      made: { seed, burst: BURSTS, jitter: JITTER_MS },
    },
  ],
  tracks: [
    { serial: 1, T: DRIFT_FROM_MS, kind: "start_from_stopped_at_44100", rate: 44100, stopped: 0, slow: 0, hear: 4100 },
    { serial: 2, T: 34000, kind: "same_rate_change_at_44100", rate: 44100, stopped: 0, slow: 0, hear: 34100 },
  ],
});

/** Every replay stream the smoothness suites run, the captures' first and the made-up ones after. @type {Stream[]} */
export const STREAMS = [
  ...streams(FIRST),
  ...streams(SECOND),
  ...streams(THIRD),
  ...streams(BURSTY),
  ...streams(drifting("made_up_stamps_faster", DRIFT_PER_MS, 21)),
  ...streams(drifting("made_up_stamps_slower", -DRIFT_PER_MS, 22)),
];
