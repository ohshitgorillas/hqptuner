// DSP pipelines drawer: the stage dock under the strip. One shape for every stage, read top to bottom under its chip
// (the chip names the stage, so no title):
//   row 1  what it is   (stage kind, band stepper, filter type, unit) ··· a locked stage's owner link at the right end
//   row 2  its values   (labelled boxes with their units, in wire order)
//   copy   what they mean, full width under the controls it explains

import { h } from "../../../lib/shell/dom.js";
import { xref } from "../../../lib/controls/xref.js";
import { seg } from "../../controls/seg.js";
import { PMAN, IIR_TYPES, ARG_NAME, ARG_UNIT, DELAY_ARGS, DELAY_V, KINDS } from "../../../data/stages/pipelines.js";
import {
  NEW_STAGE,
  delayFields,
  dockState,
  gainSwitch,
  iirFields,
  lockedFields,
  retypeStage,
} from "../../../model/shell/pipelines.js";
import { BLOCK_NAME, paint, stage } from "./state.js";
import { focusStage } from "./strip.js";

const WNAME = { q: "Q", bw: "Bandwidth", s: "Slope" };
const DELAY_NAME = { s: "Samples", t: "Seconds", d: "Meters" };
const tline = (code, text) => h("p.ptl", {}, h("code", { text: code }), " ", text);
const paras = (...xs) => xs.filter(Boolean).map((x) => h("p.pmp", { text: x }));
const lab = (t) => h("span.cl.pdl", { text: t });
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
const numBox = (val, aria, onCommit, width) => {
  const el = h("input.vfd", {
    type: "number",
    value: val ?? "",
    step: "any",
    "aria-label": aria,
    style: width && `width:${width}px`,
  });
  el.addEventListener("change", () => onCommit(Number(el.value)));
  return el;
};

/** Paint the dock for the selected pipeline's selected chip (hidden without one, or while its strip is raw). */
export function paintDock(t) {
  const { dr } = t;
  const p = dr.pipes[t.selPipe];
  const ds = dockState(p, !!p && dr.raw.has(p), t.selChip, t.selBand);
  t.dock.hidden = !ds.shown;
  if (t.dock.hidden) return;
  t.selChip = ds.chip;
  t.selBand = ds.band;
  const after = () => {
    stage(dr, t.ctx);
    paint(dr);
  };
  const d = ds.locked ? lockedDock(t, p, ds.group) : editDock(t, p, ds, after); // {what, right, values, copy}
  // Every single stage leads with its kind, so a wrong pick from `+` is one change away.
  if (ds.picker) d.what = [lab("Stage"), kindPicker(t, p, ds.group.idx[0], after), d.what];
  const what = [d.what].flat(3).filter(Boolean);
  t.dock.replaceChildren(
    ...[
      (what.length || d.right) && h("div.pdr", {}, what, h("span.grow"), d.right),
      d.values?.length && h("div.pfields", {}, d.values),
      h("div.pdcopy", {}, d.copy.flat().filter(Boolean)),
    ].filter(Boolean),
  );
}

function editDock(t, p, ds, after) {
  const right = null; // removal lives on the pill's ×
  const st = p.stages[ds.si];
  switch (ds.group.kind) {
    case "gain":
      return gainDock(p, after);
    case "peq":
    case "iir": {
      const e = iirEditor(st, after);
      return {
        what: [ds.group.kind === "peq" && bandNav(t, p, ds, after), lab("Type"), e.type],
        right,
        values: e.values,
        copy: e.copy,
      };
    }
    case "delay": {
      const e = delayEditor(st, after);
      return { what: [lab("Given in"), e.unit], right, values: e.values, copy: [...e.copy, ...paras(PMAN.delay)] };
    }
    case "riaa":
      return {
        right,
        values: [
          h(
            "div.pfield",
            {},
            lab("Subsonic filter"),
            seg({
              aria: "subsonic",
              cls: "mini2",
              value: String(st.subsonic ?? 1),
              options: [
                { v: "0", label: "Off" },
                { v: "1", label: "On" },
              ],
              onChange: (v) => {
                st.subsonic = +v;
                after();
              },
            }),
          ),
        ],
        copy: paras(PMAN.riaa),
      };
  }
  const isTxt = /\.txt$/i.test(st.file || "");
  return {
    right,
    values: [
      h(
        "div.pfield",
        {},
        lab("File"),
        h("span.vfd.pfile", { text: st.file || "—" }),
        h("button.btn.xs", { type: "button", text: "Upload…" }),
      ),
    ],
    copy: paras(isTxt ? PMAN.peqFile : PMAN.conv),
  };
}

