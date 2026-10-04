// Source meter. Drawer (Source drawer, Meter tab): the apodizing strip over the spectrogram on one time axis, filling the
// drawer (spectrum and levels live on the page's Source section, cfg.compact).
// Mounted as a drawer block. Everything here is a view, not a setting: its controls
// never mark the tab dirty.
//
// Mock feed: a deterministic music-like source (chords with harmonics, kick, hats, CD brick-wall above
// ~20 kHz, 16-bit noise floor) so the layout reads at rest and in motion. The real app drives this from the
// 4322 metering stream (store/meter/feed.js): per channel peakMax/peak/rms/rmsMax + 1025-bin transform.
// History clears at track start; "All" spans track start to now.
//
// Units: every control, axis and readout names its unit. Frequency axes are linear, 0 to source Nyquist.
//
// cfg.compact: the page's Source section (main.js; only while the Matrix section is gone and the display has the room,
// lib/plate.js SIZES meter): spectrum + levels only, stretched to the section's height; no spectrogram. Its own view
// state, like a second window on the same stream: one Range column left of the spectrum, stacked, setting both the
// spectrum's span and the levels' floor (cfg.pageRanges; floor = −range). The heads carry titles only.
//
// The parts live under source-meter/: the mock source, the spectrum, the spectrogram, the level bars, the controls and
// the axis labels they share.

import { h } from "../../lib/shell/dom.js";
import { PLATFORM } from "../../../../hqptuner/static/lib/clock.js";
import { stepFrame } from "../../../../hqptuner/static/model/gauges/meter.js";
import { floorCtl, pageRangeColumn, spectrogramControls, spectrumRange } from "./source-meter/controls.js";
import { levelsPainter, levelsView } from "./source-meter/levels.js";
import { mockFeed, mockHistory } from "./source-meter/mock.js";
import { ROWS, spectrogramPainter, spectrogramView } from "./source-meter/spectrogram.js";
import { spectrumPainter, spectrumView } from "./source-meter/spectrum.js";

/**
 * METER from data/source.js, with the scene's rates and the mount's options spread over it.
 *
 * @typedef {object} MeterConfig
 * @property {number} channels
 * @property {number} nyquist          source Nyquist, Hz
 * @property {number} [brick]          where the content ends, Hz
 * @property {boolean} [dsdNoise]      DSD modulator noise above the content
 * @property {number[]} floors         level floor options, dBFS
 * @property {number} floor            dBFS
 * @property {number[]} ranges         spectrum and spectrogram span options, dB
 * @property {number} range            dB
 * @property {number[]} pageRanges     the page's Range options, dB
 * @property {number} pageRange        dB
 * @property {string} channel          '0' | '1' | 'sum'
 * @property {{ v: number | 'all', label: string }[]} windows  spectrogram time windows, s
 * @property {number | 'all'} window   s
 * @property {number} colsPerSec
 * @property {number} trackElapsedSec
 * @property {boolean} [compact]       the page's Source section rather than the drawer
 */

/**
 * One mount's view state, shared by every painter and read at each paint.
 *
 * @typedef {object} MeterState
 * @property {number} floor           dBFS
 * @property {number} range           dB
 * @property {string} channel         '0' | '1' | 'sum'
 * @property {number | 'all'} window  s
 */

/**
 * The handlers each view control applies its pick with.
 *
 * @typedef {object} MeterActions
 * @property {(v: string) => void} specRange
 * @property {(v: string) => void} floor
 * @property {(v: string) => void} pageRange
 * @property {(v: string) => void} gramRange
 * @property {(v: string) => void} channel
 * @property {(v: string) => void} window
 */

/**
 * @typedef {object} MeterPainters
 * @property {ReturnType<typeof spectrogramPainter>} gram
 * @property {ReturnType<typeof spectrumPainter>} spectrum
 * @property {ReturnType<typeof levelsPainter>} levels
 */

/**
 * Mount the source meter into `host`: the drawer's spectrogram, or with `cfg.compact` the page's spectrum and levels.
 *
 * @param {HTMLElement} host  empty block container inside a drawer panel
 * @param {MeterConfig} cfg   METER from data/source.js
 * @param {import('../../../../hqptuner/static/lib/clock.js').Clock} [clock]  frame stamps and scheduling
 */
