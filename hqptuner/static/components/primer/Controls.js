// The filter primer's controls, beneath the two panes: source rate, output
// rate and phase as segments; length, roll-off and transient as sliders, each
// with snap chips that light only while the slider sits exactly on a chip
// value; the content toggles at the rates that have room above 20 kHz for
// junk; and the readout row (docs/plans/filter-primer-graph.md).
//
// Every control writes one signal of store/primergraph.js and nothing else;
// the shared primitives from ../controls/index.js are used as they are, so
// the row reads like the app's other instrument cards.
import { html } from "../../lib/dom.js";
import { Checkbox, Segment, SliderNumber } from "../controls/index.js";
import {
  FACTORS,
  LENGTH_CHIPS,
  RATES,
  ROLLOFF_CHIPS,
  TRANSIENT_CHIPS,
  content,
  familyBase,
  lengthMs,
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
const NOS = "nos";

const RATE_OPTIONS = RATES.map((hz) => ({ value: hz, label: `${hz / 1000}` }));
const OUTPUT_OPTIONS = [{ value: NOS, label: "NOS" }, ...FACTORS.map((n) => ({ value: n, label: `${n}x` }))];
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
 * @param {number} n
 * @returns {string}
 */
const sig3 = (n) => `${Number(n.toPrecision(3))}`;

/**
 * A slider bound to one store signal, with its chips. The chip segment's value
 * is the chip whose value the slider holds exactly, else none.
 * @param {{ id: string, label: string, value: number, onSet: (n: number) => void, chips: Record<string, number>,
 *   min: number, max: number, step?: number | string, boxStep?: number | string, unit?: string, scale?: string }} props
 */
function SliderRow({ id, label, value, onSet, chips, min, max, step, boxStep, unit, scale }) {
  const names = Object.keys(chips);
  const lit = names.find((n) => chips[n] === value);
  const set = (/** @type {string | number} */ v) => onSet(Number(v));
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
        format=${sig3}
        onChange=${set}
      />
      <div data-testid=${`primer-chips-${id}`}>
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
  const out = outputRate.value;
  const value = out === null ? NOS : Math.round(out / familyBase(rate.value));
  return html`
    <div class="primer-control" data-control="output">
      <label class="t-label">Output rate</label>
      <${Segment}
        value=${value}
        options=${OUTPUT_OPTIONS}
        onChange=${(/** @type {string | number} */ v) => {
          outputRate.value = v === NOS ? null : Number(v) * familyBase(rate.value);
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

function Readouts() {
  const r = readouts.value;
  const db = (/** @type {number} */ n) => `${Math.round(n)} dB`;
  const rows = [
    ["output", reading(r.outputKhz, (n) => `${sig3(n)} kHz`)],
    ["taps", reading(r.taps, (n) => `${n}`)],
    ["length", reading(r.lengthMs, (n) => `${sig3(n)} ms`)],
    ["transition", reading(r.transitionKhz, (n) => `${sig3(n)} kHz`)],
    ["attenuation", reading(r.attenuationDb, db)],
    ["ring before", reading(r.ringBeforeDb, db)],
    ["ring after", reading(r.ringAfterDb, db)],
  ];
  return html`
    <dl class="primer-readouts t-value">
      ${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}
    </dl>
  `;
}

/** The three segments in one row: source rate, output rate, phase. */
function Segments() {
  return html`
    <div class="primer-segments">
      <div class="primer-control" data-control="rate">
        <label class="t-label">Rate</label>
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
        min=${5}
        max=${2000}
        boxStep="any"
        unit="µs"
        scale="log"
      />
      ${rate.value >= CONTENT_MIN_RATE ? html`<${ContentRow} />` : null}
      <${Readouts} />
    </div>
  `;
}
