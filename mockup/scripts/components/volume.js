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

import { h, s } from '../lib/dom.js';
import { popover } from '../lib/popover.js';
import { toPlate, PLATE_W } from '../lib/plate.js';
import { PLATFORM } from '../lib/clock.js';
import { holdRepeat } from '../model/timing.js';

const HOLD_DELAY = 400;   // ms before a held ± starts repeating
const HOLD_RATE = 70;     // ms between repeats

const fmt = (v) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + ' dB';

/**
 * @param {HTMLElement} plate
 * @param {{down:HTMLButtonElement, readout:HTMLButtonElement, up:HTMLButtonElement}} ctl  engine-row controls
 * @param {HTMLButtonElement} stage  rail Volume stage (its .v mirrors the level)
 * @param {{value:number,min:number,max:number,step:number,scale:number[]}} cfg
 * @param {EventTarget} [bus]  gets a 'level' event (detail = dB) on every change (Range bar needle)
 * @param {object} [loud]
 * @param {import('../lib/clock.js').Clock} [clock]
 */
export function mountVolume(plate, { down, readout, up }, stage, cfg, bus, loud, clock = PLATFORM) {
  let value = cfg.value;
  let fixedSet = null;   // Fixed volume as applied: null = adjustable; else {level, level_txt, text}
  let direct = null;  // Direct SDM playing: {level, level_txt, text}, over fixed
  const { min, max, step } = cfg;
  const pct = (v) => ((v - min) / (max - min)) * 100;

  const big = h('span.v');
  const slider = h('input', {
    type: 'range', min, max, step, value, 'aria-label': 'Playback volume',
    on: { input: (e) => set(Number(e.target.value)) },
  });
  const panel = h('div.pop.vpop#vpop', { role: 'dialog', 'aria-label': 'Playback volume' },
    h('div.vh', {}, h('span.eng', { text: 'Playback volume' }), big),
    h('div.vsl', {}, slider, loudMarks(cfg, loud, bus)),
    h('div.scale', { 'aria-hidden': 'true' },
      cfg.scale.map((m) => h('span', { style: `left:${pct(m)}%`, text: m === max ? `${m} dB` : fmt(m).replace(/\.0 dB$/, '') })),
    ),
  );
  plate.append(panel);

  const pop = popover({
    trigger: readout, panel,
    onToggle(open) {
      if (!open) return;
      // Drop from the readout, right edge flush with the whole − / readout / + group (= the page's right edge).
      const group = readout.parentElement;
      const r = toPlate(readout.getBoundingClientRect());
      const right = toPlate(group.getBoundingClientRect()).x + group.offsetWidth;
      panel.style.left = Math.round(Math.min(right, PLATE_W - 22) - panel.offsetWidth) + 'px';
      panel.style.top = Math.round(r.y + readout.offsetHeight + 8) + 'px';
      slider.focus();
    },
  });

  const views = [];   // other homes of the level (bottom bar): fn(value, txt, fixed)
  function set(v) {
    const fixed = direct || fixedSet;
    readout.title = direct ? direct.why : '';
    if (!fixed) value = Math.min(max, Math.max(min, Math.round(v / step) * step));
    // The mode word (`Manual:` / `Auto:`) lives on the rail only; the windows show the level alone.
    const txt = fixed ? fixed.level_txt : fmt(value);
    readout.querySelector('.v').textContent = txt;
    readout.classList.toggle('fixed', !!fixed);
    readout.disabled = !!fixed;   // nothing to slide: the popover stays shut
    big.textContent = txt;
    slider.value = fixed ? fixed.level : value;
    slider.disabled = !!fixed;
    stage.querySelector('.v').textContent = fixed ? fixed.text : txt;
    down.disabled = !!fixed || value <= min;
    up.disabled = !!fixed || value >= max;
    for (const fn of views) fn(fixed ? fixed.level : value, txt, !!fixed);
    bus?.dispatchEvent(new CustomEvent('level', { detail: fixed ? fixed.level : value }));
  }

  /** Fixed volume (Volume drawer → Fixed volume, applied): 'off' | 'manual' (level, dBFS) | 'auto' (iso '1' = −3, '2' = −6). */
  function setFixed(mode, level, iso) {
    if (pop.isOpen) pop.close();
    if (mode === 'manual') { const l = Number(level); fixedSet = { level: l, level_txt: fmt(l), text: `Manual: ${fmt(l)}` }; }
    else if (mode === 'auto') { const l = iso === '2' ? -6 : -3, lt = fmt(l).replace('.0 dB', ' dB'); fixedSet = { level: l, level_txt: lt, text: `Auto: ${lt}` }; }
    else fixedSet = null;
    set(value);
  }

  /** Direct SDM playing (mock scenario): volume bypassed, PCM volume pinned at −3 dBFS. why = v1's gray reason. */
  function setDirect(on, why) {
    if (on && pop.isOpen) pop.close();
    direct = on ? { level: -3, level_txt: fmt(-3), text: `Direct: ${fmt(-3)}`, why } : null;
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
    view: (fn) => { views.push(fn); const fixed = direct || fixedSet; fn(fixed ? fixed.level : value, fixed ? fixed.level_txt : fmt(value), !!fixed); },
  };
}