function gainDock(p, after) {
  const unit = seg({
    aria: "Gain unit",
    cls: "enum mini2",
    value: p.unit,
    options: [
      { v: "dB", label: "dB" },
      { v: "Lin", label: "Lin" },
    ],
    onChange: (v) => {
      p.unit = v;
      p.gain = gainSwitch(p.gain, v);
      after();
    },
  });
  return {
    values: [
      h(
        "div.pfield",
        {},
        lab("Gain"),
        numBox(
          p.gain,
          "Gain",
          (v) => {
            p.gain = v;
            after();
          },
          92,
        ),
        unit,
      ),
    ],
    copy: paras(PMAN.gain),
  };
}

/** Bands step here or by their dots on the plot; one band's editor at a time. */
function bandNav(t, p, ds, after) {
  const nb = ds.bands,
    idx = ds.group.idx,
    si = ds.si;
  const step = (k) => {
    t.selBand = (t.selBand + k + nb) % nb;
    paintDock(t);
    t.replot();
  };
  return [
    lab("Band"),
    h(
      "div.pbnav",
      {},
      h("button.round.pbn", {
        type: "button",
        text: "‹",
        "aria-label": "Previous band",
        on: { click: () => step(-1) },
      }),
      h("span.pbl", { text: `${t.selBand + 1} / ${nb}` }),
      h("button.round.pbn", { type: "button", text: "›", "aria-label": "Next band", on: { click: () => step(1) } }),
      !p.gen &&
        h("button.round.pbn", {
          type: "button",
          text: "+",
          "aria-label": "Add a band",
          on: {
            click: () => {
              p.stages.splice(idx[nb - 1] + 1, 0, { kind: "iir", type: "peak", f: 1000, q: 1, g: 0 });
              t.selBand = nb;
              after();
            },
          },
        }),
      !p.gen &&
        h("button.round.pbn", {
          type: "button",
          text: "−",
          "aria-label": `Remove band ${t.selBand + 1}`,
          on: {
            click: () => {
              p.stages.splice(si, 1);
              t.selBand = Math.max(0, t.selBand - 1);
              after();
            },
          },
        }),
    ),
  ];
}

function kindPicker(t, p, si, after) {
  const cur = p.stages[si].kind;
  const opts = [...KINDS, ...(KINDS.some((k) => k.k === cur) ? [] : [{ k: cur, label: "PEQ file" }])];
  const el = h(
    "select.vfd.pkind",
    { "aria-label": "Stage kind" },
    opts.map((k) => h("option", { value: k.k, selected: k.k === cur, text: k.label })),
  );
  el.addEventListener("change", () => {
    p.stages[si] = NEW_STAGE[el.value]();
    focusStage(t, p, si);
    after();
  });
  return el;
}

function lockedDock(t, p, gr) {
  const lf = lockedFields(p, gr, { types: IIR_TYPES, delays: DELAY_ARGS });
  const right = xref(t.dr.toCrossfeed, BLOCK_NAME[p.gen]);
  const ro = (txt) => h("span.vfd.pfile.pro", { text: txt });
  if (lf.kind === "gain")
    return {
      right,
      values: [h("div.pfield", {}, lab("Gain"), ro(lf.value), h("span.u.pu", { text: lf.unit }))],
      copy: paras(PMAN.gain),
    };
  if (lf.kind === "delay") {
    return {
      right,
      values: [h("div.pfield", {}, lab("Delay"), ro(lf.value), h("span.u.pu", { text: lf.unit }))],
      copy: [tline(lf.arg.a, lf.arg.d), ...paras(PMAN.delay)],
    };
  }
  const def = lf.def;
  return {
    what: [lab("Type"), ro(`${def.d}: ${def.t}`)],
    right,
    values: [h("div.pfield", {}, lab("Arguments"), ro(lf.value))],
    copy: [tline(def.t, PMAN.iirUnits)],
  };
}

