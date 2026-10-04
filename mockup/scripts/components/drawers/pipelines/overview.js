// DSP pipelines drawer, Overview tab: the pin grid (inputs down the side, outputs across the top, one pin per
// crosspoint), the totals beside it, Import EQ, Upload convolution filters and the manual's paragraphs.

import { h } from "../../../lib/shell/dom.js";
import { chShort, chName, PMAN } from "../../../data/stages/pipelines.js";
import { classNames } from "../../../model/shell/format.js";
import { MAXP, overviewSummary, pinState, range } from "../../../model/shell/pipelines.js";
import { grayed, paint, stage, watch } from "./state.js";
import { openImport } from "./popovers.js";

/** @typedef {import('./state.js').Drawer} Drawer */
/** @typedef {import('./state.js').Ctx} Ctx */
/** @typedef {import('./state.js').OutView} OutView */

/**
 * The Overview as it repaints: the drawer, its ctx, the grid and totals hosts, its body and its gray reason.
 *
 * @typedef {{ dr: Drawer, ctx: Ctx, gridHost: HTMLElement, totals: HTMLElement, body: HTMLElement, reason: HTMLElement }} Ov
 */

/**
 * Mount the Overview into `host` and register it for repaints.
 *
 * @param {Drawer} dr
 * @param {HTMLElement} host
 * @param {Ctx} ctx
 */
export function overview(dr, host, ctx) {
  watch(dr, ctx);
  const gridHost = h("div.ogrid");
  const totals = h("div.ptot");
  const impBtn = h("button.btn.xs", { type: "button", text: "Import EQ…" });
  impBtn.addEventListener("click", () => openImport(dr, impBtn, () => dr.ear[0] || dr.ear[1], ctx));
  const files = /** @type {HTMLInputElement} */ (
    h("input", { type: "file", accept: ".wav", multiple: true, hidden: true })
  );
  const upBtn = h("button.btn.xs", {
    type: "button",
    text: "Upload convolution filters",
    on: { click: () => files.click() },
  });
  const fileList = h("div.ofiles");
  files.addEventListener("change", () =>
    fileList.replaceChildren(
      ...[.../** @type {FileList} */ (files.files)].map((f) => h("span.vfd.pfile", { text: f.name })),
    ),
  );
  const reason = h("span.gr", { hidden: true });
  const body = h(
    "div.obody",
    {},
    h("div.oleft", {}, h("div.fh", {}, h("b", { text: "Routing" })), gridHost),
    h(
      "div.oright",
      {},
      totals,
      reason,
      h("div.oacts", {}, impBtn, upBtn, files),
      fileList,
      h("div.man", {}, h("p", { text: PMAN.pipelines }), h("p", { text: PMAN.conv })),
    ),
  );
  host.append(body);
  const ov = { dr, ctx, gridHost, totals, body, reason };
  dr.views.push({ paint: () => paintOv(ov) });
  paintOv(ov);
}

/**
 * One pin: tap a lit one → that output's tab on that input; tap an empty one → a new pipeline there, same tab.
 *
 * @param {Ov} ov
 * @param {number} src
 * @param {number} mix
 * @param {number} size  px
 */
function pin(ov, src, mix, size) {
  const { dr, ctx } = ov;
  const { on, n, gen, neg, label, fill } = pinState(dr.pipes, src, mix);
  return h(
    "button.pin.opin",
    {
      type: "button",
      class: classNames(on && "on", gen && "gen"),
      style: `width:${size}px;height:${size}px`,
      "aria-label": `${chName(src)} to ${chName(mix)}${on ? `, ${n} pipeline${n > 1 ? "s" : ""}` : ", empty"}`,
      on: {
        click: () => {
          if (!on) {
            dr.pipes.push({ src, mix, gain: 0, unit: "dB", stages: [] });
            stage(dr, ctx);
          }
          const tab = /** @type {OutView | undefined} */ (dr.views.find((v) => v.out === mix));
          tab?.focus(src, on ? null : dr.pipes.length - 1);
          paint(dr);
          dr.goTab(`out${mix}`);
        },
      },
    },
    h("span.dot"),
    on && h("span.pg", { text: label }),
    gen && h("span.pgn", { text: "Crossfeed" }),
    neg && h("span.pol", { text: "ø" }),
    n > 1 && h("span.pfill", { style: `width:${fill}%` }),
  );
}

/**
 * Paint the Overview: the grid at its cell size, the totals, the gray.
 *
 * @param {Ov} ov
 */
function paintOv(ov) {
  const { dr, gridHost, totals } = ov;
  const { nIn, nOut, pipes } = dr;
  const { cell, over } = overviewSummary(nIn, nOut, pipes.length);
  gridHost.style.gridTemplateColumns = `48px repeat(${nOut}, ${cell}px)`;
  gridHost.replaceChildren(
    ...[
      h("span.pcorner", {}, h("span", { text: "Out" }), h("span", { text: "In" })),
      range(nOut).map((o) =>
        h("button.pch.out.otab", {
          type: "button",
          title: chName(o),
          text: chShort(o),
          on: { click: () => dr.goTab(`out${o}`) },
        }),
      ),
      range(nIn).map((i) => [
        h("span.pch.in", { title: chName(i), text: chShort(i) }),
        range(nOut).map((o) => pin(ov, i, o, cell)),
      ]),
    ].flat(3),
  );
  totals.replaceChildren(
    `${nIn} in · `,
    h("span", {
      class: over && "over",
      text: over ? `${pipes.length} / ${MAXP} pipelines` : `${pipes.length} pipelines`,
    }),
    ` · ${nOut} out`,
  );
  grayed(dr, ov.body, ov.reason);
}