/**
 * Loudness bounds over a volume slider, in the Range bar's grammar: ( … ) at the bounds, a strip under the track between
 * them. Shown only while loudness is in effect (`loud.on`); follows the Loudness drawer's Apply ('loudness' on the bus).
 * Bounds outside the slider's range clamp to its ends.
 */
function loudMarks(cfg, loud, bus) {
  const box = h('div.lmk', { 'aria-hidden': 'true' });
  if (!loud) return box;
  const pct = (v) => Math.min(100, Math.max(0, ((v - cfg.min) / (cfg.max - cfg.min)) * 100));
  const paren = (d) => s('svg.lp', { viewBox: '0 0 10 18', width: 10, height: 18 }, s('path', { d }));
  const draw = () => {
    box.hidden = !loud.on;
    if (!loud.on) return box.replaceChildren();
    const lo = pct(loud.low), hi = pct(loud.high);
    box.title = '';
    box.replaceChildren(
      h('span.lband', { style: `left:${lo}%;width:${hi - lo}%` }),
      h('span.lpw', { style: `left:${lo}%` }, paren('M8,1 Q2,9 8,17')),
      h('span.lpw.r', { style: `left:${hi}%` }, paren('M2,1 Q8,9 2,17')),
    );
  };
  bus?.addEventListener('loudness', draw);
  draw();
  return box;
}

/**
 * ± press: one step per click; holding repeats after HOLD_DELAY. A hold already stepped, so its trailing click is ignored.
 * @param {HTMLButtonElement} btn
 * @param {() => void} stepOnce
 * @param {import('../lib/clock.js').Clock} clock
 */
function hold(btn, stepOnce, clock) {
  const idle = () => false;
  let stop = idle;
  const end = () => { stop(); };
  btn.addEventListener('pointerdown', () => {
    stop = holdRepeat(() => { stepOnce(); if (btn.disabled) end(); }, clock, HOLD_DELAY, HOLD_RATE);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, end);
  btn.addEventListener('click', () => { if (!stop()) stepOnce(); stop = idle; });
}

/**
 * Bottom-bar volume (Visual settings → Bottom bar: Volume): engraved label, − , the full-width slider with the popover's
 * scale marks under it, the VFD readout, +. Same level, same live lane as the engine-row cluster it replaces.
 * @param {HTMLElement} host  .vbar
 * @param {{set:Function, step:Function, view:Function}} vol  mountVolume's api
 * @param {object} cfg  VOLUME
 * @param {EventTarget} [bus]
 * @param {object} [loud]
 * @param {import('../lib/clock.js').Clock} [clock]
 */
export function mountVolumeBar(host, vol, cfg, bus, loud, clock = PLATFORM) {
  const { min, max, step } = cfg;
  const pct = (v) => ((v - min) / (max - min)) * 100;
  const down = h('button.round.vbtn', { type: 'button', 'aria-label': 'Volume down', text: '−' });
  const up = h('button.round.vbtn', { type: 'button', 'aria-label': 'Volume up', text: '+' });
  const slider = h('input', { type: 'range', min, max, step, 'aria-label': 'Playback volume', on: { input: (e) => vol.set(Number(e.target.value)) } });
  const rd = h('span.v');
  host.append(
    h('span.vbt', { text: 'Playback volume' }),   // the page's engraved section-title grammar, not a small legend
    down,
    h('div.vbsl', {}, h('div.vsl', {}, slider, loudMarks(cfg, loud, bus)), h('div.scale', { 'aria-hidden': 'true' },
      cfg.scale.map((m) => h('span', { style: `left:${pct(m)}%`, text: m === max ? `${m} dB` : fmt(m).replace(/\.0 dB$/, '') })))),
    up,
    h('div.vfd.vbrd', { role: 'status', 'aria-label': 'Playback volume' }, rd),
  );
  hold(down, () => vol.step(-1), clock);
  hold(up, () => vol.step(1), clock);
  vol.view((v, txt, fixed) => {
    slider.value = v; rd.textContent = txt;
    slider.disabled = fixed; down.disabled = fixed || v <= min; up.disabled = fixed || v >= max;
    host.classList.toggle('fixed', fixed);
  });
}

