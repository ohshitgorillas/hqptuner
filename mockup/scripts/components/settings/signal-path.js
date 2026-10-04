// Signal path (Settings → Signal path): every path HQPlayer can take, one map, drawn in the faceplate's grammar, with the
// path playing now lit. The chain rail shows the running path one stage at a time; this is the whole map behind it.
//   Lit (playing now)   wire and lettering in ink; the rest stays dim (ink-2 lettering, line-2 wire). No accent: this is
//                       running state, not a setting (spec: accent marks what you set and where you are).
//   PCM / SDM tag       runs only in that output mode (the Output drawer's band-tag grammar). `PCM · SDM` = both modes, each
//                       its own list (the 1x / Nx filters).
//   Hatched             on the path but bypassed (gate off, filter none): hatch is for what doesn't run.
//   Rate zones          source rate | output rate, tinted bands; the seam runs through Resampling (it converts).
//   Dashed              position not confirmed by a source (DAC correction, Volume: output rate, before Shaping).
// Sources: manual 6 §2.8 (HF filter: 2x and higher sources), §5 (Speakers at target rate), §7.2 (pipelines at source
// rate), §2.15 (volume before dither); Jussi (Audiophile Style, as Miska): convolution "at the source rate … after
// conversion to PCM" for DSD → PCM; "DAC correction runs at the output rate"; DAC correction needs the matrix enabled.
// State: main.js emits `sigpath` {p, stage} on the bus on every path change; gates are read off the chain rail's lamps on
// every `relayout` (railSet emits one), so the map follows Apply without its own wiring.

import { h, s } from "../../lib/shell/dom.js";
import { hatchDefs } from "../../lib/controls/glyphs.js";
import { classNames } from "../../model/shell/format.js";
import { groupFrame, pathLamps } from "../../model/gauges/wire.js";

const W = 1040,
  H = 606;
const ZONE_Y = 22; // the rate zones' labels
const NW = 118,
  NH = 50;
// Column centres: sources | DSD front end · HF | matrix | resampling | DAC correction ↓ Volume | shaping | Speakers ↓ Output.
const X = [66, 214, 366, 518, 668, 816, 962];

/** Nodes: id → {x, y, label, sub?, tag?, unv?, src?, rail?} (rail: the chain stage whose lamp says engaged). */
const N = {
  p1: { x: X[0], y: 77, label: "PCM source", sub: "1x · ≤ 50 kHz", src: true },
  pn: { x: X[0], y: 187, label: "PCM source", sub: "Nx · > 50 kHz", src: true },
  ds: { x: X[0], y: 385, label: "DSD source", src: true },
  hf: { x: X[1], y: 187, label: "HF filter", rail: "hf" },
  nf: { x: X[1], y: 341, label: "Noise filter", tag: "PCM" },
  de: { x: X[1], y: 429, label: "Decimation", tag: "PCM" },
  rm: { x: X[1], y: 528, label: "Remodulator", tag: "SDM" },
  pl: { x: X[2], y: 132, label: "DSP pipelines", rail: "pipelines" },
  xf: { x: X[2], y: 231, label: "Crossfeed", rail: "crossfeed" },
  ld: { x: X[2], y: 330, label: "Loudness", rail: "loudness" },
  f1: { x: X[3], y: 132, label: "1x filter", sub: "1x sources", tag: "PCM · SDM" },
  fn: { x: X[3], y: 231, label: "Nx filter", sub: "Nx · DSD → PCM", tag: "PCM · SDM" },
  rc: { x: X[3], y: 330, label: "Rate conversion", sub: "DSD → SDM", tag: "SDM" },
  dc: { x: X[4], y: 182, label: "DAC correction", unv: true, rail: "correction" },
  vo: { x: X[4], y: 281, label: "Volume", unv: true },
  di: { x: X[5], y: 231, label: "Dither", tag: "PCM" },
  mo: { x: X[5], y: 330, label: "Modulator", tag: "SDM" },
  sp: { x: X[6], y: 281, label: "Speakers", rail: "speakers" },
  out: { x: X[6], y: 402, label: "Output", src: true },
};

/** Group frames: engraved title over a hairline box. */
const GROUPS = [
  { label: "DSD Processing", ids: ["nf", "de", "rm"] },
  { label: "Matrix engine", ids: ["pl", "xf", "ld"] },
  { label: "Resampling", ids: ["f1", "fn", "rc"] },
  { label: "Shaping", ids: ["di", "mo"] },
];

