// A canvas that keeps pixels: its 2D context rasterizes what a painter draws into one coverage value per pixel, 0 clear
// to 1 fully inked, so a suite reads what a canvas shows rather than which calls made it. Color is not kept, only how
// much ink each pixel holds: a fill or stroke lays ink at its style's alpha times `globalAlpha`, composited by
// `globalCompositeOperation`. Pixels are sampled at their centers with no antialiasing; a stroke covers every pixel whose
// center lies within half its line width, at least one pixel wide, of the path. Images are read and written through
// their alpha channel. A context method this canvas does not draw throws, naming itself, so a painter calling one is
// seen rather than read as drawing nothing. No test() and no assert lives here.

/** @typedef {{ width: number, height: number, data: Uint8ClampedArray }} Picture */
/** @typedef {[number, number, number, number, number, number]} Matrix */
/** @typedef {[number, number][]} Subpath */

//: Segments an arc or a curve is drawn as.
const CURVE_SEGMENTS = 24;
//: The most a channel holds.
const FULL = 255;

/**
 * An image of `w` by `h` pixels, every pixel clear.
 *
 * @param {number} w
 * @param {number} h
 * @returns {Picture}
 */
const picture = (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });

/**
 * The alpha a CSS color string carries, 1 where it names none; a gradient or pattern reads as opaque.
 *
 * @param {unknown} style
 * @returns {number}
 */
function styleAlpha(style) {
  if (typeof style !== "string") return 1;
  const s = style.trim().toLowerCase();
  if (s === "transparent") return 0;
  const fn = s.match(/^(?:rgba?|hsla?)\(([^)]*)\)$/);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 4) return 1;
    const a = parts[3];
    return a.endsWith("%") ? Number(a.slice(0, -1)) / 100 : Number(a);
  }
  const hex = s.match(/^#([0-9a-f]+)$/);
  if (hex && hex[1].length === 4) return parseInt(hex[1][3] + hex[1][3], 16) / FULL;
  if (hex && hex[1].length === 8) return parseInt(hex[1].slice(6), 16) / FULL;
  return 1;
}

/**
 * `m` applied to the point `x`, `y`.
 *
 * @param {Matrix} m
 * @param {number} x
 * @param {number} y
 * @returns {[number, number]}
 */
const apply = ([a, b, c, d, e, f], x, y) => [a * x + c * y + e, b * x + d * y + f];

/**
 * The product `m` times `n`: `n` applied first, then `m`.
 *
 * @param {Matrix} m
 * @param {Matrix} n
 * @returns {Matrix}
 */
const times = ([a, b, c, d, e, f], [g, h, i, j, k, l]) => [
  a * g + c * h,
  b * g + d * h,
  a * i + c * j,
  b * i + d * j,
  a * k + c * l + e,
  b * k + d * l + f,
];

/**
 * Whether the point `px`, `py` lies inside `subpaths` under the nonzero rule.
 *
 * @param {Subpath[]} subpaths
 * @param {number} px
 * @param {number} py
 */
function inside(subpaths, px, py) {
  let winding = 0;
  for (const pts of subpaths) {
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      if (y0 <= py && y1 > py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) > 0) winding += 1;
      else if (y0 > py && y1 <= py && (x1 - x0) * (py - y0) - (px - x0) * (y1 - y0) < 0) winding -= 1;
    }
  }
  return winding !== 0;
}

/**
 * How far the point `px`, `py` lies from the segment `a`, `b`.
 *
 * @param {[number, number]} a
 * @param {[number, number]} b
 * @param {number} px
 * @param {number} py
 */
function distance([ax, ay], [bx, by], px, py) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * The ink a pixel holds after `src` is laid on `dst` under the composite operation `op`.
 *
 * @param {string} op
 * @param {number} src
 * @param {number} dst
 * @returns {number}
 */
function composite(op, src, dst) {
  if (op === "source-over") return src + dst * (1 - src);
  if (op === "destination-out") return dst * (1 - src);
  if (op === "destination-in") return dst * src;
  if (op === "lighter") return Math.min(1, src + dst);
  if (op === "copy") return src;
  throw new Error(`raster canvas: no composite operation ${op}`);
}

/**
 * @typedef {object} Raster
 * @property {number} width
 * @property {number} height
 * @property {Float32Array} ink
 * @property {Record<string, unknown>} state
 * @property {Matrix} matrix
 * @property {{ state: Record<string, unknown>, matrix: Matrix }[]} saved
 * @property {Subpath[]} path
 */

