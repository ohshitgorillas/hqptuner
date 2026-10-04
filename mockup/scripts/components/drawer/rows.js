// A tab's body items: a row, an intro, a bespoke block, or a backend's group of rows.

import { h } from "../../lib/dom.js";
import { xref } from "../../lib/xref.js";
import { secHead, manPara } from "../../lib/controls.js";
import { control } from "./controls.js";
import { setFrom, markDirty, regrayDrawer, groupVisible } from "./state.js";

/** One body item of a tab. */
export function item(D, it) {
  if (it.row) return row(D, it.row);
  // Intro: a lead paragraph over the rows; {to, label} parts are links to other drawers (`Name ›`). A second mount
  // (Profile builder, `prefix`) prints the names plain: its targets are the chain's drawers, under another body.
  if (it.intro)
    return h(
      "p.dintro",
      {},
      it.intro.map((x) => (typeof x === "string" ? x : D.prefix ? x.label : xref(x.to, x.label))),
    );
  if (it.block) return block(D, it.block);
  return group(D, it);
}

/** A {block} item mounts deps.blocks[name](host, ctx); a setting block stages through ctx. */
function block(D, name) {
  const el = h("div.dblock", { data: { block: name } });
  const keep = (id, v) => {
    D.vals[id] = String(v);
    D.blockIds.add(id);
    D.blockEl.set(id, el);
  };
  D.blocks[name](el, {
    init: keep,
    onDiscard: (fn) => D.discards.push(fn), // fn(base): put the block's own state back to these values
    set: (id, v) => {
      keep(id, v);
      markDirty(D, el);
      regrayDrawer(D);
    },
    watch: (fn) => D.watchers.push(fn),
  });
  return el;
}

function group(D, { group: be, rows }) {
  return h(
    "div.begrp",
    { data: { be }, hidden: !groupVisible(D, be) },
    secHead("dsec", D.groupNames[be]),
    rows.map((r) => row(D, r)),
  );
}

/** row.optMan: every option with its manual copy; tapping one selects it (same path as the control). */
function optList(D, r) {
  return (
    r.optMan &&
    h(
      "div.optlist",
      { role: "list", "aria-label": r.label + " options" },
      r.optMan.map((o) =>
        h(
          "button.optrow",
          {
            type: "button",
            role: "listitem",
            data: { v: o.v },
            on: { click: () => setFrom(D, r.control.id, o.v) },
          },
          h("code", { text: o.label ?? o.v }),
          h("span", { text: o.man }),
        ),
      ),
    )
  );
}

/** The option list's painter: the selected option is lit and follows the selection. */
function optPainter(opt) {
  return (v) => {
    if (!opt) return;
    for (const b of opt.children) {
      const cur = b.dataset.v === String(v);
      b.classList.toggle("cur", cur);
      b.setAttribute("aria-current", String(cur));
    }
  };
}

function row(D, r) {
  const opt = optList(D, r);
  const paintOpt = optPainter(opt);
  paintOpt(r.control.value);
  D.rowGray = [];
  const ctlEl = control(D, r.control, r, paintOpt);
  const reason = D.rowGray.length ? h("span.gr", { hidden: true }) : null;
  if (reason) D.grays.push({ ctls: D.rowGray, reason });
  D.rowGray = null;
  const paras = typeof r.man === "string" ? [{ text: r.man }] : r.man;
  const spans = r.control.type === "choice";
  return h(
    "div.drow",
    { class: r.full && "drow-full" },
    rowCtl(r, !spans && ctlEl, reason),
    h("div.man", {}, paras.map(manPara)),
    opt,
    spans && ctlEl,
  );
}

/** The row's control column: label head, the control (unless it spans the row), gray reasons, action, advisory. */
function rowCtl(r, ctlEl, reason) {
  return h(
    "div.ctl",
    {},
    h(
      "div.fh",
      {},
      h("b", { text: r.label }),
      r.sub && h("span.s", { text: r.sub }),
      r.band && h("span.band", { text: r.band.toUpperCase() }),
    ),
    ctlEl,
    reason,
    r.action &&
      h(
        "div.act",
        {},
        h("button.btn.xs", { type: "button", text: r.action.label }),
        h("span.cap", { text: r.action.caption }),
      ),
    r.advisory && h("span.adv", { text: r.advisory }),
  );
}
