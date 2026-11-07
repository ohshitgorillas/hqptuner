// The canvases of tests/js/support/page.js and their draw ledger. No test() and no assert lives here.
//
// A canvas answers `getContext("2d")` with a context that keeps its drawing state and draws nothing, and
// `getContext("webgl2")` with a context whose shaders compile and whose programs link, every create call handing back
// a fresh object and every uniform location naming the program and uniform it was asked for; any other kind gets null.
// A canvas given faults fails where they say: it has no WebGL2 context, its vertex or fragment shaders fail to
// compile, or its programs fail to link. Every context asked, every call made on a context and every property it is
// given is a row of that canvas's ledger, in order: `{ call: "getContext", args: [kind] }`, `{ call: name, args }`,
// `{ set: name, value }`. A call's arrays, typed arrays and array buffers are kept as they were when the call was made,
// so a later write into the same array changes no row; any other argument is kept as itself.

/** @typedef {{ call: string, args: unknown[] } | { set: string, value: unknown }} LedgerRow */
/** @typedef {{ fail?: "context" | "vertex" | "fragment" | "link" }} GlFaults */

//: The width `measureText` gives each character, CSS pixels.
const GLYPH_W = 6;

//: A 2d context's drawing state before anything sets it, as the browser's defaults.
const STATE_2D = Object.freeze({
  fillStyle: "#000000",
  strokeStyle: "#000000",
  lineWidth: 1,
  lineCap: "butt",
  lineJoin: "miter",
  miterLimit: 10,
  lineDashOffset: 0,
  globalAlpha: 1,
  globalCompositeOperation: "source-over",
  font: "10px sans-serif",
  textAlign: "start",
  textBaseline: "alphabetic",
  direction: "inherit",
  filter: "none",
  imageSmoothingEnabled: true,
  imageSmoothingQuality: "low",
  shadowBlur: 0,
  shadowColor: "rgba(0, 0, 0, 0)",
  shadowOffsetX: 0,
  shadowOffsetY: 0,
});

//: The bits of `clear`'s mask, as WebGL defines them.
const GL_BITS = Object.freeze({ COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x100, STENCIL_BUFFER_BIT: 0x400 });

//: The shader type each compile fault fails.
const FAILING_SHADER = Object.freeze({ vertex: "VERTEX_SHADER", fragment: "FRAGMENT_SHADER" });

//: What the WebGL2 context answers, by method, where the answer is not nothing.
const GL_ANSWERS = /** @type {Record<string, (...args: any[]) => unknown>} */ ({
  getShaderInfoLog: () => "",
  getProgramInfoLog: () => "",
  getAttribLocation: () => 0,
  getParameter: () => 4096,
  getError: () => 0,
  isContextLost: () => false,
  getExtension: () => null,
  getSupportedExtensions: () => [],
});

/**
 * How a WebGL2 context under `faults` answers whether a shader compiled and a program linked, and the location of a
 * uniform: a shader fails where its type is the one `faults` fails, a program where `faults` fails the link, and a
 * location is `{ program, name }`.
 *
 * @param {GlFaults} faults
 * @param {(name: string) => number} constant
 * @returns {Record<string, (...args: any[]) => unknown>}
 */
function buildAnswers(faults, constant) {
  /** @type {WeakMap<object, unknown>} */
  const types = new WeakMap();
  const failing = faults.fail === "vertex" || faults.fail === "fragment" ? constant(FAILING_SHADER[faults.fail]) : null;
  return {
    createShader: (type) => {
      const shader = {};
      types.set(shader, type);
      return shader;
    },
    getShaderParameter: (shader) => failing === null || types.get(shader) !== failing,
    getProgramParameter: () => faults.fail !== "link",
    getUniformLocation: (program, name) => Object.freeze({ program, name }),
  };
}

/**
 * A WebGL2 context on `canvas` whose drawing buffer is `buffer()` in size: every upper-case name a constant of its
 * own, the buffer bits at their WebGL values, every create call a fresh object, the answers in GL_ANSWERS and
 * buildAnswers, and nothing from every other method. `record`, when given, is handed every call made on the context
 * and every property it is given, as `{ call: name, args }` and `{ set: name, value }`, in order.
 *
 * @param {unknown} canvas
 * @param {() => { width: number, height: number }} buffer
 * @param {(row: { call: string, args: unknown[] } | { set: string, value: unknown }) => void} [record]
 * @param {GlFaults} [faults]
 */
function glContext(canvas, buffer, record = () => {}, faults = {}) {
  /** @type {Map<string, number>} */
  const constants = new Map(Object.entries(GL_BITS));
  const constant = (/** @type {string} */ name) => {
    if (!constants.has(name)) constants.set(name, 0x10000 + constants.size);
    return /** @type {number} */ (constants.get(name));
  };
  const built = buildAnswers(faults, constant);
  return new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key !== "string") return undefined;
        if (key === "canvas") return canvas;
        if (key === "drawingBufferWidth") return buffer().width;
        if (key === "drawingBufferHeight") return buffer().height;
        if (/^[A-Z][A-Z0-9_]*$/.test(key)) return constant(key);
        return (/** @type {unknown[]} */ ...args) => {
          record({ call: key, args: args.map(asCalled) });
          if (key in built) return built[key](...args);
          if (key in GL_ANSWERS) return GL_ANSWERS[key](...args);
          return key.startsWith("create") ? {} : undefined;
        };
      },
      set: (_t, key, value) => {
        record({ set: String(key), value });
        return true;
      },
    },
  );
}

