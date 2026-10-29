// Suite for the page spectrum's aurora painter, hqptuner/static/components/faceplate/page/aurora.js: `auroraPainter`
// builds a painter on a WebGL2 canvas, or none where the canvas cannot run its shaders, and each paint is handed the
// shown spectrum columns, the range, the color suite and the wall seconds since the last paint. The aurora moves the
// same over the same stretch of time whatever the paint rate; a restart, or a paint with no spectrum, starts it afresh
// over a cleared canvas; the color suite, and under Accent the accent in force, change what a paint draws; a paint
// told no time is an error.
//
// The canvas is one of tests/js/support/page/canvas.js, whose WebGL2 context draws nothing itself and keeps every call
// made on it in the canvas's ledger. Each draw is read back from that ledger as a picture of everything the GPU would
// read for it: the program's shader sources, every uniform set on that program, the contents of every texture bound to
// a unit and of every buffer, and the viewport. What the canvas shows is the list of those pictures laid since its
// last clear: a clear leaves only its clear color, a draw with blending off replaces what was there, a draw with
// blending on is laid over it. Two paints draw the same when what the canvas shows after each matches number for
// number, to within float rounding; the drawing calls themselves, their number and their order are never asserted. A
// shader's compile and a program's link succeed unless the case gives the canvas a fault. The cases where a paint is
// told no time paint instead on a canvas element of tests/js/support/page.js's fake page, whose WebGL2 context is the
// page's own.
//
// No global is patched: the painter is handed its canvas and nothing else, so two fresh painters handed the same paints
// must draw the same. Time is counted in whole sixtieths of a second, so two runs at different rates reach the same
// moment exactly.
//
// Where the painter returns no painter at all, every helper says so in its result rather than throwing, so each case
// fails on its assertion. Two showings compare only where each holds a draw: two canvases with nothing drawn on them
// match and say nothing about what a paint draws.
//
// Not reached here: whether a paint allocates per step, and whether a late paint takes more model steps than an
// on-time one, show nowhere on the context.
//
// Run: node --import ./tests/js/support/vendor-resolve.js --test tests/js/components/faceplate-page/aurora-glsl.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { auroraPainter } from "../../../../hqptuner/static/components/faceplate/page/aurora.js";
import { accent, accentHex } from "../../../../hqptuner/static/store/ui/theme.js";
import { fakeClock } from "../../support/clock.js";
import { fakePage } from "../../support/page.js";
import { asFaultyCanvas } from "../../support/page/canvas.js";

/** @typedef {{ paint: (c: ArrayLike<number> | null, r: number, s: string | undefined, o: any) => void, clear: () => void }} Painter */
/** @typedef {{ fail?: "context" | "vertex" | "fragment" | "link" }} Faults */
/** @typedef {[number, number][]} Run  [ticks since the last paint, dBFS] per paint */

//: The canvas, in device pixels.
const W = 64;
const H = 32;
//: The meter loop's column count.
const COLS = 600;
//: A 60 dB plot, and a 120 dB one.
const RANGE = 60;
const WIDE_RANGE = 120;
//: Loud and quiet levels on a 60 dB plot, dBFS.
const LOUD_DB = -12;
const QUIET_DB = -48;
//: The time unit runs are counted in, s.
const TICK_S = 1 / 60;
//: One meter loop step, ticks; a step and a half; three steps.
const STEP = 2;
const SLOW = 3;
const LATE = 6;
//: How far two numbers may differ and still read as the same, relative to the larger.
const TOL = 1e-6;
//: Two color suites the owner offers, and the Accent palette, as the store holds them.
const MONO = "mono";
const INFERNO = "inferno";
const ACCENT = "accent";
//: An accent preset, and two custom accents unlike each other.
const PRESET = "violet";
const FIRST_HEX = "#4f9dde";
const SECOND_HEX = "#c03a9b";

// ── what the canvas shows, read from its ledger ─────────────────────────

/**
 * The numbers `v` carries: a typed array or array as a plain array, a number as itself, anything else as nothing.
 *
 * @param {unknown} v
 * @returns {unknown}
 */
