// Suite for the Source VU pair in hqptuner/static/components/faceplate/page/VuMeter.js (the Source meter's VU line as
// the faceplate spec gives it; timing rules 6 and 9): one needle dial per channel, L over R, each on a scale
// from -20 to +3 VU marked red above 0 VU, and a painter that turns each channel's needle to where the model's scale
// share (hqptuner/static/model/gauges/meter/vu.js `scaleShare`) puts that channel's reading.
//
// Markup contract. `VuPair` renders with no props. A dial is an element carrying `data-testid="vu-meter"`; the dials
// stand in document order, the upper (L, channel 0) first. A scale mark is an element inside a dial carrying
// `data-vu`, its reading in VU as a decimal number; a mark in the red part of the scale also carries
// `data-zone="red"`. No label text is read.
//
// Painter contract. The pair is mounted with preact's client renderer into tests/js/support/painters/livedom.js, every
// element laid out FACE_W by FACE_H pixels, so each face measures its space and redraws its dial as on the page.
// `needlePainter(needles)` is created once on the pair's needles as the Source section finds them under the mount root
// (hqptuner/static/components/faceplate/page/SourceMeter.js): every element carrying class `vun`, in document order,
// one per channel, as soon as the first render commits; then the page settles, the document is taken off the global,
// and only then does the painter paint. It returns `{ paint(vu) }`, where `vu` is the model's VuState (`vu` per
// channel, the reading in VU; `deflection` and `speed` consistent with it). A needle's angle is the rotation the paint
// writes to it, in degrees clockwise from upright, as that module reads it. Where the needle points is read only from
// what a paint wrote: the one element a paint writes inside a dial is that dial's needle.
//
// That a paint allocates nothing is not observed here; that it reads nothing is: after creation the document is
// darkened (queries find nothing, attributes and properties read absent) and no document exists on the global, so a
// paint that looks anything up again draws nothing.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/vumeter.test.js

import test from "node:test";
import assert from "node:assert/strict";
import { render as mount } from "preact";
import { render } from "preact-render-to-string";

import { html } from "../../../../hqptuner/static/lib/dom.js";
import { VuPair, needlePainter } from "../../../../hqptuner/static/components/faceplate/page/VuMeter.js";
import { scaleShare } from "../../../../hqptuner/static/model/gauges/meter/vu.js";
import { attr, elements } from "../../support/markup.js";
import { liveDom } from "../../support/painters/livedom.js";
import { near } from "../../support/near.js";
import { vuReading } from "../../support/painters/vustate.js";

/** @typedef {import("../../support/markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../../support/painters/livedom.js").LiveDom} LiveDom */
/** @typedef {import("../../../../hqptuner/static/components/faceplate/page/VuMeter.js").NeedlePainter} NeedlePainter */

//: The channels the pair draws, L and R.
const CHANNELS = 2;
//: The ends of the Source meter's VU scale and its 0 VU, VU: -20 to +3, red above 0.
const BOTTOM_VU = -20;
const TOP_VU = 3;
const ZERO_VU = 0;
//: The dials, by where they stand, and the channel each shows.
const DIALS = /** @type {const} */ ([
  ["upper", 0],
  ["lower", 1],
]);
//: Readings inside the scale where a needle linear in VU and one linear in voltage stand well apart.
const INSIDE = [-10, -3, 0, 1];
//: Readings past the scale, and the end each is held at: silence, well under the bottom, well over the top.
const PAST = /** @type {const} */ ([
  ["silence", -Infinity, BOTTOM_VU],
  ["minus_40", -40, BOTTOM_VU],
  ["plus_6", 6, TOP_VU],
]);
//: How far two needle angles may stand apart and still point the same way, degrees: rounding of a written angle.
const ANGLE_TOL = 0.1;
//: The space every element of the mounted pair is laid out in, CSS pixels: a face wider than tall but not twice as
//: wide, so each face redraws the dial it first draws.
const FACE_W = 240;
const FACE_H = 180;
const FACE_BOX = { width: FACE_W, height: FACE_H };

