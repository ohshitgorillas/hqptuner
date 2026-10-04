// DSP pipelines drawer: the selected pipeline's strip. One chip per stage group (`+` adds a stage), the gain last,
// `Raw` for the process string, `×` to remove the pipeline; every removable chip carries its own ×.

import { h } from "../../../lib/shell/dom.js";
import { processSpec, parseProcess } from "../../../lib/dsp/procspec.js";
import { KINDS } from "../../../data/stages/pipelines.js";
import { classNames } from "../../../model/shell/format.js";
import { NEW_STAGE, chipText, groups, stageAt } from "../../../model/shell/pipelines.js";
import { paint, stage } from "./state.js";
import { openMenu } from "./popovers.js";

/** Select the chip (and band) a stage sits in. */
export function focusStage(t, p, si) {
  const f = stageAt(groups(p), si);
  t.selChip = Math.max(0, f.chip);
  t.selBand = f.band;
}

/** Pipeline `p` (#i+1) as its strip. */
export function strip(t, p, i) {
  const { dr } = t;
  const r = dr.raw.get(p);
  const parts = r ? rawParts(t, p, i, r) : chipParts(t, p);
  return h(
    "div.pstrip.ped",
    {},
    h("span.ppn", { text: `#${i + 1}` }),
    parts,
    h("button.btn.xs.praw-t", {
      type: "button",
      text: "Raw",
      "aria-pressed": String(!!r),
      on: {
        click: () => {
          if (r) dr.raw.delete(p);
          else dr.raw.set(p, { text: processSpec(p.stages), error: "" });
          paint(dr);
        },
      },
    }),
    !p.gen &&
      h("button.round.px", {
        type: "button",
        text: "×",
        "aria-label": `Remove pipeline ${i + 1}`,
        on: {
          click: () => {
            dr.pipes.splice(i, 1);
            dr.raw.delete(p);
            for (const k of [0, 1]) if (dr.ear[k] === p) dr.ear[k] = null;
            t.selPipe = -1;
            stage(dr, t.ctx);
            paint(dr);
          },
        },
      }),
  );
}

function rawParts(t, p, i, r) {
  const { dr } = t;
  const input = h("input.vfd.praw", {
    type: "text",
    value: r.text,
    spellcheck: "false",
    readonly: !!p.gen,
    "aria-label": `Pipeline ${i + 1} process string`,
  });
  input.addEventListener("change", () => {
    const res = parseProcess(input.value);
    r.text = input.value;
    r.error = res.error;
    if (res.stages) {
      p.stages = res.stages;
      t.selChip = 0;
      t.selBand = 0;
      stage(dr, t.ctx);
    }
    paint(dr);
  });
  return [input, r.error && h("span.gr.prerr", { text: r.error })];
}

function chipParts(t, p) {
  const { dr } = t;
  const gs = groups(p);
  return [
    h(
      "div.pchips",
      {},
      gs.slice(0, -1).map((gr, gi) => chip(t, p, gr, gi)),
      !p.gen &&
        h("button.chip.add", {
          type: "button",
          text: "+",
          "aria-label": "Add a stage",
          on: {
            click: (e) =>
              openMenu(
                dr,
                e.currentTarget,
                KINDS.map((k) => [
                  k.label,
                  () => {
                    p.stages.push(NEW_STAGE[k.k]());
                    focusStage(t, p, p.stages.length - 1);
                    stage(dr, t.ctx);
                    paint(dr);
                  },
                ]),
              ),
          },
        }),
      h("span.pwire"),
    ),
    chip(t, p, gs[gs.length - 1], gs.length - 1),
  ];
}

function chip(t, p, gr, gi) {
  const { dr } = t;
  const locked = p.gen && (gr.kind === "gain" || !!p.stages[gr.idx[0]]?.blk);
  const cls = classNames(`k-${gr.kind}`, gi === t.selChip && "sel", locked && "lock");
  const pick = () => {
    t.selChip = gi;
    t.selBand = 0;
    t.repaint();
  };
  if (p.gen || gr.kind === "gain")
    return h("button.chip", { type: "button", class: cls, on: { click: pick } }, chipText(p, gr));
  // Every removable pill carries its own ×: the one place a stage is removed.
  return h(
    "span.chip.chipw",
    { class: cls },
    h("button.chipl", { type: "button", text: chipText(p, gr), on: { click: pick } }),
    h("button.chipx", {
      type: "button",
      text: "×",
      "aria-label": `Remove ${chipText(p, gr)}`,
      on: {
        click: () => {
          p.stages = p.stages.filter((_, k) => !gr.idx.includes(k));
          if (gi < t.selChip) t.selChip--;
          t.selBand = 0;
          dr.raw.delete(p);
          stage(dr, t.ctx);
          paint(dr);
        },
      },
    }),
  );
}
