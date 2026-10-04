// The signal-chain rail: one button per stage of what runs (store/faceplate/chain.js), and the silkscreen wire through
// their lamps. A tap opens the stage's drawer, or closes it when it is the open one. A bypassed stage's lamp reads unlit
// and the wire drops its tap, as for an off stage; a hidden stage leaves the chain and the wire.

import { useEffect, useRef } from "preact/hooks";
import { html } from "../../lib/dom.js";
import { railNow, railStages } from "../../store/faceplate/chain.js";
import { openStage, toggleStage, plate } from "../../store/faceplate/view.js";
import { lampDots, wirePath } from "../../model/gauges/wire.js";

/** @typedef {import("../../store/faceplate/chain.js").RailStage} RailStage */

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
 * One stage's button.
 *
 * @param {{ st: RailStage, open: boolean }} props
 */
function Stage({ st, open }) {
  const cls = ["st", st.level >= 1 && "sub", st.level === 2 && "sub2", !st.on && "off", st.byp && "byp", open && "open"]
    .filter(Boolean)
    .join(" ");
  return html`
    <button
      type="button"
      class=${cls}
      data-stage=${st.id}
      data-level=${st.level}
      hidden=${st.hidden}
      onClick=${() => toggleStage(st.id)}
    >
      <span class=${st.on ? "lamp on" : "lamp"}></span>
      <span class="n">${st.name}</span>
      <span class="v">${st.value}</span>
    </button>
  `;
}

/** The chain rail, its stages decided from what runs and its wire redrawn whenever they or the plate change. */
export function Rail() {
  const stages = railStages(railNow());
  const fit = plate.value;
  const ref = useRef(/** @type {HTMLElement | null} */ (null));
  const drawn = JSON.stringify(stages);
  useEffect(() => {
    if (ref.current) drawWire(ref.current, fit.scale);
  }, [drawn, fit]);
  return html`
    <nav class="rail" ref=${ref} aria-label="Signal chain">
      <svg class="wire" aria-hidden="true"><path /></svg>
      ${stages.map((st) => html`<${Stage} key=${st.id} st=${st} open=${openStage.value === st.id} />`)}
    </nav>
  `;
}
