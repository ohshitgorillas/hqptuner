// Playback volume: − / readout / + at the right end of the engine row, slider popover from the readout.
// Live lane: every change shows at once (readout, popover, rail Volume value). Nothing stages.
// ± step once per press; holding repeats after a short delay. Bounds disable the matching button.
// Second home (Visual settings → Bottom bar: Volume): mountVolumeBar() draws the bottom-bar version (− | slider + scale |
// readout | +) on the same level; the engine-row cluster hides while it shows (settings.css).
// Fixed volume (Volume drawer, on Apply: setFixed): the rail value names the mode and its level (`Manual: −3.0 dB`,
// `Auto: −6 dB`); the engine-row and bottom-bar windows show the level alone. ±, the slider popover and
// the bottom bar's controls gray, since the level can't move.
// Direct SDM playing (mock scenario: a DSD source, SDM output, DSD playback Direct): the engine bypasses the volume control
// and pins PCM volume at −3 dBFS (v1 gray.js), so the windows read `−3.0 dB` and everything grays as for Fixed volume; the
// rail value says why (`Direct: −3.0 dB`, Fixed volume's grammar) and the window's tooltip carries v1's reason. It wins
// over Fixed volume while it lasts; the applied Fixed volume returns when the path changes.
// Loudness bounds: while loudness is in effect, both sliders mark its range with the Range bar's own
// grammar (parentheses + a strip under the track). Nothing else is marked: no startup volume, no min / max.

import { h, s } from "../../lib/shell/dom.js";
import { popover } from "../../lib/shell/popover.js";
import { toPlate, PLATE_W } from "../../lib/shell/plate.js";
import { PLATFORM } from "../../lib/shell/clock.js";
import { holdRepeat } from "../../model/shell/timing.js";
import { percentOf } from "../../model/gauges/output.js";
import { dbText, fixedPin, directPin, stepOff, volumeView, loudSpan } from "../../model/gauges/volume.js";

const HOLD_DELAY = 400; // ms before a held ± starts repeating
const HOLD_RATE = 70; // ms between repeats

const fmt = dbText;

/**
 * The scale marks under a volume slider: each of `cfg.scale` at its place along the range, the top one in full.
 * @param {{min:number, max:number, scale:number[]}} cfg
 */
const scaleMarks = ({ min, max, scale }) =>
  h(
    "div.scale",
    { "aria-hidden": "true" },
    scale.map((m) =>
      h("span", {
        style: `left:${percentOf(m, min, max)}%`,
        text: m === max ? `${m} dB` : fmt(m).replace(/\.0 dB$/, ""),
      }),
    ),
  );

/**
 * @param {HTMLElement} plate
 * @param {{down:HTMLButtonElement, readout:HTMLButtonElement, up:HTMLButtonElement}} ctl  engine-row controls
 * @param {HTMLButtonElement} stage  rail Volume stage (its .v mirrors the level)
 * @param {{value:number,min:number,max:number,step:number,scale:number[]}} cfg
 * @param {EventTarget} [bus]  gets a 'level' event (detail = dB) on every change (Range bar needle)
 * @param {object} [loud]
 * @param {import('../../lib/shell/clock.js').Clock} [clock]
 */
export function mountVolume(plate, { down, readout, up }, stage, cfg, bus, loud, clock = PLATFORM) {
  let value = cfg.value;
  let fixedSet = null; // Fixed volume as applied: null = adjustable; else {level, level_txt, text}
  let direct = null; // Direct SDM playing: {level, level_txt, text, why}, over fixed
  let shown = null; // what the last set() showed (model/volume.js volumeView): every change of the three above sets
  const { step } = cfg;
  const { big, slider, pop } = volumePanel(plate, readout, cfg, bus, loud, (v) => set(v));

  const views = []; // other homes of the level (bottom bar): fn(value, txt, fixed)
  function set(v) {
    shown = volumeView(v, value, { fixed: fixedSet, direct }, cfg);
    value = shown.value;
    readout.title = shown.why;
    // The mode word (`Manual:` / `Auto:`) lives on the rail only; the windows show the level alone.
    readout.querySelector(".v").textContent = shown.txt;
    readout.classList.toggle("fixed", shown.fixed);
    readout.disabled = shown.fixed; // nothing to slide: the popover stays shut
    big.textContent = shown.txt;
    slider.value = shown.level;
    slider.disabled = shown.fixed;
    stage.querySelector(".v").textContent = shown.rail;
    down.disabled = shown.off.down;
    up.disabled = shown.off.up;
    for (const fn of views) fn(shown.level, shown.txt, shown.fixed);
    bus?.dispatchEvent(new CustomEvent("level", { detail: shown.level }));
  }

  /** Fixed volume (Volume drawer → Fixed volume, applied): 'off' | 'manual' (level, dBFS) | 'auto' (iso '1' = −3, '2' = −6). */
  function setFixed(mode, level, iso) {
    if (pop.isOpen) pop.close();
    fixedSet = fixedPin(mode, level, iso);
    set(value);
  }

  /** Direct SDM playing (mock scenario): volume bypassed, PCM volume pinned at −3 dBFS. why = v1's gray reason. */
  function setDirect(on, why) {
    if (on && pop.isOpen) pop.close();
    direct = directPin(on, why);
    set(value);
  }

  hold(down, () => set(value - step), clock);
  hold(up, () => set(value + step), clock);

  set(value);
  return {
    set: (v) => set(v),
    step: (dir) => set(value + dir * step),
    setFixed,
    setDirect,
    view: (fn) => {
      views.push(fn);
      fn(shown.level, shown.txt, shown.fixed);
    },
  };
}

