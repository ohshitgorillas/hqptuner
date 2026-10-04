// Settings decisions, free of the DOM: how a settings-rail readout prints a control's value, and which visual effect a
// live setting change causes, with the values it carries (the Settings body acts on them).

import { minusText } from "./format.js";
import { optionOf } from "./options.js";

/**
 * @typedef {{ v: string | number, label: string, unit?: string }} Option
 * @typedef {{ v: string, label: string, hex: string }} Accent
 * @typedef {{ type: string, options?: readonly Option[], auto?: { v: string | number } }} Control
 * @typedef {{ text: string, swatch: string | null }} Readout
 * @typedef {{ kind: 'none' }
 *   | { kind: 'pinallow', on: boolean }
 *   | { kind: 'accent', tokens: Record<string, string> }
 *   | { kind: 'fill' | 'bottom' | 'style', value: string }
 *   | { kind: 'hide', stages: { id: string, hidden: boolean }[] }
 *   | { kind: 'font', family: string | null }} Effect
 */

/** The body family the Dyslexic font swaps in (non-monospace text; engraved legends keep Saira). */
const DYSLEXIC_FAMILY = "'Atkinson Hyperlegible',system-ui,sans-serif";

/**
 * A pick's color: the named accent's own, else the value itself (a color already).
 *
 * @param {string} v
 * @param {readonly Accent[]} accents
 * @returns {string}
 */
const accentHex = (v, accents) => accents.find((x) => x.v === v)?.hex ?? v;

/**
 * A seg or select readout: the control's own option label (+ unit), else the value.
 *
 * @param {Control} c
 * @param {string} v
 * @returns {Readout}
 */
function optionReadout(c, v) {
  const o = optionOf(c.options ?? [], v);
  return { text: o ? o.label + (o.unit ? " " + o.unit : "") : v, swatch: null };
}

/** @typedef {(c: Control, v: string, accents: readonly Accent[]) => Readout} Printer  how one control type prints */

/** @type {Record<string, Printer>} */
const READOUT = {
  seg: optionReadout,
  select: optionReadout,
  toggles(c, v) {
    const options = c.options ?? [];
    // Each label's spaces become no-break spaces, so a label never wraps inside itself.
    const picked = v.split(",");
    const text = v
      ? options
          .filter((o) => picked.includes(String(o.v)))
          .map((o) => o.label.replace(/ /g, " "))
          .join(" · ")
      : "None";
    return { text, swatch: null };
  },
  slider: (c, v) => ({ text: c.auto && v === String(c.auto.v) ? "Automatic" : v, swatch: null }), // v1's own word for 0
  number: (c, v) => ({ text: minusText(v), swatch: null }),
  accent(c, v, accents) {
    const o = accents.find((x) => x.v === v);
    return { text: o ? o.label : v, swatch: accentHex(v, accents) };
  },
};

/**
 * How a readout prints a value: the control's own option label (+ unit), the picked toggles, the number, the path, the
 * accent's name with its swatch color (null for every other control).
 *
 * @param {Control} c
 * @param {string} v
 * @param {readonly Accent[]} accents
 * @returns {Readout}
 */
export function readoutOf(c, v, accents) {
  return Object.hasOwn(READOUT, c.type) ? READOUT[c.type](c, v, accents) : { text: v, swatch: null };
}

/**
 * The visual effect a live setting change causes, with its values. Allow pinned rates shows the rate pins; Accent color
 * sets the accent tokens (dim, low and rim derived from the pick, as the amber set is); Top of page, Bottom bar and
 * Option style carry the pick; Hide from signal chain says, per hideable stage, whether it leaves the chain rail;
 * Dyslexic font names the body family (null restores the default). Every other setting is none: the mock does not act
 * on it.
 *
 * @param {string} id
 * @param {string} v
 * @param {readonly Accent[]} accents
 * @param {readonly { v: string }[]} hideable
 * @returns {Effect}
 */
export function effectOf(id, v, accents, hideable) {
  if (id === "pinallow") return { kind: "pinallow", on: v === "1" };
  if (id === "vacc") {
    const hex = accentHex(v, accents);
    return {
      kind: "accent",
      tokens: {
        "--acc": hex,
        "--acc-dim": `color-mix(in srgb, ${hex} 47%, #000)`,
        "--acc-lo": `color-mix(in srgb, ${hex} 16%, #0b0a08)`,
        "--acc-rim": `color-mix(in srgb, ${hex} 55%, #fff)`, // the lit rim / peak hold, pale of the accent
      },
    };
  }
  if (id === "vfill") return { kind: "fill", value: v };
  if (id === "vbottom") return { kind: "bottom", value: v };
  if (id === "vstyle") return { kind: "style", value: v };
  if (id === "vhide") {
    const hide = new Set(v.split(",").filter(Boolean));
    return { kind: "hide", stages: hideable.map(({ v: sid }) => ({ id: sid, hidden: hide.has(sid) })) };
  }
  if (id === "vdys") return { kind: "font", family: v === "1" ? DYSLEXIC_FAMILY : null };
  return { kind: "none" };
}
