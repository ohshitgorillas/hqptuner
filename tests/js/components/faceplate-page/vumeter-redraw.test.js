// Suite for the Source VU pair in hqptuner/static/components/faceplate/page/VuMeter.js once each face has taken the
// shape of its space (the Source meter's VU line as the faceplate spec gives it: each face's arc spans its width, scale
// -20 to +3 VU; timing rule 6). A face first draws a placeholder dial, then measures its space and redraws the
// dial, which can change how far the arc sweeps each way. A painter created on the pair while it shows the placeholder
// turns each needle along the dial the face draws after that redraw: a reading at an end of the scale points the needle
// at that end's mark on the redrawn scale.
//
// Mounting. The pair is mounted with preact's client renderer into a fake page (tests/js/support/page.js `fakePage`,
// hosted by `hostPage` from before the mount until after the unmount), laid out with each face FACE_W by FACE_H pixels
// and the pair holding both, so its layout effects, effects, re-renders and resize reports run.
// `needlePainter(needles)` is created on the pair's needles as the Source section finds them under the mount root (hqptuner/static/components/faceplate/page/SourceMeter.js: every element carrying class `vun`, in
// document order), as soon as the first render commits, before anything the mount scheduled has run, as a painter
// created when the root mounts is; then the page settles, and only then does the painter paint. Nothing the painter
// does is stubbed and the painter is handed nothing but those needles.
//
// Reading the dial. A dial is an element carrying `data-testid="vu-meter"`, the upper (L, channel 0) first. A scale
// mark is an element inside a dial carrying `data-vu`, its reading in VU. The needle is the one element a paint writes
// inside a dial (tests/js/components/faceplate-page/vumeter.test.js). Needle and marks are read as drawn: each a line
// from (x1, y1) to (x2, y2), carried into the dial's drawing space through the `translate`, `rotate`, `scale` and
// `matrix` transforms of it and its ancestors inside the dial's `svg`, a style transform standing over a transform
// attribute. The needle's pivot is the start of its line; it points along the line to its other end. A mark stands at
// the direction from that pivot to its midpoint. Directions are degrees clockwise from upright.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/vumeter-redraw.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render } from "preact";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { VuPair, needlePainter } from "../../../../hqptuner/static/components/faceplate/page/VuMeter.js";
import { fakeClock } from "../../support/clock.js";
import { fakePage, hostPage } from "../../support/page.js";
import { near } from "../../support/near.js";
import { vuReading } from "../../support/painters/vustate.js";

/** @typedef {ReturnType<typeof fakePage>} Page */
/** @typedef {[number, number, number, number, number, number]} Matrix */

//: The channels the pair draws, L and R.
const CHANNELS = 2;
//: The ends of the Source meter's VU scale, VU: -20 to +3.
const BOTTOM_VU = -20;
const TOP_VU = 3;
//: The dials, by where they stand, and the channel each shows.
const DIALS = /** @type {const} */ ([
  ["upper", 0],
  ["lower", 1],
]);
//: The ends of the scale, by name.
const ENDS = /** @type {const} */ ([
  ["bottom", BOTTOM_VU],
  ["top", TOP_VU],
]);
//: The space each face is laid out in, CSS pixels: a face wider than tall but not twice as wide.
const FACE_W = 240;
const FACE_H = 180;
//: How far a needle and a mark may stand apart and still point the same way, degrees: rounding of drawn coordinates.
const ANGLE_TOL = 0.5;

//: The marker a dial carries and the attribute a scale mark carries.
const DIAL_ID = "vu-meter";
const MARK_ATTR = "data-vu";
//: The selector the Source section finds the needles by.
const NEEDLE_SELECTOR = ".vun";
//: The page's markup: the root the pair mounts into, and its id.
const ROOT_ID = "root";
const PAGE_HTML = `<div id="${ROOT_ID}"></div>`;

const IDENTITY = /** @type {Matrix} */ ([1, 0, 0, 1, 0, 0]);
const ANGLE_UNITS = /** @type {Record<string, number>} */ ({ "": 1, deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 });

/**
 * @param {Matrix} m
 * @param {Matrix} n
 * @returns {Matrix}  m then n applied inside it: m · n
 */
const times = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/**
 * @param {number} deg
 * @returns {Matrix}
 */
