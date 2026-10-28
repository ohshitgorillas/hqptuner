// The bodies of the page's Resampling and Shaping sections: the running chain's fields, one open and every other folded
// to a line that opens it, or both filters open where the plate holds them. The open field is its head over its
// nameplate, and its copy, the option's engine name and prose, sits in the right column.
//
// Copy never pushes the page past the plate: while the page's lowest section runs past its bottom, the copy standing
// furthest above its own left column keeps as much prose as fits and ends in `… see more`, which opens the whole of it
// in a popover. The fit measures the laid-out page, so it runs in a layout effect and settles before paint.

import { useLayoutEffect, useRef } from "preact/hooks";
import { PLATFORM } from "../../../lib/clock.js";
import { html } from "../../../lib/dom.js";
import { schema } from "../../../store/schema.js";
import { conversionSections, cutCopy, cuts, openField, restartCuts } from "../../../store/faceplate/page/conversion.js";
import { plate } from "../../../store/faceplate/plate.js";
import { FIT_PASSES, fitStep, overrunOf, overruns } from "../../../model/shell/conversion.js";
import { Fields } from "./Fields.js";
import { MoreNote, SEE_MORE, seeMore } from "../SeeMore.js";
import { ChainPick } from "./ChainPick.js";

/**
 * @typedef {import("../../../store/faceplate/page/conversion.js").ConvField} ConvField
 * @typedef {import("../../../store/faceplate/page/conversion.js").SectionId} SectionId
 * @typedef {import("../../../store/faceplate/page/conversion.js").FieldId} FieldId
 * @typedef {import("../../../lib/clock.js").Clock} Clock
 * @typedef {{ current: boolean }} Queued  whether a fit pass is queued for the page's copies
 */

/** A filter's line under its name: the side of the filter split it covers. @type {Partial<Record<FieldId, string>>} */
const SUB = { "1x": "Sources up to 50 kHz", nx: "Sources above 50 kHz" };

const IDLE = " · idle";

/** @param {ConvField} f */
const labelOf = (f) => schema[f.key]?.label ?? f.key;

/**
 * Why a field reads as it does: the side of the split a filter covers or what the shaper does, idle where this track's
 * path does not run it.
 *
 * @param {ConvField} f
 */
const whyOf = (f) => {
  const sub = SUB[f.id] ?? schema[f.key]?.sublabel ?? "";
  return f.idle ? sub + IDLE : sub;
};

/** @param {string} prose */
const wordsOf = (prose) => prose.split(/\s+/).filter(Boolean);

// --- the fit (browser only) ---------------------------------------------------------------

/**
 * How far the page's lowest section runs past the page's bottom, layout px.
 *
 * @param {HTMLElement} page
 */
function pageOverrun(page) {
  const kids = /** @type {HTMLElement[]} */ ([...page.children]).filter((c) => c.offsetParent);
  return overrunOf({
    bottoms: kids.map((c) => c.getBoundingClientRect().bottom),
    pageBottom: page.getBoundingClientRect().bottom,
    padding: parseFloat(getComputedStyle(page).paddingBottom),
  });
}

/**
 * A copy cut to its first `n` words of prose, then the link that opens it whole.
 *
 * @param {HTMLElement} el
 * @param {string} name
 * @param {string[]} words
 * @param {number} n
 */
function fillCut(el, name, words, n) {
  const code = document.createElement("code");
  code.textContent = name;
  const more = document.createElement("button");
  more.className = "seemore";
  more.textContent = SEE_MORE;
  el.replaceChildren(code, ` ${words.slice(0, n).join(" ")} `, more);
}

/**
 * The most words of a copy's prose that keep it within `maxH`, measured on a hidden twin at its width.
 *
 * @param {HTMLElement} host
 * @param {number} maxH  layout px
 */
function wordsFitting(host, maxH) {
  const words = wordsOf(host.dataset.prose ?? "");
  const name = host.dataset.name ?? "";
  const probe = /** @type {HTMLElement} */ (host.cloneNode(false));
  probe.removeAttribute("data-copy");
  probe.style.cssText = `position:absolute;visibility:hidden;left:0;top:0;width:${host.offsetWidth}px`;
  host.after(probe);
  let lo = 0,
    hi = words.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    fillCut(probe, name, words, mid);
    if (probe.offsetHeight <= maxH) lo = mid;
    else hi = mid - 1;
  }
  probe.remove();
  return lo;
}

/**
 * The fit's key: the plate, the page's height, its sections and the copies' full text. Cuts hold for one key only;
 * under any other key every copy fits from its full text.
 *
 * @param {HTMLElement} page
 * @param {HTMLElement[]} hosts
 */
function fitKey(page, hosts) {
  const p = plate.value;
  const secs = /** @type {HTMLElement[]} */ ([...page.children]).map((c) => `${c.dataset.stage}.${c.className}`);
  const copies = hosts.map((h) => `${h.dataset.copy}:${h.dataset.name}:${h.dataset.prose}`);
  return [p.w, p.h, page.clientHeight, ...secs, ...copies].join("|");
}

