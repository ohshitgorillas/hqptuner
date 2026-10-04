// DSP pipelines drawer, one output's tab: the input switch, `+ Pipeline`, that input's pipelines as a fixed page of
// lines with page buttons (a crossfeed block folds to one line), then the selected pipeline's strip, its stage dock and
// the plot.

import { h } from "../../../lib/shell/dom.js";
import { xref } from "../../../lib/controls/xref.js";
import { pageButtons } from "../../../lib/controls/pager.js";
import { seg } from "../../controls/seg.js";
import { mountRespPlot } from "../../controls/resp-plot.js";
import { processSpec } from "../../../lib/dsp/procspec.js";
import { chShort, chName } from "../../../data/stages/pipelines.js";
import { classNames } from "../../../model/shell/format.js";
import { PAGE, chipText, listItems, outputView, pageOf, rowText } from "../../../model/shell/pipelines.js";
import { BLOCK_NAME, at, grayed, paint, stage, watch } from "./state.js";
import { openMenu } from "./popovers.js";
import { strip } from "./strip.js";
import { paintDock } from "./dock.js";
import { plot } from "./plot.js";

/** Mount output `o`'s tab into `host` and register it for repaints and focus from the Overview. */
export function output(dr, o, host, ctx) {
  watch(dr, ctx);
  const t = { dr, o, ctx, src: null, selPipe: -1, page: 0, selChip: 0, selBand: 0, scope: "auto" };
  mountOutput(t, host);
  t.repaint = () => paintOut(t);
  t.replot = () => plot(t);
  dr.views.push({
    out: o,
    focus: (s2, pipe) => focus(t, s2, pipe),
    reset() {
      t.selPipe = -1;
      t.page = 0;
      t.selChip = 0;
    },
    paint: () => paintOut(t),
  });
  paintOut(t);
}

function mountOutput(t, host) {
  const { o } = t;
  t.inHost = h("div.oin");
  t.pager = h("div.opg");
  const addPipe = h("button.btn.xs", { type: "button", text: "+ Pipeline", on: { click: () => addPipeline(t) } });
  t.reason = h("span.gr", { hidden: true });
  t.rows = h("div.plrows.orows", { role: "listbox", "aria-label": `Pipelines into ${chName(o)}` });
  t.editor = h("div.pstrips");
  t.dock = h("div.pdock");
  t.scopeHost = h("div.pscope");
  t.plotHost = h("div.eq.pplot");
  t.body = h(
    "div.oout",
    {},
    h("div.ohead", {}, h("span.cl", { text: "In" }), t.inHost, h("span.grow"), t.reason, addPipe),
    h("div.olist", {}, t.rows, t.pager),
    h("div.pedit", {}, t.editor, t.dock),
    h("div.pplotwrap", {}, t.scopeHost, t.plotHost),
  );
  host.append(t.body);
  t.rp = mountRespPlot(t.plotHost, { lo: -21, hi: 9, step: 6, minor: 3, aria: `Response into ${chName(o)}` });
}

function addPipeline(t) {
  const { dr, o, src } = t;
  if (src === null) return;
  dr.pipes.push({ src, mix: o, gain: 0, unit: "dB", stages: [] });
  t.selPipe = dr.pipes.length - 1;
  t.selChip = 0;
  t.page = Math.floor((listItems(at(dr, src, o), dr.openBlocks).length - 1) / PAGE);
  stage(dr, t.ctx);
  paint(dr);
}

function focus(t, s2, pipe) {
  t.src = s2;
  const here = at(t.dr, s2, t.o);
  t.selPipe = pipe ?? here[0]?.[1] ?? -1;
  t.selChip = 0;
  t.selBand = 0;
  t.page = pageOf(listItems(here, t.dr.openBlocks), t.selPipe);
}