/** @typedef {Record<string, (...args: any[]) => unknown>} Methods */

/**
 * The point `x`, `y` under the current transform of `r`.
 *
 * @param {Raster} r
 * @param {number} x
 * @param {number} y
 * @returns {[number, number]}
 */
const point = (r, x, y) => apply(r.matrix, x, y);

/**
 * The last point of the current path of `r`, the origin where it holds none.
 *
 * @param {Raster} r
 * @returns {[number, number]}
 */
const current = (r) => r.path.at(-1)?.at(-1) ?? [0, 0];

/**
 * Extend the last subpath of `r` to `p`, starting one where there is none.
 *
 * @param {Raster} r
 * @param {[number, number]} p
 */
const lineTo = (r, p) => (r.path.length ? r.path[r.path.length - 1].push(p) : r.path.push([p]));

/**
 * The rectangle at `x`, `y` of `w` by `h` under the current transform of `r`.
 *
 * @param {Raster} r
 * @param {number[]} rect
 * @returns {Subpath}
 */
const box = (r, [x, y, w, h]) => [point(r, x, y), point(r, x + w, y), point(r, x + w, y + h), point(r, x, y + h)];

/**
 * The ink a fill or stroke in `style` lays on `r`.
 *
 * @param {Raster} r
 * @param {unknown} style
 */
const inkOf = (r, style) => Number(r.state.globalAlpha) * styleAlpha(style);

/** @param {Raster} r */
const opOf = (r) => String(r.state.globalCompositeOperation);

/**
 * The pixel bounds of `pts` widened by `pad`, clipped to `r`.
 *
 * @param {Raster} r
 * @param {[number, number][]} pts
 * @param {number} pad
 */
function bounds(r, pts, pad) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    x0: Math.max(0, Math.floor(Math.min(...xs) - pad)),
    x1: Math.min(r.width - 1, Math.ceil(Math.max(...xs) + pad)),
    y0: Math.max(0, Math.floor(Math.min(...ys) - pad)),
    y1: Math.min(r.height - 1, Math.ceil(Math.max(...ys) + pad)),
  };
}

/**
 * Lay ink of `paint.alpha` under `paint.op` on every pixel of `r` whose center `covered` holds, inside the bounds of
 * `area.pts` widened by `area.pad`, or over the whole canvas for an operation that clears what it does not cover.
 *
 * @param {Raster} r
 * @param {{ pts: [number, number][], pad: number }} area
 * @param {(px: number, py: number) => boolean} covered
 * @param {{ alpha: number, op: string }} paint
 */
function lay(r, area, covered, paint) {
  const whole = paint.op === "copy" || paint.op === "destination-in";
  const { x0, x1, y0, y1 } = whole
    ? { x0: 0, x1: r.width - 1, y0: 0, y1: r.height - 1 }
    : bounds(r, area.pts, area.pad);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * r.width + x;
      r.ink[i] = composite(paint.op, covered(x + 0.5, y + 0.5) ? paint.alpha : 0, r.ink[i]);
    }
  }
}

/**
 * Where the edges of `subpaths` cross the row `py`, left to right, each with its winding direction.
 *
 * @param {Subpath[]} subpaths
 * @param {number} py
 * @returns {[number, number][]}
 */
function crossings(subpaths, py) {
  /** @type {[number, number][]} */
  const found = [];
  for (const s of subpaths) {
    for (let i = 0; i < s.length; i++) {
      const [x0, y0] = s[i];
      const [x1, y1] = s[(i + 1) % s.length];
      if ((y0 <= py && y1 > py) || (y1 <= py && y0 > py)) {
        found.push([x0 + ((py - y0) * (x1 - x0)) / (y1 - y0), y1 > y0 ? 1 : -1]);
      }
    }
  }
  return found.sort((a, b) => a[0] - b[0]);
}

/**
 * Mark in `covered` the pixels of row `y` of `r` that lie inside `subpaths` under the nonzero rule.
 *
 * @param {Raster} r
 * @param {Uint8Array} covered
 * @param {Subpath[]} subpaths
 * @param {number} y
 */
