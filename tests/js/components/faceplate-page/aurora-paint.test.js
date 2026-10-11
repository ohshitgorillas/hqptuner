// Painter suite for hqptuner/static/components/faceplate/page/aurora.js: the page spectrum's aurora style, drawn by a
// WebGL2 shader on its own canvas. A canvas with no WebGL2 context gets no painter. With one, a paint of a spectrum's
// column levels uploads one bar value per band in one array and draws once; a paint with no spectrum and a clear only
// clear. The bars sit on the bands of the first paint's levels and fall under aurora's own gravity, one step a paint.
//
// The canvas is a fake whose WebGL2 context records every method called on it by name and arguments. Names in capitals
// are the context's constants and read as numbers; the shader and program checks pass unless a test fails one, and
// every `create*` hands back a fresh object. Only the upload and the drawing calls are read back, so how the painter sets up its program, its
// quad or its colour is never asserted.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/aurora-paint.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { auroraPainter } from "../../../../hqptuner/static/components/faceplate/page/aurora.js";

/** @typedef {{ name: string, args: unknown[] }} Call */
/** @typedef {{ width: number, height: number, calls: Call[], getContext: (kind: string) => unknown }} FakeCanvas */

//: The canvas, in device pixels.
const W = 480;
const H = 170;
//: A 60 dB plot.
const RANGE = 60;
//: The colour a painter is built with.
const COLOUR = [0.2, 0.6, 0.4];
//: The calls that put pixels on the canvas or take them off.
const DRAWS = new Set(["clear", "drawArrays", "drawElements"]);

/** What the context's methods hand back, by name; every other method hands back nothing. */
const MADE = {
  getShaderParameter: () => true,
  getProgramParameter: () => true,
  getShaderInfoLog: () => "",
  getProgramInfoLog: () => "",
  getAttribLocation: () => 0,
  getUniformLocation: () => ({}),
  createShader: () => ({}),
  createProgram: () => ({}),
  createBuffer: () => ({}),
  createVertexArray: () => ({}),
  isContextLost: () => false,
};

/**
 * A W by H canvas whose WebGL2 context records each method called on it and hands back what `made` names; with `gl`
 * false it has no WebGL2 context.
 *
 * @param {boolean} [gl]
 * @param {Record<string, (...args: any[]) => unknown>} [made]
 * @returns {FakeCanvas}
 */
function fakeCanvas(gl = true, made = MADE) {
  /** @type {FakeCanvas} */
  const canvas = {
    width: W,
    height: H,
    calls: [],
    getContext: (kind) => (gl && kind === "webgl2" ? ctx : null),
  };
  /** @type {Record<string | symbol, unknown>} */
  const props = { canvas, drawingBufferWidth: W, drawingBufferHeight: H };
  const ctx = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key in props) return props[key];
        const name = String(key);
        if (/^[A-Z0-9_]+$/.test(name)) return name.length;
        return (/** @type {unknown[]} */ ...args) => {
          canvas.calls.push({ name, args });
          const make = made[name];
          return make ? make(...args) : undefined;
        };
      },
      set: (_t, key, value) => {
        props[key] = value;
        return true;
      },
    },
  );
  return canvas;
}

/**
 * The calls recorded while `act` runs on a painter built on a fresh fake canvas, the painter's setup forgotten. With no
 * painter built, nothing is recorded.
 *
 * @param {(fx: { paint: (levels: ArrayLike<number> | null, r: number) => void, clear: () => void }) => void} act
 * @returns {Call[]}
 */
function during(act) {
  const canvas = fakeCanvas();
  const fx = auroraPainter(/** @type {HTMLCanvasElement} */ (/** @type {unknown} */ (canvas)), COLOUR);
  canvas.calls = [];
  if (fx) act(fx);
  return canvas.calls;
}

/**
 * The names of the drawing calls among `calls`, in order.
 *
 * @param {Call[]} calls
 */
const draws = (calls) => calls.filter((c) => DRAWS.has(c.name)).map((c) => c.name);

// ── no WebGL2 ────────────────────────────────────────────────────────────

test("test_a_canvas_without_a_webgl2_context_gets_no_painter", () => {
  const canvas = fakeCanvas(false);
  assert.equal(auroraPainter(/** @type {HTMLCanvasElement} */ (/** @type {unknown} */ (canvas)), COLOUR), null);
});

/**
 * What `auroraPainter` hands back for a canvas whose context hands back `made`, with the painter's warnings kept off
 * the console.
 *
 * @param {Record<string, (...args: any[]) => unknown>} made
 */
function painterOn(made) {
  const canvas = fakeCanvas(true, made);
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    return auroraPainter(/** @type {HTMLCanvasElement} */ (/** @type {unknown} */ (canvas)), COLOUR);
  } finally {
    console.warn = realWarn;
  }
}

// ── a shader that fails to build ─────────────────────────────────────────

test("test_a_canvas_whose_shaders_fail_to_compile_gets_no_painter", () => {
  assert.equal(painterOn({ ...MADE, getShaderParameter: () => false }), null);
});

test("test_a_canvas_whose_program_fails_to_link_gets_no_painter", () => {
  assert.equal(painterOn({ ...MADE, getProgramParameter: () => false }), null);
});

// ── nothing to draw ──────────────────────────────────────────────────────

test("test_a_paint_with_no_spectrum_only_clears", () => {
  assert.deepEqual(draws(during((fx) => fx.paint(null, RANGE))), ["clear"]);
});

test("test_clear_only_clears_once", () => {
  assert.deepEqual(draws(during((fx) => fx.clear())), ["clear"]);
});