function iirEditor(st, after) {
  const f = iirFields(st, IIR_TYPES, IIR_TYPES[7]);
  const def = f.def;
  const typeSel = h(
    "select.vfd.ptype",
    { "aria-label": "Filter type" },
    IIR_TYPES.map((x) => h("option", { value: x.t, selected: x.t === st.type, text: `${x.d}: ${x.t}` })),
  );
  typeSel.addEventListener("change", () => {
    const keep = retypeStage(st, typeSel.value, IIR_TYPES);
    for (const k of Object.keys(st)) delete st[k]; // in place: block rows share their ear's EQ objects
    Object.assign(st, keep);
    after();
  });
  const argText =
    def.t === "biquad"
      ? "b0=b0 b1=b1 b2=b2 a0=a0 a1=a1 a2=a2"
      : [
          `${def.args[0]}=${ARG_NAME[def.args[0]]}`,
          def.alt.length ? def.alt.map((a) => `${a}=${ARG_NAME[a]}`).join(" OR ") : null,
          ...def.args.slice(1).map((a) => `${a}=${ARG_NAME[a]}`),
        ]
          .filter(Boolean)
          .join(" ");
  const hint =
    f.hint === "bw"
      ? "Width can be given as a Q or as a Bandwidth: a higher Q is narrower, a higher Bandwidth is wider."
      : f.hint === "s"
        ? "Steepness can be given as a Q or as a Slope: Slope 1 is the steepest it gets without overshoot."
        : null;
  return {
    type: typeSel,
    values: f.args.map((x) => iirField(st, f, x, after)),
    copy: [hint && h("p.phint", { text: hint }), tline(def.t, `${argText}. ${PMAN.iirUnits}`)],
  };
}

/** The width argument: the manual's either/or (q=Q OR bw=bandwidth, q=Q OR s=slope) as "Width [n] as [Q | Bandwidth]". */
function iirField(st, f, { arg: a, value, switchable }, after) {
  const { def, alt: altCur } = f;
  const box = numBox(
    value,
    ARG_NAME[a] || a,
    (v) => {
      st[a] = v;
      after();
    },
    def.t === "biquad" ? 60 : 72,
  );
  if (switchable) {
    return h(
      "div.pfield",
      {},
      lab(f.hint === "bw" ? "Width" : "Steepness"),
      box,
      lab("as"),
      seg({
        aria: "Set as",
        cls: "enum mini2",
        value: altCur,
        options: def.alt.map((x) => ({ v: x, label: WNAME[x] })),
        onChange: (v) => {
          const val = st[altCur];
          delete st[altCur];
          st[v] = val ?? (v === "s" ? 1 : 0.707);
          after();
        },
      }),
    );
  }
  return h(
    "label.pfield",
    {},
    lab(def.t === "biquad" ? a : a === altCur ? WNAME[a] : cap(ARG_NAME[a] || a)),
    box,
    ARG_UNIT[a] && h("span.u", { text: ARG_UNIT[a] }),
  );
}

function delayEditor(st, after) {
  const { cur, value, speed } = delayFields(st, DELAY_ARGS, DELAY_ARGS[1]);
  const unit = seg({
    aria: "Delay given in",
    cls: "enum mini2",
    value: cur.a,
    options: DELAY_ARGS.map((x) => ({ v: x.a, label: DELAY_NAME[x.a] })),
    onChange: (v) => {
      const val = st[cur.a];
      delete st[cur.a];
      if (cur.a !== "d") delete st.v;
      st[v] = val ?? 0;
      after();
    },
  });
  return {
    unit,
    values: [
      h(
        "label.pfield",
        {},
        lab("Delay"),
        numBox(
          value,
          cur.d,
          (v) => {
            st[cur.a] = v;
            after();
          },
          92,
        ),
        h("span.u", { text: cur.unit }),
      ),
      cur.a === "d" &&
        h(
          "label.pfield",
          {},
          lab("Speed of sound"),
          numBox(
            speed,
            DELAY_V.d,
            (v) => {
              st.v = v;
              after();
            },
            92,
          ),
          h("span.u", { text: "m/s" }),
        ),
    ].filter(Boolean),
    copy: [cur, cur.a === "d" && DELAY_V].filter(Boolean).map((x) => tline(x.a, x.d)),
  };
}