function copyOf(v) {
  if (ArrayBuffer.isView(v)) return Array.from(/** @type {any} */ (v));
  if (Array.isArray(v)) return v.map(copyOf);
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "string" || v == null) return v;
  return "source";
}

/** @typedef {ReturnType<typeof gpu>} Gpu */
/** @typedef {(s: Gpu, ...args: any[]) => unknown} Step */

/** What a fresh context holds: nothing bound, nothing drawn. */
function gpu() {
  return {
    /** @type {any} */ program: null,
    /** @type {Map<object, unknown>} */ sources: new Map(),
    /** @type {Map<object, { shaders: object[], uniforms: Map<string, unknown> }>} */ programs: new Map(),
    /** @type {Map<object, Map<string, unknown>>} */ contents: new Map(),
    /** @type {Map<number, any>} */ units: new Map(),
    unit: 0,
    /** @type {Map<number, any>} */ bound: new Map(),
    /** @type {any[]} */ buffers: [],
    /** @type {Set<number>} */ enabled: new Set(),
    /** @type {unknown[]} */ clearColor: [0, 0, 0, 0],
    /** @type {unknown[]} */ viewport: [0, 0, W, H],
    /** @type {any[]} */ shows: [],
  };
}

/**
 * The shaders and uniforms of the program `p` on `s`.
 *
 * @param {Gpu} s
 * @param {object} p
 */
function programOf(s, p) {
  if (!s.programs.has(p)) s.programs.set(p, { shaders: [], uniforms: new Map() });
  return /** @type {{ shaders: object[], uniforms: Map<string, unknown> }} */ (s.programs.get(p));
}

/**
 * The contents handed the texture or buffer `o` on `s`.
 *
 * @param {Gpu} s
 * @param {object} o
 */
function contentsOf(s, o) {
  if (!s.contents.has(o)) s.contents.set(o, new Map());
  return /** @type {Map<string, unknown>} */ (s.contents.get(o));
}

/**
 * Everything the GPU would read for a draw made now on `s`.
 *
 * @param {Gpu} s
 */
const picture = (s) => {
  const p = s.program ? programOf(s, s.program) : null;
  return {
    sources: p ? p.shaders.map((sh) => s.sources.get(sh) ?? "") : null,
    uniforms: p ? Object.fromEntries(p.uniforms) : null,
    textures: [...s.units.entries()].map(([u, t]) => [u, t ? Object.fromEntries(contentsOf(s, t)) : null]),
    buffers: s.buffers.map((b) => Object.fromEntries(contentsOf(s, b))),
    viewport: [...s.viewport],
  };
};

/**
 * The texture at the active unit of `s`.
 *
 * @param {Gpu} s
 */
const textureAt = (s) => s.units.get(s.unit);

/**
 * What the ledger's calls that build programs and hand textures and buffers their contents do to `s`.
 *
 * @returns {Record<string, Step>}
 */
const dataSteps = () => ({
  shaderSource: (s, sh, src) => s.sources.set(sh, src),
  attachShader: (s, p, sh) => programOf(s, p).shaders.push(sh),
  useProgram: (s, p) => (s.program = p),
  activeTexture: (s, unit) => (s.unit = unit),
  bindTexture: (s, _t, tex) => s.units.set(s.unit, tex),
  texImage2D: (s, ...args) => {
    const t = textureAt(s);
    if (t) s.contents.set(t, new Map([["whole", copyOf(args)]]));
  },
  texSubImage2D: (s, ...args) => {
    const t = textureAt(s);
    if (t) contentsOf(s, t).set(`sub ${args.slice(0, 6).join(" ")}`, copyOf(args.slice(6)));
  },
  texStorage2D: (s, ...args) => {
    const t = textureAt(s);
    if (t) contentsOf(s, t).set("storage", copyOf(args));
  },
  bindBuffer: (s, target, b) => {
    if (b && !s.buffers.includes(b)) s.buffers.push(b);
    s.bound.set(target, b);
  },
  bufferData: (s, target, data) => {
    const b = s.bound.get(target);
    if (b) s.contents.set(b, new Map([["whole", copyOf(data)]]));
  },
  bufferSubData: (s, target, offset, data) => {
    const b = s.bound.get(target);
    if (b) contentsOf(s, b).set(`sub ${offset}`, copyOf(data));
  },
});