//: The marker a dial carries, the attribute a scale mark carries, and the red part's marker.
const DIAL_ID = "vu-meter";
const MARK_ATTR = "data-vu";
const ZONE_ATTR = "data-zone";
const RED = "red";
//: The selector the Source section finds the needles by.
const NEEDLE_SELECTOR = ".vun";

/** The pair's rendered markup. */
const markup = () => render(html`<${VuPair} />`);

/**
 * @param {number[]} xs
 * @returns {number}  NaN when there are none
 */
const least = (xs) => (xs.length === 0 ? NaN : Math.min(...xs));

/**
 * @param {number[]} xs
 * @returns {number}  NaN when there are none
 */
const greatest = (xs) => (xs.length === 0 ? NaN : Math.max(...xs));

/**
 * The scale marks of dial `d` (0 upper), each as its reading and whether it is marked red.
 *
 * @param {number} d
 * @returns {{ vu: number, red: boolean }[]}
 */
function marks(d) {
  const all = elements(markup()).sort((a, b) => a.start - b.start);
  const dial = all.filter((e) => attr(e, "data-testid") === DIAL_ID)[d];
  if (dial === undefined) return [];
  const end = dial.start + dial.html.length;
  return all
    .filter((e) => e.start > dial.start && e.start < end && attr(e, MARK_ATTR) !== undefined)
    .map((e) => ({ vu: Number(attr(e, MARK_ATTR)), red: attr(e, ZONE_ATTR) === RED }));
}

/**
 * The mounted dials in document order.
 *
 * @param {LiveDom} dom
 * @returns {any[]}
 */
const dialsOf = (dom) => dom.all().filter((el) => el.getAttribute("data-testid") === DIAL_ID);

/**
 * What `run` returns with `dom`'s document on the global, taken off again after.
 *
 * @template T
 * @param {LiveDom} dom
 * @param {() => T} run
 * @returns {T}
 */
function withDocument(dom, run) {
  dom.install();
  try {
    return run();
  } finally {
    dom.uninstall();
  }
}

/**
 * What `use` makes of a freshly mounted, laid-out pair and a painter created on its needles, found under the mount root
 * as the Source section finds them, at the first commit; `use` runs once the page has settled and the document is off
 * the global. The pair is unmounted after.
 *
 * @template T
 * @param {(dom: LiveDom, painter: NeedlePainter) => T} use
 * @returns {T}
 */
function onPair(use) {
  const dom = liveDom(() => FACE_BOX);
  try {
    const painter = withDocument(dom, () => {
      mount(html`<${VuPair} />`, dom.root);
      const made = needlePainter(Array.from(dom.root.querySelectorAll(NEEDLE_SELECTOR)));
      dom.settle();
      return made;
    });
    return use(dom, painter);
  } finally {
    withDocument(dom, () => mount(null, dom.root));
  }
}

/**
 * The angle of the needle a paint turned in `dial`: the rotation of the one element written inside it since the
 * document's last mark. NaN when the paint wrote no element there, or more than one.
 *
 * @param {LiveDom} dom
 * @param {any} dial
 * @returns {number}
 */
function needleAngle(dom, dial) {
  if (dial === undefined) return NaN;
  const moved = dom.writes().filter((el) => dom.within(el, dial));
  return moved.length === 1 ? dom.rotation(moved[0]) : NaN;
}

/**
 * What `read` makes of a freshly mounted pair after one paint of `readings` by a painter created on it.
 *
 * @template T
 * @param {number[]} readings  per channel, VU
 * @param {(dom: LiveDom) => T} read
 * @returns {T}
 */
function painted(readings, read) {
  return onPair((dom, painter) => {
    dom.mark();
    painter.paint(vuReading(readings));
    return read(dom);
  });
}

/**
 * The angle dial `d` shows after one paint with every channel at `vu`.
 *
 * @param {number} d
 * @param {number} vu
 * @returns {number}  degrees clockwise from upright
 */
const angleAt = (d, vu) => painted(new Array(CHANNELS).fill(vu), (dom) => needleAngle(dom, dialsOf(dom)[d]));

/**
 * The angle dial `d` shows after a painter, created on a fresh pair whose document is then darkened, paints the bottom
 * of the scale and then the top. A paint that throws leaves what the paints before it wrote.
 *
 * @param {number} d
 * @returns {number}  degrees clockwise from upright
 */
