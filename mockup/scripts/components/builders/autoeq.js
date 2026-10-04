// EQ / Correction parts (Profile builder's EQ step): Headphone Auto EQ (find one) and correction files (have one), what the
// stereo pair holds, and a plot. Parts are returned separately; the step lays them out in the drawer row grammar.
//   search  v1 Library.js: search, hits (model | measurement source), `…N more — refine the search`, the picked hit's
//           selection strip (`N band(s) · preamp x dB`, `Clear`, `Load profile`: onto the pair, both ears, preamp as gain)
//   files   `Load AutoEq / REW .txt…` (v1), `Upload convolution filters` (owner), `mirror to stereo pair` (v1)
//   holds   where the pair's EQ came from (amber) + `L 9 bands −3.5 dB  R …`
//   plot    the pair (L amber, R ink-2) and the picked hit dashed (`preview`, v1). A visual check: nothing is heard
//           until Save.

import { h } from "../../lib/shell/dom.js";
import { mountRespPlot } from "../controls/resp-plot.js";
import { pipeH, cplx, toDb } from "../../lib/dsp/xdsp.js";
import { AUTOEQ } from "../../data/stages/pipelines.js";
import { AEQ_COPY } from "../../data/builders/profiles.js";
import { signed } from "../../model/shell/format.js";
import { PEQ_TYPES, hitPipe, hitSummary, peqCount, shownHits } from "../../model/gauges/eq.js";

/** @typedef {import('../../model/gauges/eq.js').Band} Band */
/** @typedef {import('../../model/gauges/eq.js').Hit} Hit */
/** @typedef {import('../controls/resp-plot.js').Trace} Trace */
/** @typedef {import('../../model/shell/pipelines.js').Pipe} Pipe */
/** @typedef {Pipe | null | undefined} Ear  one side of the stereo pair, when it has a pipeline */
/** @typedef {Parameters<typeof pipeH>[0]} DbPipe  what the response reads */
/** @typedef {{ bands?: readonly Band[], pre?: number | null, conv?: string }} EqLoad  an EQ (or a convolution file) to land */
/**
 * The DSP pipelines core the parts land on (drawers/pipelines.js createPipelines): importEq's `mirror` false = the first
 * ear only; ears = the stereo pair's pipelines.
 *
 * @typedef {{ importEq(eq: EqLoad, mirror: boolean): void, ears(): Ear[], rate: number }} EqCore
 */
/**
 * One mount's state, shared by the helpers below.
 *
 * @typedef {object} Aeq
 * @property {EqCore} core
 * @property {() => string} name  where the pair's EQ came from ('' = not landed here)
 * @property {(name: string) => void} land  the EQ came from `name` (stages it)
 * @property {Hit | null} sel  the picked hit (previewing)
 * @property {HTMLInputElement} q  the search box
 * @property {HTMLElement} hits
 * @property {HTMLElement} selLine
 * @property {HTMLElement} holds
 * @property {ReturnType<typeof mountRespPlot>} rp
 */

const HITS = 3;
/** @type {Record<string, string>} */
const TYPE = { PK: "peak", PEQ: "peak", LS: "lshelf", LSC: "lshelf", HS: "hshelf", HSC: "hshelf" };

/**
 * ParametricEQ.txt (AutoEq / REW): `Preamp: -6.4 dB`, `Filter 1: ON PK Fc 105 Hz Gain 5.5 dB Q 0.71`.
 *
 * @param {string} text
 * @returns {{ bands: Band[], pre: number | null }}
 */
function parseEq(text) {
  const pre = text.match(/Preamp:\s*(-?[\d.]+)\s*dB/i);
  /** @type {Band[]} */
  const bands = [];
  for (const m of text.matchAll(
    /Filter\s*\d*:\s*ON\s+(\w+)\s+Fc\s+([\d.]+)\s*Hz\s+Gain\s+(-?[\d.]+)\s*dB(?:\s+Q\s+([\d.]+))?/gi,
  )) {
    const type = TYPE[m[1].toUpperCase()];
    if (type) bands.push([+m[2], +m[3], +(m[4] ?? 0.71), type]);
  }
  return { bands, pre: pre ? +pre[1] : null };
}

