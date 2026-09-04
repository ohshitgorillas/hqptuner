// The filter primer's controls, beneath the two panes: the readout row first,
// then source rate, output rate and phase as segments; length, roll-off and
// transient as sliders, each with snap chips that light while the number box
// beside them reads that chip's own figure; and the content toggles at the
// rates that have room above 20 kHz for junk (docs/plans/filter-primer-graph.md).
//
// The readouts lead the block rather than closing it: the content row exists
// only above 44.1 kHz, so a readout row beneath it moved 67 px every time the
// source rate crossed that line, and the numbers belong beside the graph they
// read in any case.
//
// Every control writes one signal of store/primergraph.js and nothing else;
// the shared primitives from ../controls/index.js are used as they are, so
// the row reads like the app's other instrument cards.
import { html } from "../../lib/dom.js";
import { Checkbox, Segment, SliderNumber } from "../controls/index.js";
import { fmt3, fmtKhz } from "./frame.js";
import {
  LENGTH_CHIPS,
  NOS,
  RATES,
  ROLLOFF_CHIPS,
  TRANSIENT_CHIPS,
  content,
  lengthMs,
  outputFactorOf,
  outputFactors,
  outputRateFor,
  outputRate,
  phase,
  rate,
  readouts,
  rolloff,
  setRate,
  transientUs,
} from "../../store/primergraph.js";

/** Below this source rate there is no band above 20 kHz for content to sit in. */
const CONTENT_MIN_RATE = 96000;

const RATE_OPTIONS = RATES.map((hz) => ({ value: hz, label: `${hz / 1000}k` }));

/**
 * The output rate segment's options at a source rate. The factors are the
 * source rate's own, so the segment is rebuilt as the rate changes.
 * @param {number} hz
 */
const outputOptions = (hz) => outputFactors(hz).map((f) => ({ value: f, label: f === NOS ? "NOS" : `${f}x` }));
const PHASE_OPTIONS = [
  { value: "linear", label: "Linear" },
  { value: "minimum", label: "Minimum" },
];
/** @type {{ key: keyof import("../../store/primergraph.js").Content, label: string }[]} */
const CONTENT_ROWS = [
  { key: "spurs", label: "HF spurs" },
  { key: "fakeHires", label: "Fake hi-res" },
  { key: "risingNoise", label: "Rising HF noise" },
];

/** @param {string} name */
const title = (name) => name[0].toUpperCase() + name.slice(1);

/**
 * A slider bound to one store signal, with its chips. The chip segment's value
 * is the chip the number box reads as, else none.
 * @param {{ id: string, label: string, value: number, onSet: (n: number) => void, chips: Record<string, number>,
 *   min: number, max: number, step?: number | string, boxStep?: number | string, unit?: string, scale?: string }} props
 */
function SliderRow({ id, label, value, onSet, chips, min, max, step, boxStep, unit, scale }) {
  const names = Object.keys(chips);
  // A chip lights when the box beside it reads that chip's own figure, not when
  // the signal equals it exactly. A log-scaled track works in log space, so
  // dragging the thumb onto the 8 ms tick returns 7.999999999999998 and exact
  // equality left the chip dark under a box already reading 8. Comparing what
  // the two DISPLAY ties the lit chip to what the reader can see, and stays
  // tight where a fixed tolerance would not: 0.501 shows in full and lights
  // nothing.
  const shown = fmt3(value);
  const lit = names.find((n) => fmt3(chips[n]) === shown);
  // The slider's range is the range, and the number box does not enforce it: a
  // browser validates a typed value against `min`/`max` but still reports it,
  // so the row clamps here. `parseFloat` rather than `Number` because a number
  // input reports "" for a box that is empty AND for one holding text a browser
  // could not parse, and `Number("")` is 0 — a figure nobody typed, landing in
  // range. A value that is no number at all leaves the signal where it was.
  const set = (/** @type {string | number} */ v) => {
    const n = Number.parseFloat(String(v));
    if (Number.isNaN(n)) return;
    onSet(Math.min(max, Math.max(min, n)));
  };
  return html`
    <div class="primer-control" data-control=${id}>
      <label class="t-label">${label}</label>
      <${SliderNumber}
        anchor="min"
        scale=${scale}
        min=${min}
        max=${max}
        step=${step}
        boxStep=${boxStep}
        ticks=${Object.values(chips)}
        value=${value}
        unit=${unit}
        format=${fmt3}
        onChange=${set}
      />
      <div class="primer-chips" data-testid=${`primer-chips-${id}`}>
        <${Segment}
          value=${lit}
          options=${names.map((n) => ({ value: n, label: title(n) }))}
          onChange=${(/** @type {string | number} */ n) => set(chips[n])}
        />
      </div>
    </div>
  `;
}