function coverRow(r, covered, subpaths, y) {
  const row = crossings(subpaths, y + 0.5);
  let winding = 0;
  for (let k = 0; k < row.length - 1; k++) {
    winding += row[k][1];
    if (winding === 0) continue;
    const from = Math.max(0, Math.ceil(row[k][0] - 0.5));
    const to = Math.min(r.width - 1, Math.ceil(row[k + 1][0] - 0.5) - 1);
    for (let x = from; x <= to; x++) covered[y * r.width + x] = 1;
  }
}

/**
 * Whether the pixel of `r` holding a point is marked in `covered`.
 *
 * @param {Raster} r
 * @param {Uint8Array} covered
 * @returns {(x: number, y: number) => boolean}
 */
const marked = (r, covered) => (x, y) => covered[Math.floor(y) * r.width + Math.floor(x)] === 1;

/**
 * Fill `subpaths` on `r` with its fill style.
 *
 * @param {Raster} r
 * @param {Subpath[]} subpaths
 */
function fillPath(r, subpaths) {
  const pts = subpaths.flat();
  if (!pts.length) return;
  const covered = new Uint8Array(r.width * r.height);
  for (let y = 0; y < r.height; y++) coverRow(r, covered, subpaths, y);
  lay(r, { pts, pad: 0 }, marked(r, covered), { alpha: inkOf(r, r.state.fillStyle), op: opOf(r) });
}

/**
 * Mark in `covered` every pixel of `r` whose center lies within `half` of the segment `a`, `b`.
 *
 * @param {Raster} r
 * @param {Uint8Array} covered
 * @param {[number, number][]} segment
 * @param {number} half
 */
function coverSegment(r, covered, [a, b], half) {
  const { x0, x1, y0, y1 } = bounds(r, [a, b], half);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (distance(a, b, x + 0.5, y + 0.5) <= half) covered[y * r.width + x] = 1;
    }
  }
}

/**
 * The segments a stroke of `s` draws; a lone point is a segment of no length.
 *
 * @param {Subpath} s
 * @returns {[number, number][][]}
 */
const segments = (s) => (s.length === 1 ? [[s[0], s[0]]] : s.slice(1).map((p, i) => [s[i], p]));

/**
 * Stroke `subpaths` on `r` with its stroke style.
 *
 * @param {Raster} r
 * @param {Subpath[]} subpaths
 */
function strokePath(r, subpaths) {
  const pts = subpaths.flat();
  if (!pts.length) return;
  const m = r.matrix;
  const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const half = Math.max(1, Number(r.state.lineWidth) * scale) / 2;
  const covered = new Uint8Array(r.width * r.height);
  for (const s of subpaths) {
    for (const segment of segments(s)) coverSegment(r, covered, segment, half);
  }
  lay(r, { pts, pad: half }, marked(r, covered), { alpha: inkOf(r, r.state.strokeStyle), op: opOf(r) });
}

/**
 * The ink of the source pixel nearest `sx`, `sy` of a raster canvas or an image; none outside it.
 *
 * @param {any} src
 * @param {number} sx
 * @param {number} sy
 */
function sample(src, sx, sy) {
  const x = Math.floor(sx);
  const y = Math.floor(sy);
  if (x < 0 || y < 0 || x >= src.width || y >= src.height) return 0;
  const i = y * src.width + x;
  if (src.ink) return src.ink[i];
  if (src.data) return src.data[i * 4 + 3] / FULL;
  throw new Error("raster canvas: drawImage of a source with no pixels");
}

/**
 * The matrix `setTransform` sets from its arguments: a matrix object, six numbers, or none for the identity.
 *
 * @param {any[]} args
 * @returns {Matrix}
 */
function transformOf([a, b, c, d, e, f]) {
  if (typeof a === "object" && a) return [a.a, a.b, a.c, a.d, a.e, a.f];
  if (a === undefined) return [1, 0, 0, 1, 0, 0];
  return [a, b, c, d, e, f];
}

/**
 * The context methods of `r` that keep its state and move its transform.
 *
 * @param {Raster} r
 * @returns {Methods}
 */
const stateMethods = (r) => ({
  save: () => r.saved.push({ state: { ...r.state }, matrix: [...r.matrix] }),
  restore: () => {
    const top = r.saved.pop();
    if (top) ({ state: r.state, matrix: r.matrix } = top);
  },
  translate: (x, y) => (r.matrix = times(r.matrix, [1, 0, 0, 1, x, y])),
  scale: (x, y) => (r.matrix = times(r.matrix, [x, 0, 0, y, 0, 0])),
  rotate: (a) => (r.matrix = times(r.matrix, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0])),
  transform: (...[a, b, c, d, e, f]) => (r.matrix = times(r.matrix, [a, b, c, d, e, f])),
  setTransform: (...args) => (r.matrix = transformOf(args)),
  resetTransform: () => (r.matrix = [1, 0, 0, 1, 0, 0]),
});

