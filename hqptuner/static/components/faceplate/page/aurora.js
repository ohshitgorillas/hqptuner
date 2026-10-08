// The page spectrum's aurora style: cava's northern lights shader on its own WebGL2 canvas. Each paint turns the
// spectrum into bands falling under gravity, the per-frame steps in model/gauges/spectrumfx.js, and draws them as
// columns that glow brightest half way up the plot, in the painter's colour, over a transparent clear.

import { BANDS, bandsOf, fractionsOf, stepGravity } from "../../../model/gauges/spectrumfx.js";
import { STEP_MS } from "../../../store/meter/loop.js";
import { NORTHERN_LIGHTS_FRAG, PASS_THROUGH_VERT } from "../../../vendor/cava/northern_lights.js";

/** @typedef {import("../../../model/gauges/meter.js").SpectrumHold} SpectrumHold */
/** @typedef {import("../../../model/gauges/spectrumfx.js").GravityState} GravityState */

/** The time between two meter paints, s: the loop paints at most once a step. */
const DT = STEP_MS / 1000;
const VERSION = "#version 300 es\n";
const POSITION = 0; // the vertex shader's position attribute location
const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]); // the whole clip space as a triangle strip, x then y
const QUAD_SIZE = 2; // components per QUAD vertex
const QUAD_VERTICES = QUAD.length / QUAD_SIZE;

/**
 * A compiled shader of `type` from `source`, or null when it fails to compile.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {number} type
 * @param {string} source
 * @returns {WebGLShader | null}
 */
function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.warn("aurora shader:", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

/**
 * A program linked from `vert` and `frag`, or null when it fails to link.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLShader} vert
 * @param {WebGLShader} frag
 * @returns {WebGLProgram | null}
 */
function build(gl, vert, frag) {
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  console.warn("aurora program:", gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
  return null;
}

/**
 * The northern lights program, or null when either shader fails to compile or the program fails to link.
 *
 * @param {WebGL2RenderingContext} gl
 * @returns {WebGLProgram | null}
 */
function link(gl) {
  const vert = compile(gl, gl.VERTEX_SHADER, VERSION + PASS_THROUGH_VERT);
  const frag = compile(gl, gl.FRAGMENT_SHADER, `${VERSION}#define BANDS ${BANDS}\n${NORTHERN_LIGHTS_FRAG}`);
  const program = vert && frag ? build(gl, vert, frag) : null;
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  return program;
}

/**
 * A vertex array holding the full-screen quad at the position attribute.
 *
 * @param {WebGL2RenderingContext} gl
 * @returns {WebGLVertexArrayObject | null}
 */
function quad(gl) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(POSITION);
  gl.vertexAttribPointer(POSITION, QUAD_SIZE, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

/**
 * A painter for `canvas`, or null when the canvas has no WebGL2 context or the shader fails to build: `paint` draws
 * one meter scene's spectrum at `range` dB as northern lights in `colour`, `clear` empties the canvas. A paint with no
 * spectrum, or a clear, starts the bands' fall afresh.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {ArrayLike<number>} colour  RGB, each 0 to 1
 */
export function auroraPainter(canvas, colour) {
  const gl = canvas.getContext("webgl2");
  const program = gl && link(gl);
  if (!gl || !program) return null;
  const vao = quad(gl);
  const bars = gl.getUniformLocation(program, "bars");
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, "bars_count"), BANDS);
  gl.uniform3f(gl.getUniformLocation(program, "fg_color"), colour[0], colour[1], colour[2]);
  gl.clearColor(0, 0, 0, 0);
  /** @type {GravityState | null} */
  let gravity = null;
  const clear = () => {
    gravity = null;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };
  /**
   * @param {SpectrumHold | null} spectrum
   * @param {number} range  dB
   */
  const paint = (spectrum, range) => {
    const prev = gravity;
    clear();
    if (!spectrum) return;
    gravity = stepGravity(prev, bandsOf(fractionsOf(spectrum.disp, range), BANDS), DT);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform1fv(bars, gravity.lvl);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES);
  };
  return { paint, clear };
}
