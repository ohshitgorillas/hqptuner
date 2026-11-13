// The stage dock's editors (Dock.js lays them out). Each answers the dock's parts for one stage: what it is, its
// values, and the copy that explains them. An edit hands the stage's next form to `put`; the arguments it keeps,
// seeds and drops are model/shell/pipelines-edit.js's.

import { html } from "../../../../lib/dom.js";
import { delayFields, gainSwitch, iirFields, retypeStage } from "../../../../model/shell/pipelines-edit.js";
import {
  ARG_NAME,
  ARG_UNIT,
  DELAY_ARGS,
  DELAY_FALLBACK,
  DELAY_NAME,
  DELAY_V,
  IIR_FALLBACK,
  IIR_TYPES,
  PMAN,
  WIDTH_HINT,
  WIDTH_NAME,
} from "./copy.js";
import { FileKey, NumBox, Seg, lab, paras, tline } from "./parts.js";

/** @typedef {import("../../../../model/shell/pipelines.js").Pipe} Pipe */
/** @typedef {import("../../../../model/shell/pipelines.js").Stage} Stage */
/** @typedef {ReturnType<typeof iirFields>} IirFields */
/** @typedef {IirFields["args"][number]} IirArg */
/** @typedef {(st: Stage) => void} Put  stage the edited stage's next form */
/** @typedef {{ currentTarget: { value: string } }} ChangeEv */

/**
 * One stage's dock: what it is (row 1), the right end of that row, its values (row 2), and the copy under them.
 *
 * @typedef {object} DockParts
 * @property {unknown[]} [what]
 * @property {unknown} [right]
 * @property {unknown[]} [values]
 * @property {unknown[]} copy
 */

/**
 * A stage without one argument.
 *
 * @param {Stage} st
 * @param {string} arg
 * @returns {Stage}
 */
const without = (st, arg) =>
  /** @type {Stage} */ ({ kind: st.kind, ...Object.fromEntries(Object.entries(st).filter(([k]) => k !== arg)) });

/** @param {string} x */
const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);

/**
 * The gain chip's dock: the gain and its unit (a switch carries the value over).
 *
 * @param {Pipe} p
 * @param {(gain: number, unit: string) => void} setGain
 * @param {boolean} off
 * @returns {DockParts}
 */
export function gainDock(p, setGain, off) {
  const units = [
    { v: "dB", label: "dB" },
    { v: "Lin", label: "Lin" },
  ];
  return {
    values: [
      html`
        <div class="pfield">
          ${lab("Gain")}
          <${NumBox} value=${p.gain} aria="Gain" width=${92} off=${off} testid="pl-gain" onCommit=${(/** @type {number} */ v) => setGain(v, p.unit)} />
          <${Seg}
            aria="Gain unit"
            cls="enum mini2"
            value=${p.unit}
            options=${units}
            off=${off}
            onChange=${(/** @type {string} */ u) => setGain(gainSwitch(p.gain, u), u)}
          />
        </div>
      `,
    ],
    copy: paras(PMAN.gain),
  };
}

/**
 * A RIAA stage's dock: its subsonic filter.
 *
 * @param {Stage} st
 * @param {Put} put
 * @param {boolean} off
 * @returns {DockParts}
 */
export function riaaDock(st, put, off) {
  const opts = [
    { v: "0", label: "Off" },
    { v: "1", label: "On" },
  ];
  return {
    values: [
      html`
        <div class="pfield">
          ${lab("Subsonic filter")}
          <${Seg}
            aria="subsonic"
            cls="mini2"
            value=${String(st.subsonic ?? 1)}
            options=${opts}
            off=${off}
            onChange=${(/** @type {string} */ v) => put({ ...st, subsonic: Number(v) })}
          />
        </div>
      `,
    ],
    copy: paras(PMAN.riaa),
  };
}

/**
 * A file stage's dock (convolution, a PEQ file): its file and Upload, which replaces it.
 *
 * @param {Stage} st
 * @param {((files: File[]) => void) | null} upload  null when the stage is read locked
 * @param {boolean} off
 * @param {string} said  what the last upload answered
 * @returns {DockParts}
 */
export function fileDock(st, upload, off, said) {
  const isTxt = /\.txt$/i.test(st.file ?? "");
  return {
    values: [
      html`
        <div class="pfield">
          ${lab("File")}
          <span class="vfd pfile">${st.file || "—"}</span>
          ${upload ? html`<${FileKey} label="Upload…" accept=".wav,.txt" off=${off} onFiles=${upload} />` : null}
        </div>
      `,
    ],
    copy: [...paras(isTxt ? PMAN.peqFile : PMAN.conv), said ? html`<p class="phint">${said}</p>` : null],
  };
}

/**
 * The manual's argument line for an iir type: each argument with its name, the width's either/or joined by OR.
 *
 * @param {import("./copy.js").IirType} def
 * @returns {string}
 */
