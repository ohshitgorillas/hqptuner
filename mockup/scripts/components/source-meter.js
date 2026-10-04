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

import { h } from "../lib/dom.js";
import { PLATFORM } from "../lib/clock.js";
import { stepFrame } from "../model/meter.js";
import { floorCtl, pageRangeColumn, spectrogramControls, spectrumRange } from "./source-meter/controls.js";
import { levelsPainter, levelsView } from "./source-meter/levels.js";
import { mockFeed, mockHistory } from "./source-meter/mock.js";
import { ROWS, spectrogramPainter, spectrogramView } from "./source-meter/spectrogram.js";
import { spectrumPainter, spectrumView } from "./source-meter/spectrum.js";

/**
 * @param {HTMLElement} host  empty block container inside a drawer panel
 * @param {object} cfg        METER from data/source.js
 * @param {import('../lib/clock.js').Clock} [clock]  frame stamps and scheduling
 */
export function mountSourceMeter(host, cfg, clock = PLATFORM) {
  const compact = !!cfg.compact;
  const st = { floor: cfg.floor, range: cfg.range, channel: cfg.channel, window: cfg.window };
  if (compact) {
    st.range = cfg.pageRange;
    st.floor = -cfg.pageRange;
  }
  const views = buildViews(cfg, st, compact, {
    specRange: (v) => {
      st.range = Number(v);
      spectrum.axes();
      spectrum.paint();
      gram.paint();
    },
    floor: (v) => {
      st.floor = Number(v);
      levels.scale();
    },
    pageRange: (v) => {
      st.range = Number(v);
      st.floor = -st.range;
      spectrum.axes();
      spectrum.paint();
      levels.scale();
    },
    gramRange: (v) => {
      st.range = Number(v);
      gram.paint();
    },
    channel: (v) => {
      st.channel = v;
      spectrum.reset();
      gram.paint();
    },
    window: (v) => {
      st.window = v === "all" ? "all" : Number(v);
      gram.paint();
    },
  });
  // The drawer holds the spectrogram alone: spectrum and levels live on the page's Source section.
  const root = compact ? views.top : views.bottom.el;
  host.append(root);

  const feed = mockFeed(cfg, ROWS);
  const src = mockHistory(cfg, feed);
  const gram = spectrogramPainter(views.bottom, st, cfg, src);
  const spectrum = spectrumPainter(views.spectrum, st, cfg.nyquist, feed, src.latest);
  const levels = levelsPainter(views.levels, st, src.latest);

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

/** Every block's DOM, the controls wired to `act`: the page's top row and the drawer's spectrogram. */
function buildViews(cfg, st, compact, act) {
  const spectrum = spectrumView(!compact && spectrumRange(cfg.ranges, st.range, act.specRange));
  const levels = levelsView(cfg.channels, !compact && floorCtl(cfg.floors, st.floor, act.floor));
  const rangeCol = compact && pageRangeColumn(cfg.pageRanges, st.range, act.pageRange);
  const top = h("div.mblk.mtop", {}, rangeCol, spectrum.el, levels.el);
  const bottom = spectrogramView(spectrogramControls(cfg, st, act));
  return { spectrum, levels, top, bottom };
}

/** Whether the meter is on screen: the page section laid out, or the drawer open on the Meter panel. */
function shownTest(host, compact) {
  return () => {
    if (compact) return document.visibilityState === "visible" && !!host.offsetParent;
    const dr = host.closest(".drawer"),
      p = host.closest(".dpanel");
    return document.visibilityState === "visible" && dr && !dr.hasAttribute("data-closed") && p && !p.hidden;
  };
}

/**
 * The frame loop: each frame owes `columns` its spectrogram columns while shown and steps `levels` while shown, until
 * `root` leaves `host` (remounted: the mock scenario changed the source), when the instance stops.
 */
function runLoop(host, root, clock, o) {
  let loop = { prev: clock.now(), acc: 0 };
  (function tick(now) {
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
  })(loop.prev);
}