function angleOnceDark(d) {
  return onPair((dom, painter) => {
    const dial = dialsOf(dom)[d];
    dom.darken();
    try {
      painter.paint(vuReading(new Array(CHANNELS).fill(BOTTOM_VU)));
      dom.mark();
      painter.paint(vuReading(new Array(CHANNELS).fill(TOP_VU)));
    } catch {
      return NaN;
    }
    return needleAngle(dom, dial);
  });
}

/**
 * The index of the dial each element a paint wrote stands in, -1 for one outside every dial, in document order.
 *
 * @returns {number[]}
 */
const dialsWritten = () =>
  painted([ZERO_VU, ZERO_VU], (dom) => {
    const dials = dialsOf(dom);
    return dom.writes().map((el) => dials.findIndex((dial) => dom.within(el, dial)));
  });

// The pair's markup.

test("test_the_pair_draws_one_dial_per_channel", () => {
  const dials = elements(markup()).filter((e) => attr(e, "data-testid") === DIAL_ID);
  assert.equal(dials.length, CHANNELS);
});

for (const [name, d] of DIALS) {
  test(`test_the_${name}_dial_scale_starts_at_minus_20_vu`, () => {
    assert.equal(least(marks(d).map((m) => m.vu)), BOTTOM_VU);
  });

  test(`test_the_${name}_dial_scale_ends_at_plus_3_vu`, () => {
    assert.equal(greatest(marks(d).map((m) => m.vu)), TOP_VU);
  });

  test(`test_the_${name}_dial_marks_red_every_mark_above_0_vu`, () => {
    const unred = marks(d)
      .filter((m) => !m.red)
      .map((m) => m.vu);
    assert.equal(greatest(unred), ZERO_VU);
  });

  test(`test_the_${name}_dial_marks_no_mark_at_or_below_0_vu_red`, () => {
    const red = marks(d)
      .filter((m) => m.red)
      .map((m) => m.vu);
    const lowest = least(red);
    assert.ok(lowest > ZERO_VU, `lowest red mark ${lowest} VU`);
  });
}

// The painter.

test("test_the_upper_dial_follows_the_left_channel_and_the_lower_the_right", () => {
  const [up, down] = painted([TOP_VU, BOTTOM_VU], (dom) => dialsOf(dom).map((dial) => needleAngle(dom, dial)));
  assert.ok(up > down, `upper ${up}, lower ${down}`);
});

for (const [name, d] of DIALS) {
  test(`test_the_top_of_the_scale_turns_the_${name}_needle_clockwise_of_upright`, () => {
    const top = angleAt(d, TOP_VU);
    assert.ok(top > 0, `top ${top}`);
  });

  test(`test_the_${name}_needle_stands_as_far_left_of_upright_at_the_bottom_as_right_at_the_top`, () => {
    assert.ok(...near(angleAt(d, BOTTOM_VU), -angleAt(d, TOP_VU), ANGLE_TOL));
  });

  for (const vu of INSIDE) {
    test(`test_the_${name}_needle_at_${vu}_vu_stands_its_scale_share_of_the_way_from_bottom_to_top`, () => {
      const bottom = angleAt(d, BOTTOM_VU);
      const top = angleAt(d, TOP_VU);
      assert.ok(...near(angleAt(d, vu), bottom + scaleShare(vu) * (top - bottom), ANGLE_TOL));
    });
  }

  for (const [label, vu, end] of PAST) {
    test(`test_the_${name}_needle_holds_at_the_end_of_the_scale_for_a_reading_of_${label}`, () => {
      assert.ok(...near(angleAt(d, vu), angleAt(d, end), ANGLE_TOL));
    });
  }

  test(`test_a_paint_points_the_${name}_needle_from_what_the_painter_read_at_creation`, () => {
    assert.ok(...near(angleOnceDark(d), angleAt(d, TOP_VU), ANGLE_TOL));
  });
}

test("test_a_paint_writes_one_element_in_each_dial_and_nothing_else", () => {
  assert.deepEqual(dialsWritten(), [0, 1]);
});