/** Edges: [from, to, label?]. Vertical ones (inside a group) join bottom → top. */
const E = [
  ["p1", "pl"],
  ["pn", "hf"],
  ["hf", "pl"],
  ["ds", "nf"],
  ["nf", "de", null, "v"],
  ["de", "pl"],
  ["ds", "rm"],
  ["rm", "pl"],
  ["pl", "xf", null, "v"],
  ["xf", "ld", null, "v"],
  ["ld", "f1"],
  ["ld", "fn"],
  ["ld", "rc"],
  ["f1", "dc"],
  ["fn", "dc"],
  ["rc", "dc"],
  ["dc", "vo", null, "v"],
  ["vo", "di"],
  ["vo", "mo"],
  ["di", "sp"],
  ["mo", "sp"],
  ["sp", "out", null, "v"],
];

/** What each path runs (main.js / data/scenarios.js path ids; stage = the source's 1x | nx). */
function litOf(p, stage) {
  const tail = (sh) => ["dc", "vo", sh, "sp", "out"];
  const mx = ["pl", "xf", "ld"];
  const src = stage === "nx" ? ["pn", "hf", "fn"] : ["p1", "f1"];
  switch (p) {
    case "pcm-pcm":
      return [...src, ...mx, ...tail("di")];
    case "pcm-sdm":
      return [...src, ...mx, ...tail("mo")];
    case "dsd-pcm":
      return ["ds", "nf", "de", ...mx, "fn", ...tail("di")];
    case "sdm-sdm":
      return ["ds", "rm", ...mx, "rc", ...tail("mo")];
    case "direct":
      return ["ds", "sp", "out"];
    default:
      return [];
  }
}

export const PATH_NAME = {
  // DRAFT (agent): the Settings rail readout
  idle: "Not playing",
  "pcm-pcm": "PCM → PCM",
  "pcm-sdm": "PCM → SDM",
  "dsd-pcm": "DSD → PCM",
  "sdm-sdm": "DSD → SDM",
  direct: "DSD → Direct SDM",
};

// DRAFT (agent): the drawer's key, one line per mark.
const KEY = [
  ["lit", "Playing now"],
  ["tag", "PCM or SDM: that output mode only"],
  ["tags", "Both output modes, a separate list each"],
  ["hatch", "Bypassed"],
  ["dash", "Position not confirmed (output rate, before Shaping)"],
];

const L = (n) => n.x - NW / 2,
  R = (n) => n.x + NW / 2,
  T = (n) => n.y - NH / 2,
  B = (n) => n.y + NH / 2;
const box = (n) => ({ left: L(n), top: T(n), width: NW, height: NH });

// Bypassed on the path: the matrix gate takes its parts and DAC correction with it (DAC correction needs the matrix).
const MATRIX_PARTS = ["pl", "xf", "ld", "dc"];
const NODES = Object.entries(N).map(([id, n]) => ({ id, rail: n.rail }));
const STAGES = ["matrix", ...NODES.map((n) => n.rail).filter(Boolean)];

/**
 * @param {HTMLElement} host  the drawer block
 * @param {import('../../lib/shell/bus.js').Bus} bus   repaints on `sigpath` (the path playing) and `relayout`
 */
export function mountSignalPath(host, bus) {
  let state = { p: "idle", stage: "1x" };
  const svg = s("svg.sgp", {
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "xMidYMin meet",
    role: "img",
    "aria-label": "Signal path",
  });
  const key = h(
    "div.sgkey",
    {},
    KEY.map(([k, t]) => h("span", {}, h("i", { class: `k-${k}` }), t)),
  );
  host.append(svg, key);

  // Hatch pattern (the rate dial's unavailable stripes).
  svg.append(hatchDefs("sg-hatch", { back: "sghb", line: "sghl" }));
  drawZones(svg);
  drawGroups(svg);
  const edgeEls = drawEdges(svg);
  const nodeEls = drawNodes(svg);

  /** An engaged stage, read off the chain rail (its lamp), so the map follows every Apply. HF filter: on = a filter picked. */
  const engaged = (stage) => !!document.querySelector(`#rail [data-stage="${stage}"] .lamp.on`);

  function paint() {
    const m = pathLamps({
      lit: new Set(litOf(state.p, state.stage)),
      engaged: new Set(STAGES.filter(engaged)),
      nodes: NODES,
      edges: edgeEls,
      matrix: MATRIX_PARTS,
      direct: state.p === "direct",
    });
    for (const [id, g] of Object.entries(nodeEls)) {
      g.classList.toggle("lit", m.nodes[id].lit);
      g.classList.toggle("off", m.nodes[id].off);
    }
    edgeEls.forEach(({ el }, i) => el.classList.toggle("lit", m.edges[i]));
  }

  bus.on("sigpath", (d) => {
    state = d;
    paint();
  });
  bus.on("relayout", paint);
  paint();
}

