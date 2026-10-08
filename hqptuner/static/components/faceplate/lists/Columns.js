// An option list's columns. Simplified is v1's outline in the custom placement (PLACE): each family's header
// (`<Family> family`) and blurb, each variant's head and blurb, then its rows; a variant head folds its rows, and so
// does a dither family's header, the dithers having no variants. A family the placement does not name lands in a
// column of its own after the placed ones. Standard drops the outline for one flat list in the engine's order, down a
// fixed number of columns (STD_COLS), reflowing as narrowing thins it. The marks' key sits under Polyphase sinc, or
// along the foot in Standard.

import { html } from "../../../lib/dom.js";
import { columns, flatColumns, groupTree } from "../../../model/shell/option-list.js";
import { isFolded, toggleFold } from "../../../store/faceplate/lists/folds.js";
import { Legend, Row } from "./Rows.js";

/** @typedef {import("../../../model/shell/option-list.js").Opt} Opt */
/** @typedef {import("../../../model/shell/option-list.js").Placement} Placement */
/** @typedef {import("../../../model/shell/option-list.js").Column} Column */
/** @typedef {Map<string, Map<string, Opt[]>>} Families */
/** @typedef {import("../../../store/faceplate/view.js").ListRequest} ListRequest */
/** @typedef {import("../../../store/faceplate/lists/open.js").ListKind} ListKind */
/** @typedef {import("../../../store/faceplate/lists/options.js").Blurbs} Blurbs */
/** @typedef {{ req: ListRequest, kind: ListKind, std: boolean, blurbs: Blurbs }} Ctx */

/**
 * Custom placement per list kind, columns left to right. Filters: Polyphase sinc split by lineage over two columns, Pure
 * sinc (PCM's Misc under it, then Analog-style under its own `Other` title), then Conventional and Interpolation under
 * the last column's. Modulators: Hybrid over Fixed, then Adaptive over two. Dithers: one column, families stacked. DSD
 * lists name no family, so theirs stack in the one column after the placed ones.
 *
 * @type {Record<ListKind, Placement[]>}
 */
const PLACE = {
  filters: [
    {
      fams: ["Polyphase sinc"],
      split: [
        ["Base", "Extended frequency response", "Extended frequency response v2", "Extreme roll-off and attenuation"],
        ["Gaussian", "Gaussian half-band", "Half-band", "MQA and MP3"],
      ],
    },
    { fams: ["Pure sinc", "Misc"], then: { title: "Other", fams: ["Analog-style"] } },
    { title: "Other", fams: ["Conventional", "Interpolation"] },
  ],
  modulators: [{ fams: ["Hybrid", "Fixed"] }, { fams: ["Adaptive"], split: [["Fifth order"], ["Seventh order"]] }],
  dithers: [{ fams: ["Noise shaping", "Additive", "None"] }],
  dsd: [],
};

/** Standard: columns per list kind. */
const STD_COLS = { filters: 3, modulators: 2, dithers: 1, dsd: 1 };

/**
 * The kind's placement, with a column after it for the families it does not name.
 *
 * @param {ListKind} kind
 * @param {Families} fams
 * @returns {Placement[]}
 */
function placement(kind, fams) {
  const named = new Set(PLACE[kind].flatMap((c) => [...c.fams, ...(c.then?.fams ?? [])]));
  const rest = [...fams.keys()].filter((f) => !named.has(f));
  return rest.length ? [...PLACE[kind], { fams: rest }] : PLACE[kind];
}

/**
 * The rows of a group, each its own row.
 *
 * @param {Ctx} ctx
 * @param {Opt[]} rows
 */
const rowsOf = (ctx, rows) => rows.map((o) => html`<${Row} o=${o} req=${ctx.req} kind=${ctx.kind} std=${ctx.std} />`);

/**
 * A family's header and its blurb; a dither family's header folds it. Names the overlay does not know have none.
 *
 * @param {Ctx} ctx
 * @param {string} f
 * @param {boolean} under  a family under a column title
 */
function famHead(ctx, f, under) {
  if (!f) return null;
  const folds = ctx.kind === "dithers";
  const shut = folds && isFolded(ctx.kind, f, "");
  const blurb = shut ? "" : ctx.blurbs.families[f];
  return html`
    <div class=${under ? "ofam sub" : "ofam"}>
      <div class="ofh">
        ${
          folds
            ? html`<button
              type="button"
              class="ohd ofold"
              data-fam=${f}
              aria-expanded=${String(!shut)}
              onClick=${() => toggleFold(ctx.kind, f, "")}
            >
              ${f} family
            </button>`
            : html`<span class="ohd">${f} family</span>`
        }
        ${under ? null : html`<span class="ln"></span>`}
      </div>
      ${blurb ? html`<div class="oblurb">${blurb}</div>` : null}
    </div>
  `;
}

