// The page spectrum's aurora style: cava's northern lights shader on its own WebGL2 canvas. Each paint turns the
// shown spectrum columns into plot fractions and bands (model/gauges/meter/spectrumfx.js), moves the painter's bands
// toward them under gravity by the wall time the paint is handed (model/gauges/meter/steps.js), and draws them over
// the whole canvas, colored base to crown through the picked color suite's ramp. Accent draws in the accent in force
// at each paint. A restart, or a paint with no spectrum, clears the canvas and starts the bands and the sway afresh.

import { fractionsOf } from "../../../model/gauges/meter/meter.js";
import { ACCENT, BANDS, bandsOf, suiteRamp } from "../../../model/gauges/meter/spectrumfx.js";
import { freshGravity, stepGravity } from "../../../model/gauges/meter/steps.js";
import { accentInForce } from "../../../store/ui/theme.js";
import { NORTHERN_LIGHTS_FRAG, PASS_THROUGH_VERT } from "../../../vendor/cava/northern_lights.js";

/**
 * @typedef {object} AuroraPainter
 * @property {(
 *   columns: ArrayLike<number> | null | undefined,
 *   range: number,
 *   suite: string | undefined,
 *   opts: { dt: number, restart: boolean },
 * ) => void} paint  draws the columns, dBFS as the trace shows them, over `range` dB (positive), in color suite `suite`
 *   (Accent where none is given), `opts.dt` wall seconds after the last paint; a restart or no spectrum starts afresh
 * @property {() => void} clear  blanks the canvas
 */

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
 * A function uploading to `rampAt` the ramp of the color suite it is handed, under Accent in the accent in force, where
 * that suite and accent differ from the ones the uploaded ramp was drawn from.
 *
 * @param {WebGL2RenderingContext} gl
 * @param {WebGLUniformLocation | null} rampAt
 * @returns {(suite: string) => void}
 */
function inker(gl, rampAt) {
  let inkedSuite = ""; // the color suite the uploaded ramp is drawn from; empty while no ramp is uploaded
  let inkedAccent = ""; // the accent in force when the uploaded ramp was drawn
  return (suite) => {
    const accent = accentInForce();
    if (suite === inkedSuite && accent === inkedAccent) return;
    inkedSuite = suite;
    inkedAccent = accent;
    gl.uniform3fv(rampAt, suiteRamp(suite, STOPS, accent));
  };
}

/**
 * The aurora painter for `canvas`, or null where the canvas has no WebGL2 context, a shader fails to compile or the
 * program fails to link.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {AuroraPainter | null}
 */
export function auroraPainter(canvas) {
  const gl = canvas.getContext("webgl2");
  const program = gl && link(gl, STOPS);
  if (!gl || !program) return null;
  const vao = quad(gl);
  const barsAt = gl.getUniformLocation(program, "bars");
  const timeAt = gl.getUniformLocation(program, "time");
  const ink = inker(gl, gl.getUniformLocation(program, "ramp"));
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, "bars_count"), BANDS);
  gl.clearColor(0, 0, 0, 0);
  const levels = new Float32Array(BANDS); // the bands as the shader is handed them
  let gravity = freshGravity(BANDS);
  let rested = true; // whether `gravity` is fresh, with no step taken since
  let sway = 0; // s, wall time summed from every `dt` since the bands last started afresh
  /** @type {Float32Array | undefined} */
  let fracs; // the plot fractions of the last paint, written over by the next
  /** @type {Float32Array | undefined} */
  let bands; // the bands of the last paint, written over by the next

  const clear = () => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
  };

  const draw = () => {
    for (let i = 0; i < BANDS; i++) levels[i] = gravity.lvl[i];
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindVertexArray(vao);
    gl.uniform1fv(barsAt, levels);
    gl.uniform1f(timeAt, sway);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, QUAD_VERTICES);
  };

  /** @type {AuroraPainter["paint"]} */
  const paint = (columns, range, suite = ACCENT, opts) => {
    const { dt, restart } = opts;
    if (typeof dt !== "number")
      throw new TypeError("aurora paint: dt, the wall seconds since the last paint, is required");
    const fresh = restart || !columns?.length;
    if (fresh) {
      if (!rested) gravity = freshGravity(BANDS);
      rested = true;
      sway = 0;
      clear();
    } else {
      sway += dt;
    }
    if (columns?.length) {
      fracs = fractionsOf(columns, range, fracs);
      bands = bandsOf(fracs, BANDS, bands);
      stepGravity(gravity, bands, dt);
      rested = false;
    }
    gl.useProgram(program);
    ink(suite);
    draw();
  };

  return { paint, clear };
}