/**
 * One pass of the fit: start over from full copy when the fit key differs from the cuts' key, else cut the copy that
 * gives the overrun back, at most `FIT_PASSES` passes per key.
 *
 * @param {HTMLElement} page
 */
function refit(page) {
  const now = cuts.value;
  const hosts = /** @type {HTMLElement[]} */ ([...page.querySelectorAll("[data-copy]")]);
  const key = fitKey(page, hosts);
  if (now.key !== key) {
    restartCuts(key);
    return;
  }
  if (now.passes >= FIT_PASSES) return;
  const over = pageOverrun(page);
  if (!overruns(over)) return;
  const measured = hosts.map((h) => ({
    height: h.offsetHeight,
    left: /** @type {HTMLElement | null} */ (h.previousElementSibling)?.offsetHeight ?? 0,
  }));
  const step = fitStep(measured, over);
  if (!step) return;
  const host = hosts[step.index];
  cutCopy(host.dataset.copy ?? "", wordsFitting(host, step.height));
}

/**
 * Run one fit pass once the render in progress has committed, however many of the page's copies asked.
 *
 * @param {HTMLElement} host
 * @param {Clock} clock  the clock the pass is queued on
 * @param {Queued} queued  the page's queued flag
 */
function scheduleFit(host, clock, queued) {
  if (queued.current) return;
  queued.current = true;
  clock.queueMicrotask(() => {
    queued.current = false;
    const page = host.closest("main");
    if (host.isConnected && page instanceof HTMLElement) refit(page);
  });
}

// --- the bodies ---------------------------------------------------------------------------

/**
 * The open field's copy: its engine name and first paragraph, ending in `… see more` where the prose holds paragraphs
 * back, which opens them, then the paragraphs in place after it; or, cut short, its first words and `… see more`, which
 * opens the whole of it.
 *
 * @param {object} props
 * @param {string} props.id  the copy's id on the page
 * @param {ConvField} props.field
 * @param {Clock} props.clock  the clock the fit pass is queued on
 * @param {Queued} props.queued  the page's queued flag
 */
function Copy({ id, field, clock, queued }) {
  const ref = useRef(/** @type {HTMLElement | null} */ (null));
  const now = cuts.value;
  const cut = now.by[id];
  const fit = plate.value;
  // `now`, not only `cut`: the fit advances one pass per write to `cuts`, and a write that cuts another copy, or
  // restarts the fit while this one is uncut, leaves this copy's `cut` the same.
  useLayoutEffect(() => {
    if (ref.current) scheduleFit(ref.current, clock, queued);
  }, [now, cut, fit, clock, queued, field.value, field.prose, field.rest.length, field.more.length]);
  const pop = `copy-${id}`;
  const shown = cut === undefined ? field.prose : wordsOf(field.prose).slice(0, cut).join(" ");
  const first =
    cut === undefined && field.more.length === 0
      ? field.prose
      : html`${shown}${" "}${seeMore(pop)}
          <${MoreNote}
            id=${pop}
            label=${field.value}
            paras=${cut === undefined ? field.more : [field.prose, ...field.rest, ...field.more]}
          />`;
  const after = cut === undefined ? field.rest.map((p) => html`<p>${p}</p>`) : null;
  return html`
    <div ref=${ref} class="man" data-copy=${id} data-name=${field.value} data-prose=${field.prose}>
      <code>${field.value}</code>${" "}${first}${after}
    </div>
  `;
}

/**
 * The open field: its head over its nameplate.
 *
 * @param {{ field: ConvField }} props
 */
function OpenField({ field }) {
  const label = labelOf(field);
  return html`
    <div class="fh"><b>${label}</b><span class="s">${whyOf(field)}</span></div>
    <${ChainPick} field=${field} label=${label} />
  `;
}

/**
 * One section's body for what runs.
 *
 * @param {object} props
 * @param {SectionId} props.section
 * @param {Queued} props.queued  the page's queued flag, one for every section the fit pass measures
 * @param {Clock} [props.clock]  the clock each copy's fit pass is queued on
 */
export function Conversion({ section, queued, clock = PLATFORM }) {
  const s = conversionSections()[section];
  /** @param {FieldId} id */
  const byId = (id) => s.fields.find((f) => f.id === id);
  /** @param {ConvField} f */
  const copy = (f) =>
    html`<${Copy} key=${`copy-${f.id}`} id=${`${section}-${f.id}`} field=${f} clock=${clock} queued=${queued} />`;
  if (s.open.length > 1) {
    return s.open.map((id) => {
      const f = byId(id);
      return f && [html`<div key=${id} class="fld"><${OpenField} field=${f} /></div>`, copy(f)];
    });
  }
  const open = byId(s.open[0]);
  const fields = s.fields.map((f) => ({
    id: f.id,
    name: labelOf(f),
    why: whyOf(f),
    value: f.value,
    body: html`<${OpenField} field=${f} />`,
  }));
  return html`
    <div class="fld">
      <${Fields}
        fields=${fields}
        open=${s.open[0]}
        onOpen=${(/** @type {string} */ id) => openField(section, /** @type {FieldId} */ (id))}
      />
    </div>
    ${open && copy(open)}
  `;
}