function paintOut(t) {
  const { dr } = t;
  const v = outputView(dr.pipes, dr.nIn, t.o, { src: t.src, selPipe: t.selPipe, page: t.page, open: dr.openBlocks });
  t.src = v.src;
  if (v.reselect) {
    t.selPipe = v.selPipe;
    t.selChip = 0;
  }
  t.inHost.replaceChildren(...inputSwitch(t, v));
  // A fixed page of rows, numbered page buttons.
  t.page = v.paging.page;
  t.rows.replaceChildren(...v.items.slice(v.paging.start, v.paging.end).map((x) => listRow(t, x)));
  t.pager.replaceChildren(
    ...pageButtons({
      n: v.items.length,
      per: PAGE,
      page: t.page,
      count: true,
      go: (k) => {
        t.page = k;
        paintOut(t);
      },
    }),
  );
  // Editor, dock, plot.
  const p = dr.pipes[t.selPipe];
  t.editor.replaceChildren(...(p ? [strip(t, p, t.selPipe)] : []));
  paintDock(t);
  plot(t);
  grayed(dr, t.body, t.reason);
}

/** Input switch: each input feeding this output, with its count; `+` adds one that doesn't yet. */
function inputSwitch(t, v) {
  const { dr, o } = t;
  return [
    v.ins.length
      ? seg({
          aria: "Input",
          cls: "enum oinseg view",
          value: String(t.src),
          options: v.ins.map((i, k) => ({ v: String(i), label: `${chShort(i)} · ${v.counts[k]}` })),
          onChange: (val) => {
            t.src = +val;
            t.selPipe = -1;
            t.page = 0;
            paintOut(t);
          },
        })
      : h("span.cap", { text: "—" }),
    v.others.length > 0 &&
      h("button.chip.add", {
        type: "button",
        text: "+",
        "aria-label": "Add an input",
        on: {
          click: (e) =>
            openMenu(
              dr,
              e.currentTarget,
              v.others.map((i) => [
                `In ${chShort(i)} — ${chName(i)}`,
                () => {
                  dr.pipes.push({ src: i, mix: o, gain: 0, unit: "dB", stages: [] });
                  t.src = i;
                  t.selPipe = dr.pipes.length - 1;
                  t.page = 0;
                  stage(dr, t.ctx);
                  paint(dr);
                },
              ]),
            ),
        },
      }),
  ].filter(Boolean);
}

function listRow(t, x) {
  if (x.fold || x.head) return blockRow(t, x);
  const { dr } = t;
  const p = x.p;
  return h(
    "div.plrow",
    {
      class: classNames(x.i === t.selPipe && "sel", x.inBlock && "inblk"),
      role: "option",
      "aria-selected": String(x.i === t.selPipe),
      on: { click: () => pick(t, x.i) },
    },
    h("span.ppn", { text: `#${x.i + 1}` }),
    h("span.plc", { text: dr.raw.has(p) ? processSpec(p.stages) : rowText(p) }),
    h("span.plg", { text: chipText(p, { kind: "gain", idx: [] }) + (p.unit === "Lin" && p.gain < 0 ? " ø" : "") }),
  );
}

function blockRow(t, x) {
  const { dr } = t;
  const kind = x.fold || x.head,
    open = !x.fold;
  const el = h(
    "div.plrow.plfold",
    { class: !open && dr.pipes[t.selPipe]?.gen === kind && "sel", role: "option" },
    h("button.pltw", {
      type: "button",
      text: open ? "▾" : "▸",
      "aria-expanded": String(open),
      "aria-label": `${open ? "Fold" : "Unfold"} ${BLOCK_NAME[kind]}`,
      on: {
        click: () => {
          if (open) dr.openBlocks.delete(kind);
          else dr.openBlocks.add(kind);
          paint(dr);
        },
      },
    }),
    xref(dr.toCrossfeed, BLOCK_NAME[kind]),
    h("span.pls", { text: `${x.n} rows · ${dr.block.sum || ""}` }),
  );
  el.addEventListener("click", (e) => {
    if (!e.target.closest("button,a")) pick(t, x.first);
  });
  return el;
}

function pick(t, i) {
  t.selPipe = i;
  t.selChip = 0;
  t.selBand = 0;
  paintOut(t);
}