/**
 * The engine-row popover: heading with the big level, the slider over its loudness marks, the scale. Drops from the
 * readout; `onInput` gets each slider move (dB).
 * @param {HTMLElement} plate
 * @param {HTMLButtonElement} readout
 * @param {{value:number,min:number,max:number,step:number,scale:number[]}} cfg
 * @param {EventTarget} [bus]
 * @param {object} [loud]
 * @param {(v:number) => void} onInput
 */
function volumePanel(plate, readout, cfg, bus, loud, onInput) {
  const { min, max, step, value } = cfg;
  const big = h("span.v");
  const slider = h("input", {
    type: "range",
    min,
    max,
    step,
    value,
    "aria-label": "Playback volume",
    on: { input: (e) => onInput(Number(e.target.value)) },
  });
  const panel = h(
    "div.pop.vpop#vpop",
    { role: "dialog", "aria-label": "Playback volume" },
    h("div.vh", {}, h("span.eng", { text: "Playback volume" }), big),
    h("div.vsl", {}, slider, loudMarks(cfg, loud, bus)),
    scaleMarks(cfg),
  );
  plate.append(panel);

  const pop = popover({
    trigger: readout,
    panel,
    onToggle(open) {
      if (!open) return;
      // Drop from the readout, right edge flush with the whole − / readout / + group (= the page's right edge).
      const group = readout.parentElement;
      const r = toPlate(readout.getBoundingClientRect());
      const right = toPlate(group.getBoundingClientRect()).x + group.offsetWidth;
      panel.style.left = Math.round(Math.min(right, PLATE_W - 22) - panel.offsetWidth) + "px";
      panel.style.top = Math.round(r.y + readout.offsetHeight + 8) + "px";
      slider.focus();
    },
  });
  return { big, slider, pop };
}

/**
 * Loudness bounds over a volume slider, in the Range bar's grammar: ( … ) at the bounds, a strip under the track between
 * them. Shown only while loudness is in effect (`loud.on`); follows the Loudness drawer's Apply ('loudness' on the bus).
 * Bounds outside the slider's range clamp to its ends.
 */
function loudMarks(cfg, loud, bus) {
  const box = h("div.lmk", { "aria-hidden": "true" });
  if (!loud) return box;
  const paren = (d) => s("svg.lp", { viewBox: "0 0 10 18", width: 10, height: 18 }, s("path", { d }));
  const draw = () => {
    box.hidden = !loud.on;
    if (!loud.on) return box.replaceChildren();
    const { lo, hi, width } = loudSpan(loud.low, loud.high, cfg); // model/volume.js: clamped to the slider's ends
    box.title = "";
    box.replaceChildren(
      h("span.lband", { style: `left:${lo}%;width:${width}%` }),
      h("span.lpw", { style: `left:${lo}%` }, paren("M8,1 Q2,9 8,17")),
      h("span.lpw.r", { style: `left:${hi}%` }, paren("M2,1 Q8,9 2,17")),
    );
  };
  bus?.addEventListener("loudness", draw);
  draw();
  return box;
}

/**
 * ± press: one step per click; holding repeats after HOLD_DELAY. A hold already stepped, so its trailing click is ignored.
 * @param {HTMLButtonElement} btn
 * @param {() => void} stepOnce
 * @param {import('../../lib/shell/clock.js').Clock} clock
 */
function hold(btn, stepOnce, clock) {
  const idle = () => false;
  let stop = idle;
  const end = () => {
    stop();
  };
  btn.addEventListener("pointerdown", () => {
    stop = holdRepeat(
      () => {
        stepOnce();
        if (btn.disabled) end();
      },
      clock,
      HOLD_DELAY,
      HOLD_RATE,
    );
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, end);
  btn.addEventListener("click", () => {
    if (!stop()) stepOnce();
    stop = idle;
  });
}

/**
 * Bottom-bar volume (Visual settings → Bottom bar: Volume): engraved label, − , the full-width slider with the popover's
 * scale marks under it, the VFD readout, +. Same level, same live lane as the engine-row cluster it replaces.
 * @param {HTMLElement} host  .vbar
 * @param {{set:Function, step:Function, view:Function}} vol  mountVolume's api
 * @param {object} cfg  VOLUME
 * @param {EventTarget} [bus]
 * @param {object} [loud]
 * @param {import('../../lib/shell/clock.js').Clock} [clock]
 */
export function mountVolumeBar(host, vol, cfg, bus, loud, clock = PLATFORM) {
  const { min, max, step } = cfg;
  const down = h("button.round.vbtn", { type: "button", "aria-label": "Volume down", text: "−" });
  const up = h("button.round.vbtn", { type: "button", "aria-label": "Volume up", text: "+" });
  const slider = h("input", {
    type: "range",
    min,
    max,
    step,
    "aria-label": "Playback volume",
    on: { input: (e) => vol.set(Number(e.target.value)) },
  });
  const rd = h("span.v");
  host.append(
    h("span.vbt", { text: "Playback volume" }), // the page's engraved section-title grammar, not a small legend
    down,
    h("div.vbsl", {}, h("div.vsl", {}, slider, loudMarks(cfg, loud, bus)), scaleMarks(cfg)),
    up,
    h("div.vfd.vbrd", { role: "status", "aria-label": "Playback volume" }, rd),
  );
  hold(down, () => vol.step(-1), clock);
  hold(up, () => vol.step(1), clock);
  vol.view((v, txt, fixed) => {
    slider.value = v;
    rd.textContent = txt;
    const off = stepOff(v, fixed, cfg);
    slider.disabled = fixed;
    down.disabled = off.down;
    up.disabled = off.up;
    host.classList.toggle("fixed", fixed);
  });
}
