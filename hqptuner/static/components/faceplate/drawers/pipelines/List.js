// An output tab's list: the input's pipelines as a fixed page of lines (`#n`, the chain as compact text, the gain),
// numbered page buttons under them. A crossfeed block folds to one line naming it, its row count and its summary; its
// twisty unfolds it, and a tap elsewhere on it picks its first row.

import { html } from "../../../../lib/dom.js";
import { classNames } from "../../../../model/shell/format.js";
import { PAGE, chipText, rowText } from "../../../../model/shell/pipelines.js";
import { effectivePipelines } from "../../../../store/resolve.js";
import { chName } from "../../../../store/faceplate/drawers/pipelines.js";
import { BLOCK_NAME } from "./copy.js";
import { raws, toggleBlock } from "./state.js";
import { Pager } from "./parts.js";

/** @typedef {import("../../../../model/shell/pipelines.js").Item} Item */
/** @typedef {import("../../../../model/shell/pipelines.js").Pipe} Pipe */
/** @typedef {import("./Output.js").Tab} Tab */

/**
 * Pick pipeline `i`, its first chip and band.
 *
 * @param {Tab} t
 * @param {number} i
 */
const pick = (t, i) => t.put({ selPipe: i, chip: 0, band: 0 });

/**
 * A pipeline's line.
 *
 * @param {Tab} t
 * @param {Item} x
 */
function pipeLine(t, x) {
  const p = /** @type {Pipe} */ (x.p);
  const i = /** @type {number} */ (x.i); // a pipeline's line carries both
  const sel = i === t.cur.selPipe;
  const chain = raws.value[i] ? (effectivePipelines.value[i]?.process ?? "") : rowText(p);
  const gain = chipText(p, { kind: "gain", idx: [] }) + (p.unit === "Lin" && p.gain < 0 ? " ø" : "");
  return html`
    <div
      class=${classNames("plrow", sel && "sel", x.inBlock && "inblk")}
      role="option"
      aria-selected=${String(sel)}
      data-i=${String(i)}
      onClick=${() => (t.off ? undefined : pick(t, i))}
    >
      <span class="ppn">#${i + 1}</span>
      <span class="plc">${chain}</span>
      <span class="plg">${gain}</span>
    </div>
  `;
}

/**
 * A crossfeed block's line, folded or heading its unfolded rows.
 *
 * @param {Tab} t
 * @param {Item} x
 */
function blockLine(t, x) {
  const kind = /** @type {string} */ (x.fold || x.head);
  const open = !x.fold;
  const first = /** @type {number} */ (x.first);
  const sel = !open && t.v.pipes[t.cur.selPipe]?.gen === kind;
  const name = BLOCK_NAME[kind] ?? kind;
  return html`
    <div
      class=${classNames("plrow plfold", sel && "sel")}
      role="option"
      aria-selected=${String(sel)}
      data-i=${String(first)}
      onClick=${() => (t.off ? undefined : pick(t, first))}
    >
      <button
        type="button"
        class="pltw"
        aria-expanded=${String(open)}
        aria-label=${`${open ? "Fold" : "Unfold"} ${name}`}
        disabled=${t.off}
        onClick=${(/** @type {Event | undefined} */ e) => {
          e?.stopPropagation();
          toggleBlock(kind);
        }}
      >
        ${open ? "▾" : "▸"}
      </button>
      <span class="xref">${name}</span>
      <span class="pls">${x.n} rows · ${t.v.block.sum}</span>
    </div>
  `;
}

/**
 * The list's page and its page buttons.
 *
 * @param {{ t: Tab }} props
 */
export function List({ t }) {
  const { ov } = t;
  const shown = ov.items.slice(ov.paging.start, ov.paging.end);
  return html`
    <div class="plrows orows" role="listbox" aria-label=${`Pipelines into ${chName(t.o)}`}>
      ${shown.map((x) => (x.fold || x.head ? blockLine(t, x) : pipeLine(t, x)))}
    </div>
    <div class="opg">
      <${Pager} n=${ov.items.length} per=${PAGE} page=${t.cur.page} go=${(/** @type {number} */ k) => t.put({ page: k })} off=${t.off} />
    </div>
  `;
}
