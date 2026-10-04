// A console window's popover: the facet's controls with its hint under them. Chips toggle a pick, a combining facet
// carries its AND / OR mode (its own default leftmost), segments pick a row's value, checkboxes switch a rule. Every
// control carries the count its pick lands on: the running chain's 1x·Nx filter lists, a staged row's own stage, or
// the shaper list itself. A chip whose pick would empty both lists is dead unless it is picked.

import { html } from "../../../lib/dom.js";
import { deadChip } from "../../../model/shell/narrow-view.js";
import { FOCUS_MODE_DEFAULT, GENRE_MODE_DEFAULT } from "../../../store/narrow/state.js";
import { narrowState, previewCounts, setFacet, shaperCount } from "../../../store/faceplate/lists/facets.js";
import { Popover, parkAt } from "../Popover.js";
import { CONSOLES, popId } from "./facets.js";
import { AMark } from "./Rows.js";

/** @typedef {import("./facets.js").BarFacet} BarFacet */
/** @typedef {import("./facets.js").FacetRow} FacetRow */
/** @typedef {import("../../../store/faceplate/lists/open.js").ListKind} ListKind */
/** @typedef {import("../../../store/faceplate/lists/facets.js").NarrowState} NarrowState */
/** @typedef {Record<string, unknown>} State */

/** Drops 6 px under its window, left edges flush, kept 22 px inside the plate's sides. */
/** @type {{ side: import("../../../model/shell/place.js").Side, foot: null, at: import("../../../model/shell/place.js").Place }} */
const HOW = { side: 22, foot: null, at: { x: "start", y: "below", gap: 6 } };

/** The mode each combining facet starts at, drawn leftmost. @type {Record<string, string>} */
const MODE_DEFAULT = { genre: GENRE_MODE_DEFAULT, focus: FOCUS_MODE_DEFAULT };

const DEAD_TITLE = "No filters with this property match the current selections.";

/**
 * Park a popover under its window.
 *
 * @param {HTMLElement} panel
 */
function park(panel) {
  const at = parkAt(panel, HOW);
  if (at) {
    panel.style.left = `${Math.round(at.left)}px`;
    panel.style.top = `${Math.round(at.top)}px`;
  }
}

/**
 * The 1x·Nx filter counts a pick would leave.
 *
 * @param {State} over
 */
const pair = (over) => {
  const c = previewCounts(over);
  return `${c["1x"]}·${c.nx}`;
};

/**
 * The count a pick would leave on a list kind's console: the filter pair, or the shaper list.
 *
 * @param {ListKind} kind
 * @param {State} over
 */
const countFor = (kind, over) => (kind === "filters" ? pair(over) : String(shaperCount(kind, over)));

/**
 * A combining facet's AND / OR switch, its default mode leftmost.
 *
 * @param {BarFacet} f
 * @param {State} st
 */
function modeSeg(f, st) {
  if (!f.combine || !f.key) return null;
  const key = `${f.key}Mode`;
  const mode = String(st[key]);
  const modes = MODE_DEFAULT[f.key] === "or" ? ["or", "and"] : ["and", "or"];
  return html`
    <span class="mode">
      <span class="seg mini" role="radiogroup" aria-label=${`Combine ${f.label}`} data-mode=${f.key}>
        ${modes.map(
          (v) => html`
            <button type="button" class=${mode === v ? "on" : undefined} data-v=${v} onClick=${() => setFacet(key, v)}>
              ${v.toUpperCase()}
            </button>
          `,
        )}
      </span>
    </span>
  `;
}

/**
 * A chips facet's chips.
 *
 * @param {BarFacet} f
 * @param {ListKind} kind
 * @param {State} st
 */
function chips(f, kind, st) {
  const key = String(f.key);
  const sel = /** @type {string[]} */ (st[key]);
  return html`
    <div class="nchips" data-facet=${key}>
      ${(f.options ?? []).map((o) => {
        const v = String(o.v);
        const pressed = sel.includes(v);
        const next = pressed ? sel.filter((x) => x !== v) : [...sel, v];
        const n = countFor(kind, { [key]: next });
        const dead = deadChip(pressed, n);
        return html`
          <button
            type="button"
            class="nchip"
            data-v=${v}
            aria-pressed=${String(pressed)}
            disabled=${dead}
            title=${dead ? DEAD_TITLE : undefined}
            onClick=${() => setFacet(key, next)}
          >
            ${o.label}<span class="c">${n}</span>
          </button>
        `;
      })}
    </div>
  `;
}