/**
 * One side of the pair in the holds line: `L 9 bands −3.5 dB`, plus its convolution file.
 *
 * @param {Ear} p
 * @param {string} k
 * @returns {string}
 */
const side = (p, k) => {
  if (!p) return "";
  const conv = p.stages.find((st) => st.kind === "conv");
  return `${k} ${peqCount(p.stages)} bands${conv ? " + " + /** @type {string} */ (conv.file).split("/").pop() : ""} ${p.unit === "Lin" ? "Lin " + p.gain : signed(+p.gain, 1) + " dB"}`;
};
/**
 * The pipeline holds an EQ or a convolution file.
 *
 * @param {Ear} p
 */
const summary = (p) =>
  p &&
  p.stages.some((st) => (st.kind === "iir" && PEQ_TYPES.has(/** @type {string} */ (st.type))) || st.kind === "conv");
/**
 * The pipeline's response in dB, at f.
 *
 * @param {DbPipe} p
 * @param {number} fs
 * @returns {(f: number) => number}
 */
const db = (p, fs) => (f) => toDb(cplx.mag(pipeH(p, f, fs)));

/**
 * One hit in the list: `pick` toggles it.
 *
 * @param {Hit} x
 * @param {boolean} on
 * @param {() => void} pick
 * @returns {HTMLElement}
 */
const hitRow = (x, on, pick) =>
  h(
    "div.peqhit",
    { role: "option", class: on && "on", aria: { selected: on } },
    h(
      "button.peqpick",
      { type: "button", on: { click: pick } },
      h("span", { text: x.name }),
      h("span.src", { text: x.src }),
    ),
  );

/**
 * The picked hit's selection strip.
 *
 * @param {Hit} x
 * @param {() => void} clear
 * @param {() => void} load
 * @returns {HTMLElement[]}
 */
function selStrip(x, clear, load) {
  const { count, pre } = hitSummary(x);
  return [
    h("span.cap", { text: AEQ_COPY.bands(count, pre) }),
    h("span.grow"),
    h("button.btn.xs", { type: "button", text: AEQ_COPY.clear, on: { click: clear } }),
    h("button.btn.xs.peqload", { type: "button", text: AEQ_COPY.load, on: { click: load } }),
  ];
}

/**
 * The plot's traces: the picked hit dashed, then the pair.
 *
 * @param {Hit | null} sel
 * @param {Ear} l
 * @param {Ear} r
 * @param {number} fs
 * @returns {Trace[]}
 */
const traces = (sel, l, r, fs) => [
  ...(sel ? [{ cls: "ghost", label: AEQ_COPY.preview, fn: db(/** @type {DbPipe} */ (hitPipe(sel)), fs) }] : []),
  ...(l ? [{ label: "L", fn: db(l, fs) }] : []),
  ...(r ? [{ cls: "side", label: "R", fn: db(r, fs) }] : []),
];

/**
 * Land an EQ on the pair: the search clears and the EQ's source is staged.
 *
 * @param {Aeq} A
 * @param {EqLoad} eq
 * @param {boolean} both  onto both ears
 * @param {string} from
 */
function put(A, eq, both, from) {
  A.core.importEq(eq, both);
  A.q.value = "";
  A.sel = null;
  A.land(from);
}

/**
 * The files part: Load AutoEq / REW .txt, Upload convolution filters, mirror to stereo pair.
 *
 * @param {(eq: EqLoad, both: boolean, from: string) => void} land
 * @returns {HTMLElement}
 */