/**
 * What the ledger's calls that set what a draw lays down, and draw it, do to `s`, the constants read off `gl`.
 *
 * @param {any} gl
 * @returns {Record<string, Step>}
 */
function frameSteps(gl) {
  /** @type {(s: Gpu) => void} */
  const draw = (s) => {
    if (s.enabled.has(gl.BLEND)) s.shows = [...s.shows, picture(s)];
    else s.shows = [picture(s)];
  };
  return {
    enable: (s, cap) => s.enabled.add(cap),
    disable: (s, cap) => s.enabled.delete(cap),
    clearColor: (s, ...rgba) => (s.clearColor = rgba),
    clear: (s, mask) => {
      if (mask & gl.COLOR_BUFFER_BIT) s.shows = [{ clear: [...s.clearColor] }];
    },
    viewport: (s, ...v) => (s.viewport = v),
    drawArrays: draw,
    drawElements: draw,
    drawArraysInstanced: draw,
    drawElementsInstanced: draw,
  };
}

/**
 * What `canvas` shows after the calls of `rows`, its ledger: a uniform is kept on the program its location names, and
 * a call that lays nothing down changes nothing.
 *
 * @param {any} canvas
 * @param {any[]} rows
 */
function showingOf(canvas, rows) {
  const gl = canvas.getContext("webgl2");
  /** @type {Record<string, Step>} */
  const steps = { ...dataSteps(), ...frameSteps(gl) };
  const s = gpu();
  for (const row of rows) {
    if (!("call" in row)) continue;
    const { call, args } = row;
    if (call.startsWith("uniform")) {
      const loc = args[0];
      if (loc) programOf(s, loc.program).uniforms.set(loc.name, copyOf(args.slice(1)));
    } else steps[call]?.(s, ...args);
  }
  return s.shows;
}

// ── painting ────────────────────────────────────────────────────────────

/**
 * A painter on a fresh W by H canvas of tests/js/support/page/canvas.js failing where `faults` says, null where
 * auroraPainter gives none, and what that canvas shows.
 *
 * @param {Faults} [faults]
 */
function painter(faults) {
  /** @type {WeakMap<object, any[]>} */
  const ledgers = new WeakMap();
  const element = asFaultyCanvas(ledgers, { clientWidth: W, clientHeight: H }, { width: W, height: H, faults });
  const fx = /** @type {Painter | null} */ (auroraPainter(/** @type {any} */ (element)));
  const showing = () => showingOf(element, [...(ledgers.get(element) ?? [])]);
  return { fx, showing };
}

/**
 * Columns with the low half at `low` dBFS and the high half at `high`.
 *
 * @param {number} low
 * @param {number} [high]
 */
const columns = (low, high = low) => new Float32Array(COLS).fill(low).fill(high, COLS / 2);

/** @typedef {{ cols: ArrayLike<number> | null, ticks: number, restart?: boolean, range?: number, suite?: string, before?: () => void }} Paint */

/**
 * What the canvas shows after `paints` on one fresh painter, or "no painter".
 *
 * @param {Paint[]} paints
 * @returns {unknown}
 */
function shows(paints) {
  const { fx, showing } = painter();
  if (!fx) return "no painter";
  for (const p of paints) {
    p.before?.();
    fx.paint(p.cols, p.range ?? RANGE, p.suite ?? ACCENT, { dt: p.ticks * TICK_S, restart: p.restart ?? false });
  }
  return structuredClone(showing());
}

/**
 * Whether `a` and `b` match number for number to within TOL.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function same(a, b) {
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= TOL * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") return sameFields(a, b);
  return a === b;
}

/**
 * Whether the objects `a` and `b` hold the same fields, each the same to within TOL.
 *
 * @param {object} a
 * @param {object} b
 */
