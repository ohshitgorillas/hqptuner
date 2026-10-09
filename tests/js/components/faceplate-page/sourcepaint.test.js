// Painter suite for hqptuner/static/components/faceplate/page/sourcepaint.js: what one paint writes into the page's
// Source section. Given a meter scene and the page's Range, the spectrum's trace, its held peaks and its filled area,
// each level bar's peak, RMS and hold, and the readings table's held peak and RMS.
//
// The section is the one SourceMeter renders (through preact-render-to-string) over a live stereo stream at 13″, so the
// readings table is drawn. The painter needs a live element to write into, and node has none: the rendered markup is
// scanned with tests/js/support/markup.js and stood up as a small element tree carrying the surface a painter writes
// through (`querySelector`, `querySelectorAll`, attributes, `style`, `textContent`). The scene is built by hand, so no
// clock and no loop run here.
//
// The plot's viewBox is 600 by 170: a path's points are read back as numbers, x across from 0 Hz, y down from full
// scale. Bar fills are read back as the percentage in their inline style, readings as numbers with their minus sign.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/sourcepaint.test.js

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { SourceMeter } from "../../../../hqptuner/static/components/faceplate/page/SourceMeter.js";
import { paintSourcePage } from "../../../../hqptuner/static/components/faceplate/page/sourcepaint.js";
import { engineStatus } from "../../../../hqptuner/static/store/signals.js";
import { closeMeterFeed, openMeterFeed } from "../../../../hqptuner/static/store/meter/feed.js";
import { setPageRange } from "../../../../hqptuner/static/store/ui/faceplate.js";
import { setSpectrumStyle } from "../../../../hqptuner/static/store/ui/prefs.js";
import { viewport } from "../../../../hqptuner/static/store/faceplate/view.js";
import { lastStream, useEventSource } from "../../support/eventsource.js";
import { useStorage } from "../../support/storage.js";
import { attr, elements, text } from "../../support/markup.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../../../hqptuner/static/model/gauges/meter.js").LevelReading} LevelReading */
/** @typedef {import("../../../../hqptuner/static/model/gauges/meter.js").SpectrumHold} SpectrumHold */

const COLS = 600; // the trace's columns, store/meter/loop.js TRACE_COLS
const PLOT_H = 170;

// --- the element tree ----------------------------------------------------------------------------------------------

/**
 * One element of the section: its tag, classes, attributes, inline style and text, and its children. Built from the
 * rendered markup and written by the painter.
 */
class Elem {
  /**
   * @param {string} tag
   * @param {Map<string, string>} attrs
   * @param {string} content
   */
  constructor(tag, attrs, content) {
    this.tagName = tag.toUpperCase();
    /** @type {Map<string, string>} */
    this.attrs = attrs;
    /** @type {Elem[]} */
    this.children = [];
    this.content = content;
    /** @type {Elem | null} */
    this.parent = null;
    /** @type {Record<string, string> & { setProperty: (k: string, v: string) => void, getPropertyValue: (k: string) => string }} */
    this.style = styleOf(attrs.get("style") || "");
  }

  get classList() {
    const own = (this.attrs.get("class") || "").split(/\s+/).filter(Boolean);
    return { contains: (/** @type {string} */ c) => own.includes(c) };
  }

  get textContent() {
    return this.content;
  }

  set textContent(v) {
    this.content = String(v);
    this.children = [];
  }

  /** @param {string} k */
  getAttribute(k) {
    return this.attrs.has(k) ? this.attrs.get(k) : null;
  }

  /**
   * @param {string} k
   * @param {unknown} v
   */
  setAttribute(k, v) {
    this.attrs.set(k, String(v));
  }

  /** @param {string} k */
  removeAttribute(k) {
    this.attrs.delete(k);
  }

  /** @returns {Elem[]} every descendant, document order */
  descendants() {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }

  /** @param {string} sel */
  querySelectorAll(sel) {
    const alts = sel.split(",").map((s) => s.trim().split(/\s+/));
    return this.descendants().filter((n) => alts.some((chain) => n.matchesChain(chain, this)));
  }

