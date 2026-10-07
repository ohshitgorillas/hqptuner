// The bodies of the page's Resampling and Shaping sections: the running chain's fields, one open and every other folded
// to a line that opens it, or both filters open where the plate holds them. The open field is its head over its
// nameplate, and its copy, the option's engine name and prose, sits in the right column.
//
// Copy never pushes the page past the plate: while the page's lowest section runs past its bottom, the copy standing
// furthest above its own left column keeps as much prose as fits and ends in `… see more`, which opens the whole of it
// in a popover. The fit measures the laid-out page, so it runs in a layout effect and settles before paint.

import { useLayoutEffect, useRef } from "preact/hooks";
import { signal } from "@preact/signals";
import { html } from "../../../lib/dom.js";
import { schema } from "../../../store/schema.js";
import { conversionSections, openField } from "../../../store/faceplate/page/conversion.js";
import { plate } from "../../../store/faceplate/view.js";
import { FIT_PASSES, fitStep, overrunOf, overruns } from "../../../model/shell/conversion.js";
import { Fields } from "./Fields.js";
import { Popover, parkAt, triggerProps } from "../Popover.js";
import { ChainPick } from "./ChainPick.js";

/**
 * @typedef {import("../../../store/faceplate/page/conversion.js").ConvField} ConvField
 * @typedef {import("../../../store/faceplate/page/conversion.js").SectionId} SectionId
 * @typedef {import("../../../store/faceplate/page/conversion.js").FieldId} FieldId
 * @typedef {{ key: string, by: Record<string, number>, passes: number }} Cuts  each cut copy's prose word count, for
 *   the page as it was measured
 */

/** A filter's line under its name: the side of the filter split it covers. @type {Partial<Record<FieldId, string>>} */
const SUB = { "1x": "Sources up to 50 kHz", nx: "Sources above 50 kHz" };

const IDLE = " · idle";
const SEE_MORE = "… see more";

/** Under its link, flipped above it where below would cross the plate's foot. */
const HOW = /** @type {const} */ ({ side: 22, foot: 14, at: { x: "start", y: "flip", gap: 6 } });

const cuts = signal(/** @type {Cuts} */ ({ key: "", by: {}, passes: 0 }));

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
 * Park a note popover under its link.
 *
 * @param {HTMLElement} panel
 */
function park(panel) {
  const at = parkAt(panel, HOW);
  if (!at) return;
  panel.style.left = `${Math.round(at.left)}px`;
  panel.style.top = `${Math.round(at.top)}px`;
}

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
    scale: plate.value.scale,
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
 * What the fit was measured against: the plate, the page's sections and the copies' full text. A change starts over
 * from full copy.
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
 * One pass of the fit: start over when what it measured changed, else cut the copy that gives the overrun back.
 *
 * @param {HTMLElement} page
 */
function refit(page) {
  const hosts = /** @type {HTMLElement[]} */ ([...page.querySelectorAll("[data-copy]")]);
  const key = fitKey(page, hosts);
  const now = cuts.value;
  if (now.key !== key) {
    cuts.value = { key, by: {}, passes: 0 };
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
  const by = { ...now.by, [host.dataset.copy ?? ""]: wordsFitting(host, step.height) };
  cuts.value = { key, by, passes: now.passes + 1 };
}

let queued = false;

/**
 * Run one fit pass once the render in progress has committed, however many copies asked.
 *
 * @param {HTMLElement} host
 */
function scheduleFit(host) {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    const page = host.closest("main");
    if (host.isConnected && page instanceof HTMLElement) refit(page);
  });
}

// --- the bodies ---------------------------------------------------------------------------

/**
 * The open field's copy: its engine name and prose, ending in `… see more` where the prose holds paragraphs back, which
 * opens them, or is cut short, which opens the whole of it.
 *
 * @param {object} props
 * @param {string} props.id  the copy's id on the page
 * @param {ConvField} props.field
 */
function Copy({ id, field }) {
  const ref = useRef(/** @type {HTMLElement | null} */ (null));
  const now = cuts.value;
  const cut = now.by[id];
  const fit = plate.value;
  // `now`, not only `cut`: the fit advances one pass per write to `cuts`, and a fresh key's write leaves every cut
  // where it was.
  useLayoutEffect(() => {
    if (ref.current) scheduleFit(ref.current);
  }, [now, cut, fit, field.value, field.prose, field.more.length]);
  const pop = `copy-${id}`;
  const shown = cut === undefined ? field.prose : wordsOf(field.prose).slice(0, cut).join(" ");
  const rest =
    cut === undefined && field.more.length === 0
      ? field.prose
      : html`${shown}${" "}
          <button type="button" class="seemore" data-testid="see-more" ...${triggerProps(pop, "dialog")}>
            ${SEE_MORE}
          </button>
          <${Popover} id=${pop} cls="notepop" role="dialog" label=${field.value} park=${park}>
            ${(cut === undefined ? field.more : [field.prose, ...field.more]).map((p) => html`<p>${p}</p>`)}
          <//>`;
  return html`
    <div ref=${ref} class="man" data-copy=${id} data-name=${field.value} data-prose=${field.prose}>
      <code>${field.value}</code>${" "}${rest}
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
 * @param {{ section: SectionId }} props
 */
export function Conversion({ section }) {
  const s = conversionSections()[section];
  /** @param {FieldId} id */
  const byId = (id) => s.fields.find((f) => f.id === id);
  /** @param {ConvField} f */
  const copy = (f) => html`<${Copy} key=${`copy-${f.id}`} id=${`${section}-${f.id}`} field=${f} />`;
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
