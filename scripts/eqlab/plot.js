// The plot job — the visual lane of the rig. Renders the chain's curves as a
// self-contained SVG file so the binding "own eyes on the fit" check has a
// first-class output instead of hand-rolled one-off scripts.
//
// Same math as everything else here: every series comes out of `curveOf`
// (metrics.js -> lib/dsp/chain.js), the target out of target.js — nothing replotted
// from a different model. Writes go to the named file only.

import { stat, writeFile } from "node:fs/promises";
import { resolveChain } from "./chain.js";
import { curveOf, round } from "./metrics.js";

const SERIES = ["response", "target", "residual", "terrain"];
const NEEDS_TARGET = new Set(["target", "residual", "terrain"]);
const CHAIN_DEPENDENT = new Set(["response", "residual"]);

// Fixed categorical slots (validated palette, light surface) — color follows
// the series identity, never its position in `show`. An `against` series
// reuses its base hue and carries a dash instead: same measure, other chain.
const COLORS = { response: "#2a78d6", target: "#eb6834", residual: "#1baf7a", terrain: "#eda100" };

const exists = (path) =>
  stat(path).then(
    () => true,
    () => false,
  );

function checkShow(show, target) {
  for (const name of show) {
    if (!SERIES.includes(name)) throw new Error(`plot: unknown series "${name}" (${SERIES.join(", ")})`);
    if (NEEDS_TARGET.has(name) && !target) {
      throw new Error(`plot: series "${name}" needs a target — declare job.target`);
    }
  }
  if (show.length === 0) throw new Error(`plot: "show" is empty — pick from ${SERIES.join(", ")}`);
}

function seriesDb(name, curve, target) {
  if (name === "response") return curve.db;
  if (name === "target") return target.db;
  if (name === "residual") return curve.db.map((v, i) => v - target.db[i]);
  return target.db.map((v) => -v); // terrain: what a no-op chain leaves
}

/** [{name, db, color, dash}] — base chain's series first, then `against`'s. */
function buildSeries(show, curve, target, againstCurve) {
  const out = show.map((name) => ({ name, db: seriesDb(name, curve, target), color: COLORS[name], dash: false }));
  if (againstCurve) {
    for (const name of show.filter((n) => CHAIN_DEPENDENT.has(n))) {
      out.push({
        name: `${name} (against)`,
        db: seriesDb(name, againstCurve, target),
        color: COLORS[name],
        dash: true,
      });
    }
  }
  return out;
}

function pair(spec, what, lo = -Infinity) {
  const ok = Array.isArray(spec) && spec.length === 2 && spec.every(Number.isFinite) && spec[0] < spec[1];
  if (!ok || spec[0] <= lo) throw new Error(`plot: "${what}" must be [low, high]${lo === 0 ? ", low > 0" : ""}`);
  return spec;
}

// y default: auto from the plotted data, padded, always spanning 0 so the
// zero line — the "nothing left to correct" reference — is never off-frame.
function yDomain(spec, series, idx) {
  if (spec) return pair(spec, "y");
  const vals = series.flatMap((s) => idx.map((i) => s.db[i]));
  const [lo, hi] = [Math.min(0, ...vals), Math.max(0, ...vals)];
  const pad = Math.max(1, 0.08 * (hi - lo));
  return [lo - pad, hi + pad];
}

const F_TICKS = [20, 30, 50, 100, 200, 300, 500, 1000, 2000, 3000, 5000, 10000, 20000];
const fLabel = (f) => (f >= 1000 ? `${f / 1000}k` : `${f}`);

function yTicks([lo, hi]) {
  const step = [0.5, 1, 2, 5, 10, 20, 50].find((s) => (hi - lo) / s <= 10) || 100;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(round(v, 3));
  return out;
}

// ---------------------------------------------------------------------------
// SVG assembly. Geometry is fixed; recessive grid, 2px series strokes, legend
// naming every series in its own ink (identity also carried by the swatch).

