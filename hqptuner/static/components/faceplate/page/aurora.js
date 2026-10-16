// The page spectrum's aurora style: cava's northern lights shader on its own WebGL2 canvas. Each paint turns the
// spectrum's column levels, as they came before the trace's smoothing and easing, into bands falling under aurora's own
// gravity, the per-frame steps in model/gauges/meter/spectrumfx.js, and draws them as columns rising from the plot's floor to
// their level, each colored base to crown through the picked color suite's ramp, over a transparent clear. Accent
// draws in the accent in force at each paint.

import {
  ACCENT,
  AURORA_GRAVITY,
  BANDS,
  bandsOf,
  fractionsOf,
  stepGravity,
  suiteRamp,
} from "../../../model/gauges/meter/spectrumfx.js";
import { accentInForce } from "../../../store/ui/theme.js";
import { NORTHERN_LIGHTS_FRAG, PASS_THROUGH_VERT } from "../../../vendor/cava/northern_lights.js";

/** @typedef {import("../../../model/gauges/meter/spectrumfx.js").GravityState} GravityState */

const VERSION = "#version 300 es\n";
const POSITION = 0; // the vertex shader's position attribute location
const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]); // the whole clip space as a triangle strip, x then y
const QUAD_SIZE = 2; // components per QUAD vertex
const QUAD_VERTICES = QUAD.length / QUAD_SIZE;
const STOPS = 6; // colors in the ramp the shader blends, base to crown

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
 * The northern lights program for a ramp of `stops` colors, or null when either shader fails to compile or the
 * program fails to link.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {number} stops
 * @returns {WebGLProgram | null}
 */
function link(gl, stops) {
  const vert = compile(gl, gl.VERTEX_SHADER, VERSION + PASS_THROUGH_VERT);
  const defines = `#define BANDS ${BANDS}\n#define STOPS ${stops}\n`;
  const frag = compile(gl, gl.FRAGMENT_SHADER, VERSION + defines + NORTHERN_LIGHTS_FRAG);
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
 * one meter scene's spectrum column levels at `range` dB as northern lights colored base to crown through the color
 * suite's ramp, `clear` empties the canvas. A paint with no levels, or a clear, starts the bands' fall and the columns'
 * sway afresh.
 *
 * @param {HTMLCanvasElement} canvas
 */
export function auroraPainter(canvas) {
  const gl = canvas.getContext("webgl2");
  const program = gl && link(gl, STOPS);
  if (!gl || !program) return null;
  const vao = quad(gl);
  const bars = gl.getUniformLocation(program, "bars");
  const time = gl.getUniformLocation(program, "time");
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, "bars_count"), BANDS);
  const rampAt = gl.getUniformLocation(program, "ramp");
  gl.clearColor(0, 0, 0, 0);
  let inked = ""; // the color suite and accent the uploaded ramp is drawn from; empty while no ramp is uploaded
  /** @type {GravityState | null} */
  let gravity = null;
  /** @type {Float32Array | undefined} */
  let fracs; // the plot fractions of the last paint, written over by the next
  /** @type {Float32Array | undefined} */
  let bands; // the bands of the last paint; stepGravity copies them
  let elapsed = 0; // s, the time told to every paint that drew since the last clear
  const clear = () => {
    gravity = null;
    elapsed = 0;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };
  /**
   * @param {ArrayLike<number> | null} levels  dBFS, one per column
   * @param {number} range  dB
   * @param {string | undefined} suite  the color suite, Accent where none is given
   * @param {{ dt: number }} step  `dt`: s since the last paint
   */
  const paint = (levels, range, suite = ACCENT, { dt }) => {
    const prev = gravity;
    const was = elapsed;
    clear();
    if (!levels) return;
    fracs = fractionsOf(levels, range, fracs);
    bands = bandsOf(fracs, BANDS, bands);
    gravity = stepGravity(prev, bands, dt, AURORA_GRAVITY);
    elapsed = was + dt;
    gl.useProgram(program);
    const accent = accentInForce();
    if (`${suite} ${accent}` !== inked) {
      inked = `${suite} ${accent}`;
      gl.uniform3fv(rampAt, Float32Array.from(suiteRamp(suite, STOPS, accent)));
    }
    gl.bindVertexArray(vao);
    gl.uniform1fv(bars, gravity.lvl);
    gl.uniform1f(time, elapsed);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES);
  };
  return { paint, clear };
}