function sameFields(a, b) {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return same(ka, kb) && ka.every((k) => same(/** @type {any} */ (a)[k], /** @type {any} */ (b)[k]));
}

/**
 * Whether a showing holds a draw: two showings with nothing drawn on them say nothing about what a paint draws.
 *
 * @param {unknown} shown
 */
const drew = (shown) => Array.isArray(shown) && shown.some((p) => p.sources);

/**
 * [ok, message] for one assert.ok: the two showings match, and a painter drew both.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {[boolean, string]}
 */
const match = (a, b) => [
  drew(a) && drew(b) && same(a, b),
  `expected the two paints to draw the same: ${JSON.stringify(a).slice(0, 200)} vs ${JSON.stringify(b).slice(0, 200)}`,
];

/**
 * [ok, message] for one assert.ok: the two showings differ, and a painter drew both.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {[boolean, string]}
 */
const differ = (a, b) => [
  drew(a) && drew(b) && !same(a, b),
  `expected the two paints to draw differently: ${JSON.stringify(a).slice(0, 200)}`,
];

/**
 * The paints of a run: a restart, then each [ticks, dBFS] of `run`.
 *
 * @param {Run} run
 * @returns {Paint[]}
 */
const paintsOf = (run) => [
  { cols: columns(LOUD_DB, QUIET_DB), ticks: STEP, restart: true },
  ...run.map(([ticks, db]) => ({ cols: columns(db, QUIET_DB), ticks })),
];

/**
 * `n` paints of `ticks` each at `db`.
 *
 * @param {number} n
 * @param {number} ticks
 * @param {number} db
 * @returns {Run}
 */
const repeat = (n, ticks, db) => Array.from({ length: n }, () => /** @type {[number, number]} */ ([ticks, db]));

// ── the aurora moves on time, not on paints ─────────────────────────────

//: 12 ticks loud then 24 quiet, steady at one loop step.
const STEADY = [...repeat(6, STEP, LOUD_DB), ...repeat(12, STEP, QUIET_DB)];
//: The same stretches a step and a half apart.
const SLOWER = [...repeat(4, SLOW, LOUD_DB), ...repeat(8, SLOW, QUIET_DB)];
//: The same stretches with late paints, the rate changing part way through the quiet one.
const LATER = [
  ...repeat(2, LATE, LOUD_DB),
  [STEP, QUIET_DB],
  [STEP, QUIET_DB],
  [LATE, QUIET_DB],
  [LATE, QUIET_DB],
  [4, QUIET_DB],
  [4, QUIET_DB],
];

for (const [name, run] of /** @type {[string, Run][]} */ ([
  ["a_step_and_a_half_apart", SLOWER],
  ["with_late_paints", LATER],
])) {
  test(`test_the_aurora_painted_${name}_draws_what_steady_paints_over_the_same_time_draw`, () => {
    assert.ok(...match(shows(paintsOf(run)), shows(paintsOf(STEADY))));
  });
}

test("test_the_aurora_painted_on_for_longer_draws_otherwise_than_it_did_earlier", () => {
  assert.ok(...differ(shows(paintsOf(STEADY)), shows(paintsOf(STEADY.slice(0, -6)))));
});

// ── what a paint is handed ──────────────────────────────────────────────

test("test_louder_columns_draw_otherwise_than_quieter_ones", () => {
  const loud = [{ cols: columns(LOUD_DB), ticks: STEP, restart: true }];
  const quiet = [{ cols: columns(QUIET_DB), ticks: STEP, restart: true }];
  assert.ok(...differ(shows(loud), shows(quiet)));
});

test("test_the_same_columns_on_a_wider_range_draw_otherwise", () => {
  const narrow = [{ cols: columns(QUIET_DB), ticks: STEP, restart: true }];
  const wide = [{ cols: columns(QUIET_DB), ticks: STEP, restart: true, range: WIDE_RANGE }];
  assert.ok(...differ(shows(narrow), shows(wide)));
});

// ── a restart, and a paint with no spectrum ─────────────────────────────