function OutputRateControl() {
  const hz = rate.value;
  return html`
    <div class="primer-control" data-control="output">
      <label class="t-label">Output rate</label>
      <${Segment}
        value=${outputFactorOf(hz, outputRate.value)}
        options=${outputOptions(hz)}
        onChange=${(/** @type {string | number} */ v) => {
          outputRate.value = outputRateFor(hz, v);
        }}
      />
    </div>
  `;
}

function ContentRow() {
  return html`
    <div class="primer-control" data-testid="primer-content">
      <label class="t-label">Content</label>
      <div class="primer-toggles">
        ${CONTENT_ROWS.map(
          ({ key, label }) => html`
            <label class="primer-toggle">
              <${Checkbox}
                value=${content.value[key] ? "1" : "0"}
                onChange=${(/** @type {string | number} */ v) => {
                  content.value = { ...content.value, [key]: v === "1" };
                }}
              />
              ${label}
            </label>
          `,
        )}
      </div>
    </div>
  `;
}

/**
 * @param {number | null} v
 * @param {(n: number) => string} fmt
 */
const reading = (v, fmt) => (v === null ? "none" : fmt(v));

// One reading: its wire key, the word beside it, and the figure. The key is the
// marking a test finds the reading by, the way the frequency legend's rows carry
// `data-layer` and the Nyquist marks `data-mark`; nothing selects a reading by
// the word, which is copy.
function Readouts() {
  const r = readouts.value;
  const db = (/** @type {number} */ n) => `${Math.round(n)} dB`;
  // The output rate is a rate some source really produces, so it is named to the
  // nearest 10 Hz: three significant figures print 176.4 kHz as 176 and 352.8 as
  // 353, neither of which any source produces. The transition width and the
  // filter length are measured quantities rather than names, and keep the three
  // figures the box beside them shows.
  const rows = [
    ["output", "output", reading(r.outputKhz, (n) => `${fmtKhz(n * 1000)} kHz`)],
    ["taps", "taps", reading(r.taps, (n) => `${n}`)],
    ["length", "length", reading(r.lengthMs, (n) => `${fmt3(n)} ms`)],
    ["transition", "transition", reading(r.transitionKhz, (n) => `${fmt3(n)} kHz`)],
    ["attenuation", "attenuation", reading(r.attenuationDb, db)],
    ["ring-before", "ring before", reading(r.ringBeforeDb, db)],
    ["ring-after", "ring after", reading(r.ringAfterDb, db)],
  ];
  return html`
    <dl class="primer-readouts t-value">
      ${rows.map(
        ([k, label, v]) => html`
          <div class="primer-readout">
            <dt>${label}</dt>
            <dd data-readout=${k}>${v}</dd>
          </div>
        `,
      )}
    </dl>
  `;
}

/** The three segments in one row: source rate, output rate, phase. */
function Segments() {
  return html`
    <div class="primer-segments">
      <div class="primer-control" data-control="rate">
        <label class="t-label">Source rate (Hz)</label>
        <${Segment}
          value=${rate.value}
          options=${RATE_OPTIONS}
          onChange=${(/** @type {string | number} */ v) => setRate(Number(v))}
        />
      </div>
      <${OutputRateControl} />
      <div class="primer-control" data-control="phase">
        <label class="t-label">Phase</label>
        <${Segment}
          value=${phase.value}
          options=${PHASE_OPTIONS}
          onChange=${(/** @type {string | number} */ v) => {
            phase.value = String(v);
          }}
        />
      </div>
    </div>
  `;
}

/** The control block under the panes. */
export function PrimerControls() {
  return html`
    <div class="primer-controls">
      <${Readouts} />
      <${Segments} />
      <${SliderRow}
        id="length"
        label="Length"
        value=${lengthMs.value}
        onSet=${(/** @type {number} */ n) => {
          lengthMs.value = n;
        }}
        chips=${LENGTH_CHIPS}
        min=${0.1}
        max=${50}
        boxStep="any"
        unit="ms"
        scale="log"
      />
      <${SliderRow}
        id="rolloff"
        label="Roll-off"
        value=${rolloff.value}
        onSet=${(/** @type {number} */ n) => {
          rolloff.value = n;
        }}
        chips=${ROLLOFF_CHIPS}
        min=${0}
        max=${1}
        step=${0.01}
      />
      <${SliderRow}
        id="transient"
        label="Transient"
        value=${transientUs.value}
        onSet=${(/** @type {number} */ n) => {
          transientUs.value = n;
        }}
        chips=${TRANSIENT_CHIPS}
        min=${2}
        max=${50}
        boxStep="any"
        unit="µs"
        scale="log"
      />
      ${rate.value >= CONTENT_MIN_RATE ? html`<${ContentRow} />` : null}
    </div>
  `;
}
