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

const HITS = 3;
const TYPE = { PK: "peak", PEQ: "peak", LS: "lshelf", LSC: "lshelf", HS: "hshelf", HSC: "hshelf" };

/** ParametricEQ.txt (AutoEq / REW): `Preamp: -6.4 dB`, `Filter 1: ON PK Fc 105 Hz Gain 5.5 dB Q 0.71`. */
function parseEq(text) {
  const pre = text.match(/Preamp:\s*(-?[\d.]+)\s*dB/i);
  const bands = [];
  for (const m of text.matchAll(
    /Filter\s*\d*:\s*ON\s+(\w+)\s+Fc\s+([\d.]+)\s*Hz\s+Gain\s+(-?[\d.]+)\s*dB(?:\s+Q\s+([\d.]+))?/gi,
  )) {
    const type = TYPE[m[1].toUpperCase()];
    if (type) bands.push([+m[2], +m[3], +(m[4] ?? 0.71), type]);
  }
  return { bands, pre: pre ? +pre[1] : null };
}

/** One side of the pair in the holds line: `L 9 bands −3.5 dB`, plus its convolution file. */
const side = (p, k) => {
  if (!p) return "";
  const conv = p.stages.find((st) => st.kind === "conv");
  return `${k} ${peqCount(p.stages)} bands${conv ? " + " + conv.file.split("/").pop() : ""} ${p.unit === "Lin" ? "Lin " + p.gain : signed(+p.gain, 1) + " dB"}`;
};
const summary = (p) => p && p.stages.some((st) => (st.kind === "iir" && PEQ_TYPES.has(st.type)) || st.kind === "conv");
const db = (p, fs) => (f) => toDb(cplx.mag(pipeH(p, f, fs)));

/** One hit in the list: `pick` toggles it. */
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

/** The picked hit's selection strip. */
function selStrip(x, clear, load) {
  const { count, pre } = hitSummary(x);
  return [
    h("span.cap", { text: AEQ_COPY.bands(count, pre) }),
    h("span.grow"),
    h("button.btn.xs", { type: "button", text: AEQ_COPY.clear, on: { click: clear } }),
    h("button.btn.xs.peqload", { type: "button", text: AEQ_COPY.load, on: { click: load } }),
  ];
}

/** The plot's traces: the picked hit dashed, then the pair. */
const traces = (sel, l, r, fs) => [
  ...(sel ? [{ cls: "ghost", label: AEQ_COPY.preview, fn: db(hitPipe(sel), fs) }] : []),
  ...(l ? [{ label: "L", fn: db(l, fs) }] : []),
  ...(r ? [{ cls: "side", label: "R", fn: db(r, fs) }] : []),
];

/**
 * @param {{core: object, name: () => string, land: (name: string) => void}} o
 *   core = createPipelines api (importEq, ears, rate); land(name) = the EQ came from `name` (stages it)
 */
export function mountAutoEq({ core, name, land }) {
  let sel = null; // the picked hit (previewing)
  const q = h("input.vfd.pq.peqq", {
    type: "search",
    placeholder: AUTOEQ.placeholder,
    "aria-label": "Search headphone model",
  });
  q.addEventListener("input", () => {
    sel = null;
    paint();
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

  const mirror = h("input", { type: "checkbox", checked: true });
  const txt = h("input", { type: "file", accept: ".txt", hidden: true });
  const wav = h("input", { type: "file", accept: ".wav", hidden: true });
  txt.addEventListener("change", () => {
    const f = txt.files[0];
    if (f)
      f.text().then((t) => {
        const eq = parseEq(t);
        if (eq.bands.length) put({ bands: eq.bands, pre: eq.pre ?? 0 }, mirror.checked, f.name);
      });
    txt.value = ""; // the same file re-fires (v1)
  });
  wav.addEventListener("change", () => {
    const f = wav.files[0];
    if (f) put({ conv: f.name }, mirror.checked, f.name);
    wav.value = "";
  });
  const files = h(
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

  const holds = h("div.peqhold");
  const plot = h("div.eq.peqplot");
  const rp = mountRespPlot(plot, { lo: -21, hi: 9, step: 6, minor: 3, aria: "EQ response" });

  function put(eq, both, from) {
    core.importEq(eq, both);
    q.value = "";
    sel = null;
    land(from);
  }

  function paint() {
    const { shown, more } = shownHits(AUTOEQ.hits, q.value, HITS); // hits only while searching
    hits.hidden = !shown.length;
    hits.replaceChildren(
      ...shown.map((x) =>
        hitRow(x, sel === x, () => {
          sel = sel === x ? null : x;
          paint();
        }),
      ),
      ...(more ? [h("div.peqmore", { text: AEQ_COPY.more(more) })] : []),
    );
    selLine.hidden = !sel;
    selLine.replaceChildren(
      ...(sel
        ? selStrip(
            sel,
            () => {
              sel = null;
              paint();
            },
            () => put({ bands: sel.bands, pre: sel.pre }, true, `${sel.name} · ${sel.src}`),
          )
        : []),
    );
    const [l, r] = core.ears();
    holds.replaceChildren(
      h("b", { text: name() || (summary(l) ? "" : "None") }),
      h("span", { text: [side(l, "L"), side(r, "R")].filter(Boolean).join("   ") }),
    );
    rp.draw(traces(sel, l, r, core.rate));
  }
  return {
    search,
    files,
    holds,
    plot,
    paint,
    reset: () => {
      q.value = "";
      sel = null;
      paint();
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