function filesPart(land) {
  const mirror = h("input", { type: "checkbox", checked: true });
  const txt = h("input", { type: "file", accept: ".txt", hidden: true });
  const wav = h("input", { type: "file", accept: ".wav", hidden: true });
  txt.addEventListener("change", () => {
    const f = /** @type {FileList} */ (txt.files)[0];
    if (f)
      f.text().then((t) => {
        const eq = parseEq(t);
        if (eq.bands.length) land({ bands: eq.bands, pre: eq.pre ?? 0 }, mirror.checked, f.name);
      });
    txt.value = ""; // the same file re-fires (v1)
  });
  wav.addEventListener("change", () => {
    const f = /** @type {FileList} */ (wav.files)[0];
    if (f) land({ conv: f.name }, mirror.checked, f.name);
    wav.value = "";
  });
  return h(
    "div.peqfiles",
    {},
    h(
      "div.peqf",
      {},
      h("button.btn.xs", { type: "button", text: AEQ_COPY.file, on: { click: () => txt.click() } }),
      txt,
      h("button.btn.xs", { type: "button", text: AEQ_COPY.conv, on: { click: () => wav.click() } }),
      wav,
    ),
    h("label.chk", {}, mirror, AUTOEQ.mirror),
  );
}

/**
 * Paint the hits, the picked hit's strip, what the pair holds and the plot.
 *
 * @param {Aeq} A
 */
function paint(A) {
  const { shown, more } = shownHits(/** @type {readonly Hit[]} */ (AUTOEQ.hits), A.q.value, HITS); // hits only while searching
  A.hits.hidden = !shown.length;
  A.hits.replaceChildren(
    ...shown.map((x) =>
      hitRow(x, A.sel === x, () => {
        A.sel = A.sel === x ? null : x;
        paint(A);
      }),
    ),
    ...(more ? [h("div.peqmore", { text: AEQ_COPY.more(more) })] : []),
  );
  const sel = A.sel;
  A.selLine.hidden = !sel;
  A.selLine.replaceChildren(
    ...(sel
      ? selStrip(
          sel,
          () => {
            A.sel = null;
            paint(A);
          },
          () => {
            const x = /** @type {Hit} */ (A.sel); // the hit picked when Load is tapped
            put(A, { bands: x.bands, pre: x.pre }, true, `${x.name} · ${x.src}`);
          },
        )
      : []),
  );
  const [l, r] = A.core.ears();
  A.holds.replaceChildren(
    h("b", { text: A.name() || (summary(l) ? "" : "None") }),
    h("span", { text: [side(l, "L"), side(r, "R")].filter(Boolean).join("   ") }),
  );
  A.rp.draw(traces(A.sel, l, r, A.core.rate));
}

/**
 * Mount the EQ step's parts.
 *
 * @param {{ core: EqCore, name: () => string, land: (name: string) => void }} o
 *   core = createPipelines api (importEq, ears, rate); land(name) = the EQ came from `name` (stages it)
 */
export function mountAutoEq({ core, name, land }) {
  const q = h("input.vfd.pq.peqq", {
    type: "search",
    placeholder: AUTOEQ.placeholder,
    "aria-label": "Search headphone model",
  });
  q.addEventListener("input", () => {
    A.sel = null;
    paint(A);
  });
  const hits = h("div.peqhits", { role: "listbox", "aria-label": "AutoEq profiles" });
  const selLine = h("div.peqsel");
  const search = h(
    "div.peqsearch",
    {},
    q,
    h(
      "div.aeqcred",
      {},
      AEQ_COPY.credit + " ",
      h("a", { href: "https://github.com/jaakkopasanen/AutoEq", target: "_blank", rel: "noreferrer", text: "AutoEq" }),
      " (MIT)",
    ),
    hits,
    selLine,
  );
  const files = filesPart((eq, both, from) => put(A, eq, both, from));
  const holds = h("div.peqhold");
  const plot = h("div.eq.peqplot");
  const rp = mountRespPlot(plot, { lo: -21, hi: 9, step: 6, minor: 3, aria: "EQ response" });
  /** @type {Aeq} */
  const A = { core, name, land, sel: null, q, hits, selLine, holds, rp };

  return {
    search,
    files,
    holds,
    plot,
    paint: () => paint(A),
    reset: () => {
      q.value = "";
      A.sel = null;
      paint(A);
    },
    /** The pair's EQ in one line: where it came from, else its band count, else None (rail / overview). */
    answer: () =>
      name() ||
      (() => {
        const l = core.ears()[0];
        const n = l ? peqCount(l.stages) : 0;
        return n ? `${n} bands` : "None";
      })(),
  };
}