function rotation(deg) {
  const r = (deg * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {Matrix}
 */
const shift = (x, y) => [1, 0, 0, 1, x, y];

/**
 * The unit an angle is written in, "" for none.
 *
 * @param {string} arg
 * @returns {string}
 */
const angleUnit = (arg) => Object.keys(ANGLE_UNITS).find((u) => u !== "" && arg.toLowerCase().endsWith(u)) ?? "";

//: The transform functions this suite reads, each from its arguments as written.
const TRANSFORMS = /** @type {Record<string, (args: string[]) => Matrix>} */ ({
  translate: (args) => shift(Number.parseFloat(args[0]), Number.parseFloat(args[1] ?? "0")),
  scale: (args) => {
    const [sx, sy] = [Number.parseFloat(args[0]), Number.parseFloat(args[1] ?? args[0])];
    return [sx, 0, 0, sy, 0, 0];
  },
  matrix: (args) => /** @type {Matrix} */ (args.slice(0, 6).map(Number.parseFloat)),
  rotate: (args) => {
    const turn = rotation(Number.parseFloat(args[0]) * ANGLE_UNITS[angleUnit(args[0])]);
    const [cx, cy] = [Number.parseFloat(args[1] ?? "0"), Number.parseFloat(args[2] ?? "0")];
    return times(times(shift(cx, cy), turn), shift(-cx, -cy));
  },
});

/**
 * The matrix a transform list stands for; NaN entries for a function this suite does not read.
 *
 * @param {string} list
 * @returns {Matrix}
 */
function parseTransform(list) {
  let m = IDENTITY;
  for (const call of list.split(")")) {
    const [fn, args = ""] = call.split("(");
    const name = fn.trim().toLowerCase();
    if (name === "") continue;
    const make = TRANSFORMS[name];
    m = make ? times(m, make(args.split(/[\s,]+/).filter(Boolean))) : [NaN, NaN, NaN, NaN, NaN, NaN];
  }
  return m;
}

/**
 * The matrix carrying `el`'s own coordinates into its `svg`'s drawing space.
 *
 * @param {any} el
 * @returns {Matrix}
 */
function toDrawing(el) {
  let m = IDENTITY;
  for (let at = el; at !== null && at.localName !== "svg"; at = at.parentElement) {
    const own = at.style.transform || at.getAttribute("transform") || "";
    m = times(parseTransform(own), m);
  }
  return m;
}

/**
 * The two ends of a drawn line, in its svg's drawing space.
 *
 * @param {any} el
 * @returns {[[number, number], [number, number]]}
 */
function lineEnds(el) {
  const m = toDrawing(el);
  const at = (/** @type {string} */ x, /** @type {string} */ y) => {
    const px = Number.parseFloat(el.getAttribute(x) ?? "NaN");
    const py = Number.parseFloat(el.getAttribute(y) ?? "NaN");
    return /** @type {[number, number]} */ ([m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]]);
  };
  return [at("x1", "y1"), at("x2", "y2")];
}

/**
 * The direction from `from` to `to`, degrees clockwise from upright.
 *
 * @param {[number, number]} from
 * @param {[number, number]} to
 * @returns {number}
 */
const direction = (from, to) => (Math.atan2(to[0] - from[0], from[1] - to[1]) * 180) / Math.PI;

/**
 * Every element of the page, in document order.
 *
 * @param {Page} dom
 * @returns {any[]}
 */
const allOf = (dom) => [...dom.doc.querySelectorAll("*")];

/**
 * The dials in document order.
 *
 * @param {Page} dom
 * @returns {any[]}
 */
const dialsOf = (dom) => allOf(dom).filter((el) => el.getAttribute("data-testid") === DIAL_ID);

/**
 * The laid-out size of `el`: a face and everything in it FACE_W by FACE_H, the pair and its root holding both faces.
 *
 * @param {any} el
 * @returns {{ width: number, height: number }}
 */
function boxIn(el) {
  for (let at = el; at !== null; at = at.parentElement) {
    if (at.getAttribute("data-testid") === DIAL_ID) return { width: FACE_W, height: FACE_H };
  }
  return { width: FACE_W, height: CHANNELS * FACE_H };
}

/**
 * Where dial `d`'s needle points, and where the drawn scale's mark for `vu` stands seen from the needle's pivot, after
 * the pair is mounted and laid out, a painter created at its first commit, the page settled and one paint with every
 * channel at `vu`. NaN for the needle when the paint wrote no element in the dial, or more than one; NaN for the mark
 * when the dial draws none at `vu`.
 *
 * @param {number} d
 * @param {number} vu
 * @returns {{ needle: number, mark: number }}
 */
function pointing(d, vu) {
  const dom = fakePage({ clock: fakeClock().clock, html: PAGE_HTML, boxOf: boxIn });
  const root = dom.doc.getElementById(ROOT_ID);
  const release = hostPage(dom);
  try {
    render(html`<${VuPair} />`, root);
    const painter = needlePainter(Array.from(root.querySelectorAll(NEEDLE_SELECTOR)));
    dom.settle();
    dom.mark();
    painter.paint(vuReading(new Array(CHANNELS).fill(vu)));
    const dial = dialsOf(dom)[d];
    const moved = dial === undefined ? [] : dom.writes().filter((el) => dom.within(el, dial));
    if (moved.length !== 1) return { needle: NaN, mark: NaN };
    const [pivot, tip] = lineEnds(moved[0]);
    const mark = allOf(dom).find((el) => dom.within(el, dial) && Number(el.getAttribute(MARK_ATTR) ?? NaN) === vu);
    if (mark === undefined) return { needle: direction(pivot, tip), mark: NaN };
    const [a, b] = lineEnds(mark);
    return { needle: direction(pivot, tip), mark: direction(pivot, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) };
  } finally {
    render(null, root);
    release();
  }
}

for (const [dialName, d] of DIALS) {
  for (const [endName, vu] of ENDS) {
    test(`test_after_the_face_redraws_its_dial_the_${dialName}_needle_at_the_${endName}_of_the_scale_points_at_that_end_s_mark`, () => {
      const { needle, mark } = pointing(d, vu);
      assert.ok(...near(needle, mark, ANGLE_TOL));
    });
  }
}