/**
 * Lay onto the path of `r` the arc about `cx`, `cy` of radius `radius` from angle `a0` to `a1`, counterclockwise where
 * `ccw` holds.
 *
 * @param {Raster} r
 * @param {any[]} args
 */
function arc(r, [cx, cy, radius, a0, a1, ccw = false]) {
  let sweep = a1 - a0;
  if (!ccw && sweep < 0) sweep = (sweep % (2 * Math.PI)) + 2 * Math.PI;
  if (ccw && sweep > 0) sweep = (sweep % (2 * Math.PI)) - 2 * Math.PI;
  for (let k = 0; k <= CURVE_SEGMENTS; k++) {
    const a = a0 + (sweep * k) / CURVE_SEGMENTS;
    lineTo(r, point(r, cx + radius * Math.cos(a), cy + radius * Math.sin(a)));
  }
}

/**
 * Lay onto the path of `r` the quadratic curve from its current point through the control `cx`, `cy` to `x`, `y`.
 *
 * @param {Raster} r
 * @param {any[]} args
 */
function quadraticCurve(r, [cx, cy, x, y]) {
  const [x0, y0] = current(r);
  const [qx, qy] = point(r, cx, cy);
  const [ex, ey] = point(r, x, y);
  for (let k = 1; k <= CURVE_SEGMENTS; k++) {
    const t = k / CURVE_SEGMENTS;
    const u = 1 - t;
    lineTo(r, [u * u * x0 + 2 * u * t * qx + t * t * ex, u * u * y0 + 2 * u * t * qy + t * t * ey]);
  }
}

/**
 * Lay onto the path of `r` the cubic curve from its current point through the controls `c1x`, `c1y` and `c2x`, `c2y`
 * to `x`, `y`.
 *
 * @param {Raster} r
 * @param {any[]} args
 */
function bezierCurve(r, [c1x, c1y, c2x, c2y, x, y]) {
  const [x0, y0] = current(r);
  const [ax, ay] = point(r, c1x, c1y);
  const [bx, by] = point(r, c2x, c2y);
  const [ex, ey] = point(r, x, y);
  for (let k = 1; k <= CURVE_SEGMENTS; k++) {
    const t = k / CURVE_SEGMENTS;
    const u = 1 - t;
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    lineTo(r, [w[0] * x0 + w[1] * ax + w[2] * bx + w[3] * ex, w[0] * y0 + w[1] * ay + w[2] * by + w[3] * ey]);
  }
}

/**
 * The context methods of `r` that build its path.
 *
 * @param {Raster} r
 * @returns {Methods}
 */
const pathMethods = (r) => ({
  beginPath: () => (r.path = []),
  moveTo: (x, y) => r.path.push([point(r, x, y)]),
  lineTo: (x, y) => lineTo(r, point(r, x, y)),
  closePath: () => {
    const first = r.path.at(-1)?.[0];
    if (first) lineTo(r, first);
  },
  rect: (x, y, w, h) => {
    r.path.push(box(r, [x, y, w, h]));
    r.path.push([point(r, x, y)]);
  },
  arc: (...args) => arc(r, args),
  quadraticCurveTo: (...args) => quadraticCurve(r, args),
  bezierCurveTo: (...args) => bezierCurve(r, args),
});

/**
 * An image of the `w` by `h` pixels of `r` from `sx`, `sy`.
 *
 * @param {Raster} r
 * @param {number[]} rect
 */
function getImage(r, [sx, sy, w, h]) {
  const img = picture(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) img.data[(y * w + x) * 4 + 3] = Math.round(sample(r, sx + x, sy + y) * FULL);
  }
  return img;
}

/**
 * Set the pixel of `r` at `tx`, `ty` to `ink`, where it lies on the canvas.
 *
 * @param {Raster} r
 * @param {number} tx
 * @param {number} ty
 * @param {number} ink
 */
function setPixel(r, tx, ty, ink) {
  if (tx >= 0 && ty >= 0 && tx < r.width && ty < r.height) r.ink[ty * r.width + tx] = ink;
}