test("test_a_restart_after_a_run_draws_what_a_fresh_painter_draws_on_a_restart", () => {
  const restart = { cols: columns(QUIET_DB, LOUD_DB), ticks: STEP, restart: true };
  assert.ok(...match(shows([...paintsOf(STEADY), restart]), shows([restart])));
});

for (const [name, none] of /** @type {[string, ArrayLike<number> | null][]} */ ([
  ["null", null],
  ["empty", new Float32Array(0)],
])) {
  test(`test_a_paint_after_a_${name}_spectrum_draws_what_it_draws_after_one_on_a_fresh_painter`, () => {
    const blank = { cols: none, ticks: STEP };
    const next = { cols: columns(QUIET_DB, LOUD_DB), ticks: STEP };
    assert.ok(...match(shows([...paintsOf(STEADY), blank, next]), shows([blank, next])));
  });

  test(`test_a_${name}_spectrum_after_a_run_leaves_the_canvas_as_one_on_a_fresh_painter_does`, () => {
    const blank = { cols: none, ticks: STEP };
    assert.ok(...match(shows([...paintsOf(STEADY), blank]), shows([blank])));
  });
}

// ── color suites and the accent ─────────────────────────────────────────

/**
 * What the canvas shows after a steady run under `suite`, the accent FIRST_HEX until the last paint and `then` for it.
 *
 * @param {string | undefined} suite
 * @param {string} [then]
 */
function under(suite, then = FIRST_HEX) {
  accent.value = PRESET;
  accentHex.value = FIRST_HEX;
  const paints = paintsOf(STEADY).map((p) => ({ ...p, suite }));
  paints[paints.length - 1].before = () => (accentHex.value = then);
  return shows(paints);
}

test("test_a_change_of_suite_changes_what_a_paint_draws", () => {
  assert.ok(...differ(under(INFERNO), under(MONO)));
});

test("test_under_accent_a_change_of_accent_changes_what_the_next_paint_draws", () => {
  assert.ok(...differ(under(ACCENT, SECOND_HEX), under(ACCENT, FIRST_HEX)));
});

test("test_a_paint_given_no_suite_draws_what_one_under_accent_draws", () => {
  assert.ok(...match(under(undefined), under(ACCENT)));
});

// ── no painter ──────────────────────────────────────────────────────────

for (const fail of /** @type {const} */ (["context", "vertex", "fragment", "link"])) {
  test(`test_a_canvas_failing_at_${fail}_gets_no_painter_where_a_working_one_gets_one`, () => {
    assert.deepEqual([painter().fx !== null, painter({ fail }).fx !== null], [true, false]);
  });
}

// ── dt is required ──────────────────────────────────────────────────────

/**
 * A painter on a W by H canvas element of a fresh fake page, whose WebGL2 context is the page's own; null where
 * auroraPainter gives none.
 */
function pagePainter() {
  const page = fakePage({ clock: fakeClock().clock });
  const element = page.doc.createElement("canvas");
  Object.assign(element, { width: W, height: H });
  return /** @type {Painter | null} */ (auroraPainter(element));
}

/**
 * What a paint told `look` does after a steady run on a page canvas: "threw", "painted", or "no painter".
 *
 * @param {unknown} look
 */
function outcome(look) {
  const fx = pagePainter();
  if (!fx) return "no painter";
  for (const p of paintsOf(STEADY))
    fx.paint(p.cols, RANGE, ACCENT, { dt: p.ticks * TICK_S, restart: p.restart ?? false });
  try {
    fx.paint(columns(QUIET_DB), RANGE, ACCENT, look);
    return "painted";
  } catch {
    return "threw";
  }
}

for (const [name, look] of /** @type {[string, unknown][]} */ ([
  ["an_options_bag_with_no_dt", { restart: false }],
  ["an_undefined_dt", { dt: undefined, restart: false }],
  ["no_options_at_all", undefined],
])) {
  test(`test_a_paint_told_${name}_is_an_error`, () => {
    assert.equal(outcome(look), "threw");
  });
}