/**
 * A variant's head, blurb and rows, or a family's rows without a variant; a folded group draws no rows.
 *
 * @param {Ctx} ctx
 * @param {string} f
 * @param {string} v  '' for none
 * @param {Opt[]} rows
 */
function group(ctx, f, v, rows) {
  const shut = (v !== "" || ctx.kind === "dithers") && isFolded(ctx.kind, f, v);
  const blurb = v && !shut ? ctx.blurbs.variants[`${f}|${v}`] : "";
  return html`
    <div class=${v ? "ogrp var" : "ogrp"}>
      ${
        v
          ? html`<button
            type="button"
            class="osub"
            data-var=${v}
            aria-expanded=${String(!shut)}
            onClick=${() => toggleFold(ctx.kind, f, v)}
          >
            ${v}
          </button>`
          : null
      }
      ${blurb ? html`<div class="oblurb">${blurb}</div>` : null} ${shut ? null : rowsOf(ctx, rows)}
    </div>
  `;
}

/**
 * A family's groups, by variant.
 *
 * @param {Families} fams
 * @param {string} f
 * @returns {Map<string, Opt[]>}
 */
const variantsOf = (fams, f) => fams.get(f) ?? new Map();

/**
 * A family's header, then its groups in list order.
 *
 * @param {Ctx} ctx
 * @param {Families} fams
 * @param {string} f
 * @param {boolean} under
 */
const parts = (ctx, fams, f, under) => [
  famHead(ctx, f, under),
  ...[...variantsOf(fams, f)].map(([v, rows]) => group(ctx, f, v, rows)),
];

/**
 * A column title over its families.
 *
 * @param {Ctx} ctx
 * @param {Families} fams
 * @param {string} title
 * @param {string[]} fs
 */
const titled = (ctx, fams, title, fs) => html`
  <div class="ofam ctitle">
    <div class="ofh"><span class="ohd static">${title}</span><span class="ln"></span></div>
  </div>
  ${fs.map((f) => html`<div class="ostack">${parts(ctx, fams, f, true)}</div>`)}
`;

/**
 * A split family: two columns under one header while both halves have rows, else one; the filter marks' key under it.
 *
 * @param {Ctx} ctx
 * @param {Families} fams
 * @param {Extract<Column, { kind: "split" }>} c
 */
function splitCol(ctx, fams, c) {
  const vs = variantsOf(fams, c.fam);
  const [a, b] = c.halves.map((names) => names.map((v) => group(ctx, c.fam, v, vs.get(v) ?? [])));
  const key = ctx.kind === "filters" ? html`<${Legend} />` : null;
  return c.band
    ? html`<div class="oband">
        ${famHead(ctx, c.fam, false)}
        <div class="osubs">
          <div class="ocol">${a}</div>
          <div class="ocol">${b}</div>
        </div>
        ${key}
      </div>`
    : html`<div class="ocol">${famHead(ctx, c.fam, false)} ${a} ${b} ${key}</div>`;
}

/**
 * A column of stacked families, or of titled ones, with its `then` block under them.
 *
 * @param {Ctx} ctx
 * @param {Families} fams
 * @param {Extract<Column, { kind: "stack" }>} c
 */
const stackCol = (ctx, fams, c) => html`
  <div class="ocol">
    ${
      c.title
        ? titled(ctx, fams, c.title, c.fams)
        : c.fams.map((f) => html`<div class="ostack">${parts(ctx, fams, f, false)}</div>`)
    }
    ${c.then ? html`<div class="othen">${titled(ctx, fams, c.then.title, c.then.fams)}</div>` : null}
  </div>
`;

/**
 * The open list's columns: the narrowed options in the option style in force.
 *
 * @param {{ req: ListRequest, kind: ListKind, std: boolean, opts: Opt[], full: Opt[], blurbs: Blurbs }} props
 */
export function Columns({ req, kind, std, opts, full, blurbs }) {
  const ctx = { req, kind, std, blurbs };
  if (std) {
    const order = { total: full.length, cols: STD_COLS[kind], order: full.map((o) => o.v) };
    return html`
      ${flatColumns(opts, order).map((rows) => html`<div class="ocol flat">${rowsOf(ctx, rows)}</div>`)}
      ${kind === "filters" ? html`<${Legend} />` : null}
    `;
  }
  const fams = groupTree(opts);
  return html`${columns(placement(kind, fams), fams).map((c) =>
    c.kind === "split" ? splitCol(ctx, fams, c) : stackCol(ctx, fams, c),
  )}`;
}
