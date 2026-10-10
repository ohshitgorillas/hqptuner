// An SVG label with a knockout under it: a patch of its background, sized from the label's measured box, painted after
// every mark beneath the label and before the label itself. No mark is drawn across the letters, whatever order an
// engine paints a text's glyphs in, so a letter-spaced label needs no halo. The knockout's class carries its colour, so
// it suits a flat background; over a gradient, the drawing clips its marks round the measured box instead.

import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { knockout } from "../../model/gauges/knockout.js";

/** @typedef {import("../../model/gauges/knockout.js").TextBox} TextBox */

/**
 * A ref for a drawn SVG text, and the box that text takes in its drawing's units: null until it has a laid-out box,
 * measured again whenever that box changes size, as when the panel holding it is first shown or its font finishes
 * loading.
 *
 * @returns {[{ current: SVGTextElement | null }, TextBox | null]}
 */
export function useTextBox() {
  const ref = useRef(/** @type {SVGTextElement | null} */ (null));
  const [box, setBox] = useState(/** @type {TextBox | null} */ (null));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(() => {
      const { x, y, width, height } = el.getBBox();
      /** @param {TextBox | null} b */
      const next = (b) =>
        b && b.x === x && b.y === y && b.width === width && b.height === height ? b : { x, y, width, height };
      if (width > 0) setBox(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

/**
 * A text with its knockout under it. Every prop but `knock` and `children` passes to the text.
 *
 * @param {{ knock: string, children?: unknown } & Record<string, unknown>} props  knock: the knockout's class
 */
export function KnockedText({ knock, children, ...rest }) {
  const [ref, box] = useTextBox();
  const k = box === null ? null : knockout(box);
  return html`
    ${k === null ? null : html`<rect class=${knock} x=${k.x} y=${k.y} width=${k.width} height=${k.height} />`}
    <text ref=${ref} ...${rest}>${children}</text>
  `;
}