const W = 960;
const H = 540;
const M = { l: 58, r: 18, t: 18, b: 42 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;

function scales(range, ydom) {
  const [f0, f1] = range;
  const [y0, y1] = ydom;
  return {
    x: (f) => M.l + (Math.log(f / f0) / Math.log(f1 / f0)) * PW,
    y: (v) => M.t + ((y1 - Math.min(Math.max(v, y0), y1)) / (y1 - y0)) * PH, // clip, never drop
  };
}

function grid(range, ydom, sc) {
  const parts = [];
  for (const f of F_TICKS.filter((t) => t >= range[0] && t <= range[1])) {
    const x = round(sc.x(f), 2);
    parts.push(`<line x1="${x}" y1="${M.t}" x2="${x}" y2="${M.t + PH}" stroke="#e5e4de" stroke-width="1"/>`);
    parts.push(`<text x="${x}" y="${H - 14}" text-anchor="middle" class="lbl">${fLabel(f)}</text>`);
  }
  for (const v of yTicks(ydom)) {
    const y = round(sc.y(v), 2);
    const zero = v === 0;
    const style = zero ? 'class="zero" stroke="#8a887c" stroke-width="1.5"' : 'stroke="#e5e4de" stroke-width="1"';
    parts.push(`<line x1="${M.l}" y1="${y}" x2="${M.l + PW}" y2="${y}" ${style}/>`);
    parts.push(`<text x="${M.l - 8}" y="${round(y + 4, 2)}" text-anchor="end" class="lbl">${v}</text>`);
  }
  return parts;
}

function polyline(s, freqs, idx, sc) {
  const pts = idx.map((i) => `${round(sc.x(freqs[i]), 2)},${round(sc.y(s.db[i]), 2)}`).join(" ");
  const dash = s.dash ? ' stroke-dasharray="6 4"' : "";
  return `<polyline data-series="${s.name}" points="${pts}" fill="none" stroke="${s.color}" stroke-width="2"${dash}/>`;
}

function legend(series) {
  return series.flatMap((s, i) => {
    const y = M.t + 14 + i * 20;
    const dash = s.dash ? ' stroke-dasharray="6 4"' : "";
    return [
      `<line x1="${M.l + 12}" y1="${y - 4}" x2="${M.l + 40}" y2="${y - 4}" stroke="${s.color}" stroke-width="2"${dash}/>`,
      `<text x="${M.l + 48}" y="${y}" class="lbl">${s.name}</text>`,
    ];
  });
}

function svgOf(series, { freqs, idx }, range, ydom) {
  const sc = scales(range, ydom);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    `<style>.lbl{font:12px system-ui,sans-serif;fill:#57544a}</style>`,
    `<rect width="${W}" height="${H}" fill="#fffef9"/>`,
    ...grid(range, ydom, sc),
    ...series.map((s) => polyline(s, freqs, idx, sc)),
    ...legend(series),
    `<text x="${W - M.r}" y="${H - 2}" text-anchor="end" class="lbl">Hz</text>`,
    `<text x="${M.l - 8}" y="${M.t - 4}" text-anchor="end" class="lbl">dB</text>`,
    `</svg>`,
    ``,
  ].join("\n");
}

/**
 * Plot job: {"kind":"plot","path":"out.svg","show":["residual",...],
 * "against":{...chain spec...},"range":[20,20000],"y":[lo,hi],"overwrite":false}.
 * Writes a self-contained SVG; answers {path, series}. `show` defaults to
 * ["residual"]; target/residual/terrain need job.target; `against` adds the
 * second chain's response/residual as dashed twins.
 */
export async function plotJob(spec, ctx) {
  if (!spec.path) throw new Error("plot: needs a path");
  const show = [...new Set(spec.show === undefined ? ["residual"] : spec.show)];
  checkShow(show, ctx.target);
  const range = spec.range === undefined ? [20, 20000] : pair(spec.range, "range", 0);
  const curve = curveOf(ctx.stages, ctx.fs);
  const against = spec.against ? curveOf((await resolveChain(spec.against)).stages, ctx.fs) : null;
  const series = buildSeries(show, curve, ctx.target, against);
  const idx = curve.freqs.flatMap((f, i) => (f >= range[0] && f <= range[1] ? [i] : []));
  if (idx.length === 0) throw new Error(`plot: range [${range[0]}, ${range[1]}] Hz contains no grid point`);
  const svg = svgOf(series, { freqs: curve.freqs, idx }, range, yDomain(spec.y, series, idx));
  if (!spec.overwrite && (await exists(spec.path))) {
    throw new Error(`plot: ${spec.path} exists — pass "overwrite": true to replace it`);
  }
  await writeFile(spec.path, svg, "utf8");
  return { path: spec.path, series: series.map((s) => s.name) };
}