  /** @param {string} sel */
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }

  /**
   * Whether this element matches the last compound of `chain`, with each earlier compound matched by an ancestor
   * inside `scope`.
   *
   * @param {string[]} chain
   * @param {Elem} scope
   */
  matchesChain(chain, scope) {
    if (!this.matches(chain[chain.length - 1])) return false;
    let rest = chain.slice(0, -1);
    for (let up = this.parent; up && up !== scope && rest.length; up = up.parent) {
      if (up.matches(rest[rest.length - 1])) rest = rest.slice(0, -1);
    }
    return rest.length === 0;
  }

  /**
   * Whether this element matches one compound selector: a tag, classes, or both.
   *
   * @param {string} compound
   */
  matches(compound) {
    const [tag, ...cls] = compound.split(".");
    if (tag && tag.toUpperCase() !== this.tagName) return false;
    return cls.every((c) => this.classList.contains(c));
  }
}

/**
 * An inline style as a writable declaration block.
 *
 * @param {string} decl
 */
function styleOf(decl) {
  /** @type {Record<string, string>} */
  const props = {};
  for (const part of decl.split(";")) {
    const at = part.indexOf(":");
    if (at > 0) props[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return Object.assign(props, {
    setProperty: (/** @type {string} */ k, /** @type {string} */ v) => void (props[k] = v),
    getPropertyValue: (/** @type {string} */ k) => props[k] || "",
  });
}

/**
 * Every attribute an element carries, with its value.
 *
 * @param {MarkupElement} el
 * @returns {Map<string, string>}
 */
function attrsOf(el) {
  const names = [...el.attrs.matchAll(/([^\s=]+)(?:="[^"]*")?/g)].map((m) => m[1]);
  return new Map(names.map((n) => [n, attr(el, n) ?? ""]));
}

/**
 * The rendered markup stood up as a tree under a mount point, which is what the painter is handed.
 *
 * @param {string} markup
 * @returns {Elem}
 */
function mount(markup) {
  const root = new Elem("div", new Map(), "");
  const all = elements(markup).sort((a, b) => a.start - b.start || b.html.length - a.html.length);
  /** @type {{ el: MarkupElement, node: Elem }[]} */
  const open = [];
  for (const el of all) {
    while (open.length && open[open.length - 1].el.start + open[open.length - 1].el.html.length <= el.start) open.pop();
    const node = new Elem(el.name, attrsOf(el), text(el));
    const parent = open.length ? open[open.length - 1].node : root;
    node.parent = parent;
    parent.children.push(node);
    open.push({ el, node });
  }
  return root;
}

// --- the section and the scene -------------------------------------------------------------------------------------

/** The section SourceMeter renders now, mounted. */
const section = () => mount(render(html`<${SourceMeter} />`));

/**
 * A spectrum hold with every column at `floor` but the ones `at` names.
 *
 * @param {number} floor  dBFS
 * @param {Record<number, number>} at  column to dBFS
 * @returns {Float32Array}
 */
function columns(floor, at = {}) {
  const out = new Float32Array(COLS).fill(floor);
  for (const [c, db] of Object.entries(at)) out[Number(c)] = db;
  return out;
}

/**
 * A scene: the given levels, and a spectrum showing `disp` and holding `peak`.
 *
 * @param {{ levels?: Partial<LevelReading>[], disp?: Float32Array, peak?: Float32Array }} [o]
 */
function scene({ levels = [{}, {}], disp = columns(-200), peak = disp } = {}) {
  /** @type {SpectrumHold} */
  const spectrum = { disp, peak, peakAt: new Float32Array(COLS) };
  const full = levels.map((lv) => ({ peak: -200, rms: -200, hold: -200, holdAt: 0, ...lv }));
  return { levels: full, spectrum, raw: null };
}

/**
 * Paint `sc` at `range` into a freshly rendered section, and hand the section back.
 *
 * @param {ReturnType<typeof scene>} sc
 * @param {number} range  dB
 */
function painted(sc, range) {
  const root = section();
  paintSourcePage(/** @type {Element} */ (/** @type {unknown} */ (root)), sc, range);
  return root;
}

// --- reading it back -----------------------------------------------------------------------------------------------

/** @param {number} v */
const r2 = (v) => Math.round(v * 100) / 100;

/**
 * A path's points, read as number pairs in the order the path draws them; empty where the path has no `d`.
 *
 * @param {Elem} root
 * @param {string} cls
 * @returns {[number, number][]}
 */
function pointsOf(root, cls) {
  const d = root.querySelector(`path.${cls}`)?.getAttribute("d") || "";
  const nums = (d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) || []).map(Number);
  return Array.from({ length: Math.floor(nums.length / 2) }, (_, i) => [r2(nums[2 * i]), r2(nums[2 * i + 1])]);
}

/**
 * The y of a path's point at column `c`, or NaN where it has none.
 *
 * @param {Elem} root
 * @param {string} cls
 * @param {number} c
 */
function yAt(root, cls, c) {
  const x = c + 0.5;
  const pt = pointsOf(root, cls).find(([px]) => px === x);
  return pt ? pt[1] : NaN;
}

/**
 * Each bar's `prop` percentage on its `cls` mark, bar by bar; NaN where the mark or the percentage is missing.
 *
 * @param {Elem} root
 * @param {string} cls
 * @param {string} prop
 */
function bars(root, cls, prop) {
  return root.querySelectorAll(".lvb").map((b) => {
    const mark = b.querySelector(`.${cls}`);
    return mark ? r2(parseFloat(mark.style[prop] ?? "")) : NaN;
  });
}

/**
 * Each readings cell of class `cls`, read as a number with its minus sign.
 *
 * @param {Elem} root
 * @param {string} cls
 */
const readings = (root, cls) =>
  root.querySelectorAll(`.${cls}`).map((c) => parseFloat(c.textContent.replace("−", "-")));

/** Open a fresh live stereo feed over one /api/status object. */
function stream() {
  closeMeterFeed();
  useEventSource();
  engineStatus.value = { status: { state: "2" }, metering: true, metadata: { samplerate: "44100" } };
  openMeterFeed(() => 0);
  lastStream()?.emit("geometry", { nyquist: 22050, channels: 2, bins: 1025 });
}

beforeEach(() => {
  useStorage();
  setPageRange("90");
  setSpectrumStyle("trace");
  viewport.value = { w: 1366, h: 1024 };
  stream();
});

// --- the trace -----------------------------------------------------------------------------------------------------

test("test_the_trace_draws_one_point_per_column_at_each_columns_centre", () => {
  const pts = pointsOf(painted(scene(), 90), "strace");
  assert.deepEqual([pts.length, pts[0]?.[0], pts.at(-1)?.[0]], [COLS, 0.5, 599.5]);
});

test("test_a_column_sits_down_the_plot_by_a_90_db_range", () => {
  const root = painted(scene({ disp: columns(-72, { 300: -18 }) }), 90);
  assert.equal(yAt(root, "strace", 300), 34);
});

test("test_a_column_sits_down_the_plot_by_a_60_db_range", () => {
  const root = painted(scene({ disp: columns(-72, { 300: -18 }) }), 60);
  assert.equal(yAt(root, "strace", 300), 51);
});

test("test_a_column_under_the_floor_rests_on_the_baseline", () => {
  const root = painted(scene({ disp: columns(-18, { 300: -150 }) }), 90);
  assert.equal(yAt(root, "strace", 300), PLOT_H);
});

test("test_a_column_over_full_scale_stops_at_the_top", () => {
  const root = painted(scene({ disp: columns(-18, { 300: 6 }) }), 90);
  assert.equal(yAt(root, "strace", 300), 0);
});

test("test_the_held_peaks_trace_the_peak_not_the_shown_level", () => {
  const root = painted(scene({ disp: columns(-72), peak: columns(-72, { 300: -9 }) }), 90);
  assert.equal(yAt(root, "shold", 300), 17);
});

test("test_the_area_is_the_trace_closed_down_to_the_baseline", () => {
  const root = painted(scene({ disp: columns(-45, { 300: -18 }) }), 90);
  const trace = pointsOf(root, "strace");
  const area = pointsOf(root, "sarea");
  const closing = [...new Set(area.slice(trace.length).map(([, y]) => y))];
  assert.deepEqual({ head: area.slice(0, trace.length), closing }, { head: trace, closing: [PLOT_H] });
});

// --- the bars ------------------------------------------------------------------------------------------------------

test("test_each_bars_peak_fills_it_from_a_120_db_floor", () => {
  const root = painted(scene({ levels: [{ peak: -30 }, { peak: -60 }] }), 120);
  assert.deepEqual(bars(root, "pk", "height"), [75, 50]);
});

test("test_a_peak_over_full_scale_fills_its_bar", () => {
  const root = painted(scene({ levels: [{ peak: 3 }, { peak: -45 }] }), 90);
  assert.deepEqual(bars(root, "pk", "height"), [100, 50]);
});

test("test_each_bars_rms_fills_it_from_a_60_db_floor", () => {
  const root = painted(
    scene({
      levels: [
        { peak: -3, rms: -45 },
        { peak: -3, rms: -15 },
      ],
    }),
    60,
  );
  assert.deepEqual(bars(root, "rm", "height"), [25, 75]);
});

test("test_each_bars_hold_mark_sits_up_from_the_floor", () => {
  const root = painted(
    scene({
      levels: [
        { peak: -40, hold: -6 },
        { peak: -40, hold: -30 },
      ],
    }),
    60,
  );
  assert.deepEqual(bars(root, "hd", "bottom"), [90, 50]);
});

test("test_a_bar_with_a_reading_shows_its_hold_mark_and_one_without_hides_it", () => {
  const root = painted({ ...scene({ levels: [{ hold: -6 }] }) }, 60);
  const shown = root.querySelectorAll(".lvb").map((b) => b.querySelector(".hd")?.style.visibility);
  assert.deepEqual(shown, ["", "hidden"]);
});

// --- the readings --------------------------------------------------------------------------------------------------

test("test_the_peak_readings_are_the_held_peaks_to_one_place", () => {
  const root = painted(
    scene({
      levels: [
        { peak: -20, hold: -14.46 },
        { peak: -20, hold: -3.04 },
      ],
    }),
    90,
  );
  assert.deepEqual(readings(root, "npk"), [-14.5, -3]);
});

test("test_the_rms_readings_are_the_rms_to_one_place", () => {
  const root = painted(scene({ levels: [{ rms: -20.06 }, { rms: -9.94 }] }), 90);
  assert.deepEqual(readings(root, "nrm"), [-20.1, -9.9]);
});

// --- the styles ----------------------------------------------------------------------------------------------------

/**
 * Paint `sc` at `range` under spectrum style `style` into a freshly rendered section, and hand the section back.
 *
 * @param {ReturnType<typeof scene>} sc
 * @param {number} range  dB
 * @param {string} style
 */
function styled(sc, range, style) {
  const root = section();
  paintSourcePage(/** @type {Element} */ (/** @type {unknown} */ (root)), sc, range, style);
  return root;
}

/** A scene with something to draw in every path: the trace at -45 dBFS, a held peak at -9 dBFS on column 300. */
const busy = () => scene({ disp: columns(-45), peak: columns(-45, { 300: -9 }) });

for (const style of ["bars", "soft", "ridges", "aurora"]) {
  for (const cls of ["strace", "sarea"]) {
    test(`test_a_${style}_paint_blanks_the_${cls}_path`, () => {
      assert.equal(styled(busy(), 90, style).querySelector(`path.${cls}`)?.getAttribute("d"), "");
    });
  }
}

for (const style of ["bars", "soft", "ridges", "aurora"]) {
  test(`test_a_${style}_paint_blanks_the_held_peaks_path`, () => {
    assert.equal(styled(busy(), 90, style).querySelector("path.shold")?.getAttribute("d"), "");
  });
}

test("test_a_trace_paint_on_a_section_rendered_under_aurora_marks_the_grid_trace", () => {
  setSpectrumStyle("aurora");
  const grid = styled(busy(), 90, "trace").querySelector(".sgrid1");
  assert.equal(grid?.getAttribute("data-style"), "trace");
});