/**
 * An Apodizing segment's face: the full mark for Only, full and half for +½, its label for All.
 *
 * @param {string | number} v
 */
function apodFace(v) {
  if (v === "only") return html`<span class="amk"><${AMark} kind="full" /></span>`;
  return v === "half" ? html`<span class="amk"><${AMark} kind="full" />+<${AMark} kind="half" /></span>` : null;
}

/**
 * One segmented row, each segment carrying the count its pick lands on: its stage's list for a staged row, else 1x·Nx.
 *
 * @param {BarFacet} f
 * @param {FacetRow} r
 * @param {State} st
 */
function segRow(f, r, st) {
  const stage = r.stage;
  return html`
    <div class="nrow">
      ${stage && r.showStage !== false ? html`<span class="stg">${stage === "nx" ? "Nx" : "1x"}</span>` : null}
      <span class="seg" role="radiogroup" aria-label=${r.aria} data-facet=${r.key}>
        ${r.options.map((o) => {
          const on = String(st[r.key]) === String(o.v);
          const over = { [r.key]: o.v };
          const n = stage ? String(previewCounts(over)[stage]) : pair(over);
          return html`
            <button
              type="button"
              class=${on ? "on" : undefined}
              data-v=${String(o.v)}
              onClick=${() => (on ? undefined : setFacet(r.key, o.v))}
            >
              ${(f.apod && apodFace(o.v)) || o.label}<span class="c">${n}</span>
            </button>
          `;
        })}
      </span>
    </div>
  `;
}

/**
 * A checks facet's rules, each with the 1x·Nx counts switching it would leave.
 *
 * @param {BarFacet} f
 * @param {State} st
 */
const checks = (f, st) =>
  (f.items ?? []).map(
    (i) => html`
      <div class="nrow">
        <label class="chk">
          <input
            type="checkbox"
            data-facet=${i.key}
            checked=${!!st[i.key]}
            onChange=${(/** @type {{ target: { checked: boolean } }} */ e) => setFacet(i.key, e.target.checked)}
          />
          <span>${i.label}</span><span class="c">${pair({ [i.key]: !st[i.key] })}</span>
        </label>
      </div>
    `,
  );

/**
 * A facet's controls by its kind.
 *
 * @param {BarFacet} f
 * @param {ListKind} kind
 * @param {State} st
 */
function controls(f, kind, st) {
  if (f.kind === "chips") return chips(f, kind, st);
  if (f.kind === "seg") return (f.rows ?? []).map((r) => segRow(f, r, st));
  return f.kind === "checks" ? checks(f, st) : null;
}

/**
 * A facet's hint paragraphs, each plain or with a bold lead-in; `prefix` opens the first with the hints' own lead-in.
 *
 * @param {BarFacet} f
 */
function hint(f) {
  if (!f.hint) return null;
  return html`
    <div class="nhint">
      ${f.hint.map(
        (p, i) => html`
          <p>
            ${i === 0 && f.prefix ? html`<strong>HQPTuner Hints:</strong>${" "}` : null}
            ${Array.isArray(p) ? html`<strong>${p[0]}</strong>${p[1]}` : p}
          </p>
        `,
      )}
    </div>
  `;
}

/**
 * The popovers of a list kind's console, one per window that opens one (Favorites is a plain switch).
 *
 * @param {{ kind: ListKind }} props
 */
export function FacetPopovers({ kind }) {
  const st = /** @type {State} */ (/** @type {unknown} */ (narrowState()));
  return CONSOLES[kind]
    .filter((f) => f.kind !== "toggle")
    .map(
      (f) => html`
        <${Popover} id=${popId(f)} cls="fpop2" role="dialog" label=${f.label} park=${park}>
          <div class="fph"><span class="t">${f.label}</span>${modeSeg(f, st)}</div>
          ${controls(f, kind, st)} ${hint(f)}
        <//>
      `,
    );
}