function argLine(def) {
  if (def.t === "biquad") return "b0=b0 b1=b1 b2=b2 a0=a0 a1=a1 a2=a2";
  const name = (/** @type {string} */ a) => `${a}=${ARG_NAME[a]}`;
  const width = def.alt.length ? def.alt.map(name).join(" OR ") : null;
  return [name(def.args[0]), width, ...def.args.slice(1).map(name)].filter(Boolean).join(" ");
}

/**
 * One iir argument's field; the width argument as "Width [n] as [Q | Bandwidth]" when it can be given two ways.
 *
 * @param {{ st: Stage, f: IirFields, put: Put, off: boolean }} ed  the stage, its fields, its edit, its gray
 * @param {IirArg} arg
 */
function iirField({ st, f, put, off }, { arg: a, value, switchable }) {
  const { def, alt } = f;
  const box = html`<${NumBox}
    value=${value}
    aria=${ARG_NAME[a] || a}
    width=${def.t === "biquad" ? 60 : 72}
    off=${off}
    onCommit=${(/** @type {number} */ v) => put({ ...st, [a]: v })}
  />`;
  if (switchable) {
    const swap = (/** @type {string} */ v) => put({ ...without(st, alt), [v]: st[alt] ?? (v === "s" ? 1 : 0.707) });
    return html`
      <div class="pfield">
        ${lab(f.hint === "bw" ? "Width" : "Steepness")} ${box} ${lab("as")}
        <${Seg}
          aria="Set as"
          cls="enum mini2"
          value=${alt}
          options=${def.alt.map((x) => ({ v: x, label: WIDTH_NAME[x] }))}
          off=${off}
          onChange=${swap}
        />
      </div>
    `;
  }
  const name = def.t === "biquad" ? a : a === alt ? WIDTH_NAME[a] : cap(ARG_NAME[a] || a);
  return html`
    <label class="pfield">${lab(name)} ${box} ${ARG_UNIT[a] ? html`<span class="u">${ARG_UNIT[a]}</span>` : null}</label>
  `;
}

/**
 * An iir stage's editor: its type picker, its argument fields, the width hint and its manual line.
 *
 * @param {Stage} st
 * @param {Put} put
 * @param {boolean} off
 */
export function iirEditor(st, put, off) {
  const f = iirFields(st, IIR_TYPES, IIR_FALLBACK);
  const type = html`
    <select
      class="vfd ptype"
      aria-label="Filter type"
      disabled=${off}
      onChange=${(/** @type {ChangeEv} */ e) => put(retypeStage(st, e.currentTarget.value, IIR_TYPES))}
    >
      ${IIR_TYPES.map((x) => html`<option value=${x.t} selected=${x.t === st.type}>${x.d}: ${x.t}</option>`)}
    </select>
  `;
  const hint = f.hint ? WIDTH_HINT[f.hint] : "";
  return {
    type,
    values: f.args.map((x) => iirField({ st, f, put, off }, x)),
    copy: [hint ? html`<p class="phint">${hint}</p>` : null, tline(f.def.t, `${argLine(f.def)}. ${PMAN.iirUnits}`)],
  };
}

/**
 * A delay stage's editor: the unit it is given in, its value (and the speed of sound for a distance), their manual
 * lines.
 *
 * @param {Stage} st
 * @param {Put} put
 * @param {boolean} off
 */
export function delayEditor(st, put, off) {
  const { cur, value, speed } = delayFields(st, DELAY_ARGS, DELAY_FALLBACK);
  const regive = (/** @type {string} */ v) => {
    const kept = without(st, cur.a);
    put({ ...(v === "d" ? kept : without(kept, "v")), [v]: st[cur.a] ?? 0 });
  };
  const unit = html`<${Seg}
    aria="Delay given in"
    cls="enum mini2"
    value=${cur.a}
    options=${DELAY_ARGS.map((x) => ({ v: x.a, label: DELAY_NAME[x.a] }))}
    off=${off}
    onChange=${regive}
  />`;
  const values = [
    html`
      <label class="pfield">
        ${lab("Delay")}
        <${NumBox} value=${value} aria=${cur.d} width=${92} off=${off} onCommit=${(/** @type {number} */ v) => put({ ...st, [cur.a]: v })} />
        <span class="u">${cur.unit}</span>
      </label>
    `,
    speed === null
      ? null
      : html`
          <label class="pfield">
            ${lab("Speed of sound")}
            <${NumBox} value=${speed} aria=${DELAY_V.d} width=${92} off=${off} onCommit=${(/** @type {number} */ v) => put({ ...st, v })} />
            <span class="u">m/s</span>
          </label>
        `,
  ].filter(Boolean);
  const lines = speed === null ? [cur] : [cur, DELAY_V];
  return { unit, values, copy: lines.map((x) => tline(x.a, x.d)) };
}
