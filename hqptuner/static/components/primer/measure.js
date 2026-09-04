// The one thing a primer pane cannot know from its own drawing: how many
// pixels the page gave it. An SVG scales its viewBox to whatever width the
// card hands out, so the drawing's units say nothing about the resolution the
// trace has to live in, and a trace reduced to viewBox units draws the same
// point list at a 640 px window as at a 1280 px one. Each pane observes its
// own element and reports the plot rectangle's width into a store signal;
// where nothing has measured, the figure stays 0 and the pane falls back to
// its own drawing width.
import { useEffect } from "preact/hooks";

/**
 * Report the plot rectangle's rendered width, in CSS pixels, into `target` for
 * as long as the element is mounted, and again whenever the layout moves it.
 * A render with no layout behind it leaves the figure at zero.
 * @param {{ current: SVGSVGElement | null }} ref the pane's SVG element
 * @param {{ value: number }} target the store signal the figure lands in
 * @param {number} ratio the plot rectangle's share of the viewBox width
 * @returns {void}
 */
export function useMeasuredPlot(ref, target, ratio) {
  useEffect(() => {
    const svg = ref.current;
    if (!svg || typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0];
      if (!box) return;
      target.value = Math.round(box.contentRect.width * ratio);
    });
    ro.observe(svg);
    return () => {
      ro.disconnect();
      target.value = 0;
    };
  }, [ref, target, ratio]);
}
