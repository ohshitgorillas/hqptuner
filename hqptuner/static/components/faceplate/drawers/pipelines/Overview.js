// The DSP pipelines drawer's Overview tab: the pin grid (inputs down the side, outputs across the top, one pin per
// crosspoint, so a column is one output bus), the totals beside it, Import EQ, Upload convolution filters and the
// manual's paragraphs. A lit pin engraves its gain (or `×n` when it holds several), `ø` marks a negative Lin gain, a
// crossfeed block's pins are dashed and named, and a fill along a pin's foot is its share of all pipelines. Tapping a
// lit pin shows that output's tab on that input; tapping an empty one stages a new pipeline there and shows it. The
// whole tab grays, its reason legible, while the matrix engine is bypassed. The decisions are
// store/faceplate/drawers/pipelines.js's and model/shell/pipelines.js's.

import { html } from "../../../../lib/dom.js";
import { classNames } from "../../../../model/shell/format.js";
import { MAXP, range } from "../../../../model/shell/pipelines.js";
import { showTab } from "../../../../store/faceplate/drawer.js";
import { addPipeline, chName, chShort, pipelinesView } from "../../../../store/faceplate/drawers/pipelines.js";
import { PMAN } from "./copy.js";
import { focus, note, uploaded } from "./state.js";
import { uploadFilter } from "./upload.js";
import { ImportEq } from "./Import.js";
import { FileKey } from "./parts.js";
import { withXref } from "../../Xref.js";

/** @typedef {import("../../../../store/faceplate/xref.js").XrefHere} XrefHere */
/** @typedef {import("../../../../store/faceplate/drawer.js").DrawerSchema} DrawerSchema */
/** @typedef {ReturnType<typeof pipelinesView>} View */

/**
 * Tap the pin at (src, mix): an empty one stages a new pipeline there; either way that output's tab shows, on that
 * input, the new pipeline picked.
 *
 * @param {DrawerSchema} schema
 * @param {number} src
 * @param {number} mix
 * @param {boolean} on
 */
function tapPin(schema, src, mix, on) {
  const made = on ? null : addPipeline(src, mix);
  focus(pipelinesView().pipes, mix, src, made);
  showTab(schema.id, `out${mix}`);
}

/**
 * One pin.
 *
 * @param {DrawerSchema} schema
 * @param {View} v
 * @param {number} src
 * @param {number} mix
 */
function pinCell(schema, v, src, mix) {
  const { on, n, gen, neg, label, fill } = v.grid[src][mix];
  const size = v.cell;
  return html`
    <button
      type="button"
      class=${classNames("pin", on && "on", gen && "gen")}
      style=${`width:${size}px;height:${size}px`}
      aria-label=${`${chName(src)} to ${chName(mix)}${on ? `, ${n} pipeline${n > 1 ? "s" : ""}` : ", empty"}`}
      data-src=${String(src)}
      data-mix=${String(mix)}
      disabled=${!!v.gray}
      onClick=${() => tapPin(schema, src, mix, on)}
    >
      <span class="dot"></span>
      ${on ? html`<span class="pg">${label}</span>` : null} ${gen ? html`<span class="pgn">Crossfeed</span>` : null}
      ${neg ? html`<span class="pol">ø</span>` : null}
      ${n > 1 ? html`<span class="pfill" style=${`width:${fill}%`}></span>` : null}
    </button>
  `;
}

/**
 * The grid: the corner, the output heads (each shows its tab), then a row per input of its head and pins.
 *
 * @param {DrawerSchema} schema
 * @param {View} v
 */
function grid(schema, v) {
  return html`
    <div class="ogrid" style=${`grid-template-columns:48px repeat(${v.nOut}, ${v.cell}px)`}>
      <span class="pcorner"><span>Out</span><span>In</span></span>
      ${range(v.nOut).map(
        (o) => html`
          <button
            type="button"
            class="pch otab"
            title=${chName(o)}
            disabled=${!!v.gray}
            onClick=${() => showTab(schema.id, `out${o}`)}
          >
            ${chShort(o)}
          </button>
        `,
      )}
      ${range(v.nIn).map(
        (i) => html`
          <span class="pch in" title=${chName(i)}>${chShort(i)}</span>
          ${range(v.nOut).map((o) => pinCell(schema, v, i, o))}
        `,
      )}
    </div>
  `;
}

/**
 * Upload each file picked, listing the ones the daemon stored.
 *
 * @param {File[]} files
 */
async function onFiles(files) {
  for (const f of files) {
    const r = await uploadFilter(f);
    note.value = r.note;
    if (r.path) uploaded.value = [...uploaded.value, r.path];
  }
}

/**
 * The Overview tab.
 *
 * @param {{ schema: DrawerSchema, here: XrefHere }} props  here: where it is drawn
 */
export function PipelinesOverview({ schema, here }) {
  const v = pipelinesView();
  const off = !!v.gray;
  const dim = off ? "grayed" : undefined;
  const count = v.pipes.length;
  return html`
    <div class="obody">
      <div class=${classNames("oleft", dim)}>
        <div class="fh"><b>Routing</b></div>
        ${grid(schema, v)}
      </div>
      <div class="oright">
        <div class=${classNames("ptot", dim)}>
          ${v.nIn} in · <span class=${v.over ? "over" : undefined}>${v.over ? `${count} / ${MAXP} pipelines` : `${count} pipelines`}</span>
          · ${v.nOut} out
        </div>
        ${off ? html`<span class="gr">${withXref(v.gray, here)}</span>` : null}
        <div class=${classNames("oacts", dim)}>
          <${ImportEq} off=${off} />
          <${FileKey} label="Upload convolution filters" accept=".wav" multiple=${true} off=${off} onFiles=${onFiles} />
        </div>
        <div class=${classNames("ofiles", dim)}>
          ${uploaded.value.map((/** @type {string} */ p) => html`<span class="vfd pfile">${p.split("/").pop()}</span>`)}
        </div>
        ${note.value ? html`<p class="phint">${note.value}</p>` : null}
        <div class=${classNames("man", dim)}>
          <p>${PMAN.pipelines}</p>
          <p>${PMAN.conv}</p>
        </div>
      </div>
    </div>
  `;
}
