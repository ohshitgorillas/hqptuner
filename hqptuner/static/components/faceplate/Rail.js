// The signal-chain rail: one button per stage of what runs (store/faceplate/chain.js), and the silkscreen wire through
// their lamps. A tap opens the stage's drawer, or closes it when it is the open one. A bypassed stage's lamp reads unlit
// and the wire drops its tap, as for an off stage; a hidden stage leaves the chain and the wire. A raised alert blinks
// its stage's lamp in the alert's colour, and a stage the alerts darken (no output past an SDM modulator below its
// floor) reads unlit and drops its tap as a bypassed one does. A stage whose lamp reads unlit prints no value. A stage
// whose name runs past one line puts its lamp on the first, measured with the wire and again once the fonts land.

import { useEffect, useRef } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { railBreak, railNow, railStages, railValue } from "../../store/faceplate/chain.js";
import { openStage, toggleStage, plate } from "../../store/faceplate/view.js";
import { lampDots, wirePath } from "../../model/gauges/wire.js";
import { alertsNow } from "../../store/faceplate/alerts.js";

/** @typedef {import("../../store/faceplate/chain.js").RailStage} RailStage */

/** A name box taller than this, layout px, runs past one line. */
const ONE_LINE = 30;

/**
 * Mark each stage whose name runs past one line, so its lamp sits on the first, then draw the wire.
 *
 * @param {HTMLElement} rail
 * @param {number} scale  the plate's scale
 */
function layout(rail, scale) {
  for (const n of rail.querySelectorAll(".st > .n"))
    n.parentElement?.classList.toggle("wrap", /** @type {HTMLElement} */ (n).offsetHeight > ONE_LINE);
  drawWire(rail, scale);
}

/**
 * Size the wire's svg to the rail and draw its path through the visible stages' lamps, measured in rail layout px.
 *
 * @param {HTMLElement} rail
 * @param {number} scale  the plate's scale
 */
function drawWire(rail, scale) {
  const lamps = [...rail.querySelectorAll(".st:not([hidden]) > .lamp")].map((l) => {
    const st = /** @type {HTMLElement} */ (l.parentElement);
    return {
      box: l.getBoundingClientRect(),
      level: Number(st.dataset.level),
      on: l.classList.contains("on") && !st.matches(".byp, .dead"),
    };
  });
  const svg = rail.querySelector(".wire");
  if (!lamps.length || !svg) return;
  const dots = lampDots({ rail: rail.getBoundingClientRect(), lamps, scale });
  svg.setAttribute("width", String(rail.offsetWidth));
  svg.setAttribute("height", String(rail.offsetHeight));
  svg.firstElementChild?.setAttribute("d", wirePath(dots, "trunk"));
}

/**
 * A value that wraps only between its parts: a lone part prints as text, and several print unbroken with a break
 * opportunity between each.
 *
 * @param {string} value
 */
function valueParts(value) {
  const parts = railBreak(value);
  if (parts.length < 2) return value;
  return parts.map((p, i) => html`${i ? html`<wbr />` : null}<span class="nb">${p}</span>`);
}

/**
 * One stage's button: `alert` the blink up on it, `dead` when the alerts darken it.
 *
 * @param {{ st: RailStage, open: boolean, alert: string | undefined, dead: boolean }} props
 */
function Stage({ st, open, alert, dead }) {
  const cls = [
    "st",
    st.level >= 1 && "sub",
    st.level === 2 && "sub2",
    !st.on && "off",
    st.byp && "byp",
    dead && "dead",
    open && "open",
  ]
    .filter(Boolean)
    .join(" ");
  return html`
    <button
      type="button"
      class=${cls}
      data-stage=${st.id}
      data-level=${st.level}
      data-alert=${alert}
      hidden=${st.hidden}
      onClick=${() => toggleStage(st.id)}
    >
      <span class=${st.on ? "lamp on" : "lamp"}></span>
      <span class="n">${st.name}</span>
      <span class="v">${valueParts(railValue(st, dead))}</span>
    </button>
  `;
}

/**
 * The chain rail, its stages decided from what runs and the alerts raised, and its wire redrawn whenever a stage's
 * classes or the plate change, and once the fonts land.
 */
export function Rail() {
  const stages = railStages(railNow());
  const plan = alertsNow.value;
  const fit = plate.value;
  const open = openStage.value;
  const ref = useRef(/** @type {HTMLElement | null} */ (null));
  const drawn = JSON.stringify([stages, open, [...plan.blinks.stage], plan.dark]);
  useEffect(() => {
    if (ref.current) layout(ref.current, fit.scale);
  }, [drawn, fit]);
  useEffect(() => {
    document.fonts?.ready.then(() => {
      if (ref.current) layout(ref.current, plate.value.scale);
    });
  }, []);
  return html`
    <nav class="rail" ref=${ref} aria-label="Signal chain">
      <svg class="wire" aria-hidden="true"><path /></svg>
      ${stages.map(
        (st) =>
          html`<${Stage}
            key=${st.id}
            st=${st}
            open=${open === st.id}
            alert=${plan.blinks.stage.get(st.id)}
            dead=${plan.dark.includes(st.id)}
          />`,
      )}
    </nav>
  `;
}