// Rate zones: everything before Resampling runs at the source rate (DSD: after decimation, 1/16 of it), everything after
// at the output rate. Resampling is the seam: it converts one to the other. Tinted bands under the map, seam dashed.
function drawZones(svg) {
  const seam = N.f1.x;
  svg.append(
    s("rect.sgz.zs", { x: 0, y: 0, width: seam, height: H - 34, rx: 6 }),
    s("rect.sgz.zo", { x: seam, y: 0, width: W - seam, height: H - 34, rx: 6 }),
    s("line.sgseam", { x1: seam, y1: 0, x2: seam, y2: H - 34 }),
    s("text.sgzt", { x: 12, y: ZONE_Y }, "SOURCE RATE"),
    s("text.sgzt", { x: W - 12, y: ZONE_Y, "text-anchor": "end" }, "OUTPUT RATE"),
  );
}

function drawGroups(svg) {
  for (const g of GROUPS) {
    const { frame, title, sub } = groupFrame({ boxes: g.ids.map((id) => box(N[id])), sub: !!g.sub });
    svg.append(
      s("rect.sgg", { ...frame, rx: 5 }),
      s("text.sggt", title, g.label.toUpperCase()),
      g.sub && s("text.sggs", { ...sub, text: g.sub }),
    );
  }
}

function drawEdges(svg) {
  const edgeEls = [];
  // Direct SDM: from the DSD source down under everything, then up into Speakers.
  // Down under everything, along the foot, up the right edge, into Speakers' right side (Output hangs under Speakers).
  const ds = N.ds,
    sp = N.sp,
    yb = H - 18,
    xr = W - 8,
    r = 10;
  const direct = s("path.sge", {
    d: `M ${ds.x} ${B(ds)} V ${yb - r} Q ${ds.x} ${yb} ${ds.x + r} ${yb} H ${xr - r} Q ${xr} ${yb} ${xr} ${yb - r} V ${sp.y + r} Q ${xr} ${sp.y} ${xr - r} ${sp.y} H ${R(sp)}`,
  });
  svg.append(direct, s("text.sgel", { x: (ds.x + xr) / 2, y: yb + 5, "text-anchor": "middle" }, "DIRECT SDM"));
  edgeEls.push({ el: direct, a: "ds", b: "sp", direct: true });

  for (const [a, b, , v] of E) {
    const na = N[a],
      nb = N[b];
    let d;
    if (v) d = `M ${na.x} ${B(na)} V ${T(nb)}`;
    else {
      const x0 = R(na),
        x1 = L(nb),
        mx = (x0 + x1) / 2;
      d = `M ${x0} ${na.y} C ${mx} ${na.y} ${mx} ${nb.y} ${x1} ${nb.y}`;
    }
    const el = s("path.sge", { d });
    svg.append(el);
    edgeEls.push({ el, a, b });
  }
  return edgeEls;
}

function drawNodes(svg) {
  const nodeEls = {};
  for (const [id, n] of Object.entries(N)) {
    const g = s("g.sgn", { class: classNames(n.src && "src", n.unv && "unv") });
    g.append(s("rect", { x: L(n), y: T(n), width: NW, height: NH, rx: n.src ? NH / 2 : 4 }));
    g.append(s("rect.hx", { x: L(n), y: T(n), width: NW, height: NH, rx: 4 }));
    const ty = n.sub ? n.y - 3 : n.y + 6;
    g.append(s("text.sgl", { x: n.x, y: ty, "text-anchor": "middle" }, n.label));
    if (n.sub) g.append(s("text.sgs", { x: n.x, y: n.y + 15, "text-anchor": "middle" }, n.sub));
    if (n.tag) {
      const tw = n.tag.length * 7.6 + 10;
      g.append(
        s("rect.sgtb", { x: R(n) - tw + 6, y: T(n) - 9, width: tw, height: 17, rx: 2 }),
        s("text.sgt", { x: R(n) - tw / 2 + 6, y: T(n) + 4, "text-anchor": "middle" }, n.tag),
      );
    }
    nodeEls[id] = g;
    svg.append(g);
  }
  return nodeEls;
}