/**
 * `v` as it is now: an array, typed array, data view or array buffer copied, an array's items likewise, and any other
 * value as itself.
 *
 * @param {unknown} v
 * @returns {unknown}
 */
function asCalled(v) {
  if (Array.isArray(v)) return v.map(asCalled);
  if (v instanceof ArrayBuffer) return v.slice(0);
  if (v instanceof DataView) return new DataView(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  if (ArrayBuffer.isView(v)) return /** @type {any} */ (v).slice();
  return v;
}

/** @param {number} w @param {number} h */
const image = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) });

/** @param {unknown} text */
const metrics = (text) => {
  const width = String(text).length * GLYPH_W;
  return {
    width,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: width,
    actualBoundingBoxAscent: 8,
    actualBoundingBoxDescent: 2,
  };
};

/**
 * What a 2d context's methods answer, where the answer is not nothing; `save`, `restore` and the line dash keep
 * `state`, and a gradient or pattern writes its color stops to `rows`.
 *
 * @param {Record<string, unknown>} state
 * @param {LedgerRow[]} rows
 * @returns {Record<string, (...args: any[]) => unknown>}
 */
function answers2d(state, rows) {
  /** @type {Record<string, unknown>[]} */
  const saved = [];
  /** @type {number[]} */
  let dash = [];
  const paint = () => ({
    /** @param {...unknown} args */
    addColorStop: (...args) => void rows.push({ call: "addColorStop", args: args.map(asCalled) }),
  });
  return {
    save: () => void saved.push({ ...state }),
    restore: () => void Object.assign(state, saved.pop() ?? {}),
    setLineDash: (segments) => void (dash = [...segments]),
    getLineDash: () => [...dash],
    measureText: metrics,
    createLinearGradient: paint,
    createRadialGradient: paint,
    createConicGradient: paint,
    createPattern: paint,
    getImageData: (_x, _y, w, h) => image(w, h),
    createImageData: (w, h) => (typeof w === "object" ? image(w.width, w.height) : image(w, h)),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    isPointInPath: () => false,
    isPointInStroke: () => false,
    getContextAttributes: () => ({ alpha: true }),
  };
}

/**
 * A recording 2d context: every call and every property write is a ledger row; the drawing state is kept and read
 * back.
 *
 * @param {any} canvas
 * @param {LedgerRow[]} rows
 */
function context2d(canvas, rows) {
  /** @type {Record<string, unknown>} */
  const state = { ...STATE_2D };
  const answers = answers2d(state, rows);
  return new Proxy(state, {
    get: (_t, key) => {
      if (typeof key !== "string") return undefined;
      if (key === "canvas") return canvas;
      if (key in state) return state[key];
      return (/** @type {unknown[]} */ ...args) => {
        rows.push({ call: key, args: args.map(asCalled) });
        return answers[key]?.(...args);
      };
    },
    set: (_t, key, value) => {
      if (typeof key !== "string") return false;
      rows.push({ set: key, value });
      state[key] = value;
      return true;
    },
  });
}

/**
 * A WebGL2 context that draws nothing, its drawing buffer the canvas's size and every call and property write a row of
 * the canvas's ledger; null where `faults` fails the context.
 *
 * @param {any} canvas
 * @param {LedgerRow[]} rows
 * @param {GlFaults} faults
 */
const contextGl = (canvas, rows, faults) =>
  faults.fail === "context"
    ? null
    : glContext(
        canvas,
        () => canvas,
        (row) => void rows.push(row),
        faults,
      );

/**
 * Gives `canvas` a size and a `getContext` whose contexts write `canvas`'s ledger, kept in `ledgers`; one context per
 * kind, as the browser hands back the same context on every ask.
 *
 * @template T
 * @param {WeakMap<object, LedgerRow[]>} ledgers
 * @param {T & object} canvas
 * @param {number} width
 * @param {number} height
 * @returns {T}
 */
export function asCanvas(ledgers, canvas, width, height) {
  return asFaultyCanvas(ledgers, canvas, { width, height });
}

/**
 * As asCanvas, `size` giving the canvas its width and height, and its WebGL2 context failing where `size.faults` says.
 *
 * @template T
 * @param {WeakMap<object, LedgerRow[]>} ledgers
 * @param {T & object} canvas
 * @param {{ width: number, height: number, faults?: GlFaults }} size
 * @returns {T}
 */
export function asFaultyCanvas(ledgers, canvas, { width, height, faults = {} }) {
  /** @type {LedgerRow[]} */
  const rows = [];
  ledgers.set(canvas, rows);
  /** @type {Map<string, unknown>} */
  const contexts = new Map();
  Object.assign(canvas, {
    width,
    height,
    getContext: (/** @type {string} */ kind) => {
      rows.push({ call: "getContext", args: [kind] });
      if (!contexts.has(kind)) {
        contexts.set(
          kind,
          kind === "2d" ? context2d(canvas, rows) : kind === "webgl2" ? contextGl(canvas, rows, faults) : null,
        );
      }
      return contexts.get(kind);
    },
  });
  return canvas;
}