/**
 * Write onto `r` at `dx`, `dy` the pixels of `img` in its dirty rectangle `x`, `y`, `w`, `h`, the whole image where
 * none is given.
 *
 * @param {Raster} r
 * @param {Picture} img
 * @param {number[]} args
 */
function putImage(r, img, [dx, dy, x = 0, y = 0, w = img.width, h = img.height]) {
  for (let py = Math.max(0, y); py < Math.min(img.height, y + h); py++) {
    for (let px = Math.max(0, x); px < Math.min(img.width, x + w); px++) {
      setPixel(r, dx + px, dy + py, img.data[(py * img.width + px) * 4 + 3] / FULL);
    }
  }
}

/**
 * Draw `src` onto `r` from the arguments `drawImage` takes after its source: a destination point, a destination
 * rectangle, or a source rectangle and a destination rectangle.
 *
 * @param {Raster} r
 * @param {any} src
 * @param {number[]} a
 */
function drawImage(r, src, a) {
  const [sx, sy, sw, sh, dx, dy, dw, dh] =
    a.length === 8 ? a : [0, 0, src.width, src.height, a[0], a[1], a[2] ?? src.width, a[3] ?? src.height];
  const shape = [box(r, [dx, dy, dw, dh])];
  const [ia, ib, ic, id, ie, iff] = r.matrix;
  const det = ia * id - ib * ic;
  const alpha = Number(r.state.globalAlpha);
  const operation = opOf(r);
  const { x0, x1, y0, y1 } = bounds(r, shape[0], 0);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(shape, x + 0.5, y + 0.5)) continue;
      const ux = (id * (x + 0.5 - ie) - ic * (y + 0.5 - iff)) / det;
      const uy = (-ib * (x + 0.5 - ie) + ia * (y + 0.5 - iff)) / det;
      const s = sample(src, sx + ((ux - dx) * sw) / dw, sy + ((uy - dy) * sh) / dh) * alpha;
      const i = y * r.width + x;
      r.ink[i] = composite(operation, s, r.ink[i]);
    }
  }
}

/**
 * The context methods of `r` that draw, read and write its pixels.
 *
 * @param {Raster} r
 * @returns {Methods}
 */
const drawMethods = (r) => ({
  fill: () => fillPath(r, r.path),
  stroke: () => strokePath(r, r.path),
  fillRect: (...rect) => fillPath(r, [box(r, rect)]),
  strokeRect: (...rect) => strokePath(r, [[...box(r, rect), point(r, rect[0], rect[1])]]),
  clearRect: (...rect) => {
    const shape = [box(r, rect)];
    lay(r, { pts: shape[0], pad: 0 }, (px, py) => inside(shape, px, py), { alpha: 1, op: "destination-out" });
  },
  createLinearGradient: () => ({ addColorStop() {} }),
  createRadialGradient: () => ({ addColorStop() {} }),
  createImageData: (w, h) => (typeof w === "number" ? picture(w, h) : picture(w.width, w.height)),
  getImageData: (...rect) => getImage(r, rect),
  putImageData: (img, ...args) => putImage(r, img, args),
  drawImage: (src, ...a) => drawImage(r, src, a),
  setLineDash: () => {},
  measureText: () => ({ width: 0 }),
});

/**
 * A `width` by `height` canvas whose 2D context keeps one ink value per pixel in `ink`, row by row from the top left.
 *
 * @param {number} width
 * @param {number} height
 */
export function rasterCanvas(width, height) {
  /** @type {Raster} */
  const r = {
    width,
    height,
    ink: new Float32Array(width * height),
    state: { globalAlpha: 1, globalCompositeOperation: "source-over", lineWidth: 1, fillStyle: "#000" },
    matrix: [1, 0, 0, 1, 0, 0],
    saved: [],
    path: [],
  };
  const canvas = { width, height, ink: r.ink, getContext: () => ctx };
  /** @type {Methods} */
  const methods = { ...stateMethods(r), ...pathMethods(r), ...drawMethods(r) };
  const ctx = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === "canvas") return canvas;
        const name = String(key);
        if (name in methods) return methods[name];
        if (name in r.state) return r.state[name];
        return (/** @type {unknown[]} */ ..._args) => {
          throw new Error(`raster canvas: no context method ${name}`);
        };
      },
      set: (_t, key, value) => {
        r.state[String(key)] = value;
        return true;
      },
    },
  );
  return canvas;
}