export function mountSourceMeter(host, cfg, clock = PLATFORM) {
  const compact = !!cfg.compact;
  /** @type {MeterState} */
  const st = { floor: cfg.floor, range: cfg.range, channel: cfg.channel, window: cfg.window };
  if (compact) {
    st.range = cfg.pageRange;
    st.floor = -cfg.pageRange;
  }
  const act = meterActions(st, () => painters);
  const views = buildViews(cfg, st, compact, act);
  // The drawer holds the spectrogram alone: spectrum and levels live on the page's Source section.
  const root = compact ? views.top : views.bottom.el;
  host.append(root);

  const feed = mockFeed(cfg, ROWS);
  const src = mockHistory(cfg, feed);
  const gram = spectrogramPainter(views.bottom, st, cfg, src);
  const spectrum = spectrumPainter(views.spectrum, st, cfg.nyquist, { source: feed, latest: src.latest });
  const levels = levelsPainter(views.levels, st, src.latest);
  /** @type {MeterPainters} */
  const painters = { gram, spectrum, levels };

  function paintAll() {
    gram.ramp();
    spectrum.axes();
    if (!compact) gram.axis();
    levels.scale();
    spectrum.frame(0, true);
    if (!compact) gram.paint();
  }
  paintAll();
  for (let k = 0; k < 40; k++) levels.step(k * 50, 0.05); // settle ballistics so the resting frame is a reading
  // Stylesheets can land after the module runs; repaint once the ramp tokens are certainly live. Registered only while
  // the page is still loading, dropped once it fires, and removed when this instance stops.
  if (document.readyState !== "complete") window.addEventListener("load", paintAll, { once: true });
  const stop = () => window.removeEventListener("load", paintAll);

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  runLoop(host, root, clock, {
    perCol: feed.perCol,
    shown: shownTest(host, compact),
    stop,
    columns: (n, now) => {
      for (let k = 0; k < n; k++) src.push();
      spectrum.frame(now);
      if (!compact) gram.paint();
    },
    levels: levels.step,
  });
}

/**
 * The view controls' handlers: each writes its pick into `st` and repaints what reads it.
 *
 * @param {MeterState} st
 * @param {() => MeterPainters} parts  the painters, built after the controls that call these
 * @returns {MeterActions}
 */
function meterActions(st, parts) {
  return {
    specRange: (v) => {
      st.range = Number(v);
      parts().spectrum.axes();
      parts().spectrum.paint();
      parts().gram.paint();
    },
    floor: (v) => {
      st.floor = Number(v);
      parts().levels.scale();
    },
    pageRange: (v) => {
      st.range = Number(v);
      st.floor = -st.range;
      parts().spectrum.axes();
      parts().spectrum.paint();
      parts().levels.scale();
    },
    gramRange: (v) => {
      st.range = Number(v);
      parts().gram.paint();
    },
    channel: (v) => {
      st.channel = v;
      parts().spectrum.reset();
      parts().gram.paint();
    },
    window: (v) => {
      st.window = v === "all" ? "all" : Number(v);
      parts().gram.paint();
    },
  };
}

/**
 * Every block's DOM, the controls wired to `act`: the page's top row and the drawer's spectrogram.
 *
 * @param {MeterConfig} cfg
 * @param {MeterState} st
 * @param {boolean} compact
 * @param {MeterActions} act
 */
function buildViews(cfg, st, compact, act) {
  const spectrum = spectrumView(!compact && spectrumRange(cfg.ranges, st.range, act.specRange));
  const levels = levelsView(cfg.channels, !compact && floorCtl(cfg.floors, st.floor, act.floor));
  const rangeCol = compact && pageRangeColumn(cfg.pageRanges, st.range, act.pageRange);
  const top = h("div.mblk.mtop", {}, rangeCol, spectrum.el, levels.el);
  const bottom = spectrogramView(spectrogramControls(cfg, st, act));
  return { spectrum, levels, top, bottom };
}

/**
 * Whether the meter is on screen: the page section laid out, or the drawer open on the Meter panel.
 *
 * @param {HTMLElement} host
 * @param {boolean} compact
 */
function shownTest(host, compact) {
  return () => {
    if (compact) return document.visibilityState === "visible" && !!host.offsetParent;
    const dr = host.closest(".drawer"),
      p = /** @type {HTMLElement | null} */ (host.closest(".dpanel"));
    return document.visibilityState === "visible" && dr && !dr.hasAttribute("data-closed") && p && !p.hidden;
  };
}

/**
 * What the frame loop drives.
 *
 * @typedef {object} LoopHooks
 * @property {number} perCol                                 spectrogram column period, s
 * @property {() => unknown} shown                           the meter is on screen (truthy)
 * @property {() => void} stop                               the instance stopped
 * @property {(n: number, now: number) => void} columns      `n` new spectrogram columns at `now`, ms
 * @property {(now: number, dt: number) => void} levels      one level frame at `now`, ms, `dt` s after the last
 */

/**
 * The frame loop: each frame owes `columns` its spectrogram columns while shown and steps `levels` while shown, until
 * `root` leaves `host` (remounted: the mock scenario changed the source), when the instance stops.
 *
 * @param {HTMLElement} host
 * @param {Node} root
 * @param {import('../../../../hqptuner/static/lib/clock.js').Clock} clock
 * @param {LoopHooks} o
 */
function runLoop(host, root, clock, o) {
  /** @type {import('../../../../hqptuner/static/model/gauges/meter.js').FrameLoop} */
  let loop = { prev: clock.now(), acc: 0 };
  /** @param {number} now  rAF stamp, ms */
  function tick(now) {
    if (!host.contains(root)) {
      o.stop();
      return;
    }
    const vis = !!o.shown();
    const step = stepFrame(loop, now, o.perCol, vis);
    loop = step;
    if (step.cols) o.columns(step.cols, now);
    if (vis) o.levels(now, step.dt);
    clock.requestAnimationFrame(tick);
  }
  tick(loop.prev);
}
