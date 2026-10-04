import { familyOf } from "../../drawers/drawer.js";
import { rowOf } from "../../../model/builders/schema.js";
import { homeOf } from "../../../model/builders/builder.js";
import { MATRIX_DRAWER, CORRECTION_DRAWER, CROSSFEED, LOUDNESS } from "../../../data/stages/matrix.js";

/** @typedef {import('../../../model/builders/builder.js').Ref} Ref */
/** @typedef {import('../../../model/builders/profile.js').Vals} Vals */
/** @typedef {import('../../../model/builders/profile.js').Meta} Meta */
/** @typedef {import('../../../model/builders/profile.js').Known} Known */
/** @typedef {import('../../../model/builders/profile.js').Presets} Presets */
/** @typedef {import('./values.js').Buffer} Buffer */
/** @typedef {import('../../../lib/builder/builder.js').Builder<ProfileRecord, Buffer>} Builder */
/** @typedef {ReturnType<typeof import('../autoeq.js').mountAutoEq>} AutoEq */
/** @typedef {import('../../../../../hqptuner/static/model/shell/pipelines.js').Pipe} Pipe */
/** @typedef {import('../../drawers/pipelines.js').Pipelines} Pipelines */
/** @typedef {import('../../drawers/drawer.js').DrawerApi} DrawerApi */
/** @typedef {import('../../drawers/drawer.js').Store} Store */
/** @typedef {import('../../drawers/drawer/registry.js').Family} Family */
/** @typedef {ReturnType<typeof import('../../../data/stages/pipelines.js').pipelineSet>} PipelineSet */
/** @typedef {import('../../../data/stages/output.js').Row} Row */
/** @typedef {import('../../../data/settings/common.js').Option} Option */

/** @typedef {{ name: string, active?: boolean }} Station  a station of the tree */
/** @typedef {{ desc: string, listen: string, vals: Vals }} ProfileRecord  a saved profile */
/**
 * A mock profile as data/builders/profiles.js holds it: only what differs from the applied matrix.
 *
 * @typedef {{ desc?: string, listen?: string, vals?: Vals, pipes?: (pipes: Pipe[]) => unknown }} ProfileSource
 */
/** @typedef {Row & { control: { value: string } }} MatrixRow  a drawer row the builder reads */
/** @typedef {MatrixRow & { optMan: NonNullable<Row['optMan']> }} OptRow  a row whose every option has its manual line */
/** @typedef {MatrixRow & { control: { options: Option[] } }} SelectRow */
/** @typedef {{ engine: OptRow, expand: MatrixRow, iir: OptRow, dcen: MatrixRow, dcdac: SelectRow }} Rows */
/** @typedef {{ el: HTMLElement, paint: (fold?: boolean) => void }} Choice  choice lines (parts.js choice) */
/** @typedef {{ label: string, man: string, el: HTMLElement, paint: () => void }} NumField  one value box (parts.js num) */
/** @typedef {{ el: HTMLElement, paint: () => void }} OptList  an engine row's option lines (advanced.js) */
/** @typedef {{ id: string, el: HTMLElement, a: HTMLElement }} HoldLine  one line of what the profile holds */

/**
 * The page's elements the builder lives in, and the bodies it swaps with.
 *
 * @typedef {object} Els
 * @property {HTMLElement} btn  the page's Profile builder button
 * @property {HTMLElement} chain  #body
 * @property {HTMLElement} body  #pbody
 * @property {HTMLElement} rail
 * @property {HTMLElement} page
 * @property {HTMLElement} plate
 * @property {{ setOn: (on: boolean) => void }} settings
 * @property {() => ({ setOn: (on: boolean, toChain: boolean) => void } | undefined)} snapshot  the Snapshot builder
 * @property {import('../../../lib/shell/bus.js').Bus} bus
 */

/**
 * What the page hands the builder.
 *
 * @typedef {object} Opts
 * @property {() => string} running  the profile the engine runs
 * @property {() => number} level
 * @property {EventTarget} levelBus
 * @property {() => boolean} fixed  Fixed volume is on
 * @property {(touched: [string, string[]][], rec?: ProfileRecord, name?: string, run?: boolean) => void} [onSaved]
 * @property {PipelineSet} pipelines  the page's pipeline set, shared with the chain
 */

/**
 * The Profile builder's state: its tables, the edit and the page's parts, shared by every file here.
 *
 * @typedef {object} PB
 * @property {Opts} o
 * @property {Station[]} stations
 * @property {HTMLElement} page
 * @property {Store} applied  the chain's applied matrix (what's loaded)
 * @property {Rows} R
 * @property {string} home  the loaded station
 * @property {Option[]} MODELS  the DAC models
 * @property {typeof CROSSFEED.man} M
 * @property {typeof LOUDNESS.man} LM
 * @property {Vals} LD  the loudness defaults
 * @property {Presets} presets
 * @property {Record<string, Record<string, ProfileRecord>>} records
 * @property {Meta} meta  the edit's name, stations, description and listening (its values live in the store)
 * @property {Known} known  "do you know your settings?" per step
 * @property {boolean} ready
 * @property {string} at  the page showing
 * @property {string} shape  what the showing step lays out: a change re-lays it out
 * @property {Builder} B
 * @property {HTMLSelectElement} pick
 * @property {HTMLInputElement} nameBox
 * @property {HTMLButtonElement} plBtn
 * @property {HTMLElement} plCount
 * @property {Pipelines} plCore
 * @property {DrawerApi} pl
 * @property {Family} fam
 * @property {Store} v  the edit's values (the family store)
 * @property {HoldLine[]} holdRows
 * @property {ReturnType<Builder['stationsMenu']>} stMenu
 * @property {HTMLTextAreaElement} desc
 * @property {ReturnType<Builder['buttons']>} acts
 * @property {HTMLElement} askHost
 * @property {HTMLElement} overview
 * @property {HTMLElement} listenSeg
 * @property {AutoEq} eq
 * @property {{ auto: HTMLElement, files: HTMLElement }} eqRows
 * @property {HTMLElement} eqOut
 * @property {Choice} xfSel
 * @property {Choice} xfKnown
 * @property {HTMLElement} bPre
 * @property {HTMLElement} sPre
 * @property {HTMLElement} bPreRow
 * @property {HTMLElement} sPreRow
 * @property {NumField[]} bNums
 * @property {NumField[]} sNums
 * @property {HTMLElement} dcSeg
 * @property {HTMLSelectElement} dcSel
 * @property {HTMLElement} ldSeg
 * @property {Choice} ldKnown
 * @property {NumField[]} ldNums
 * @property {HTMLElement} bGroup
 * @property {HTMLElement} sGroup
 * @property {HTMLElement} ldGroup
 * @property {HTMLElement} engSeg
 * @property {HTMLElement} hfSeg
 * @property {HTMLElement} iirSeg
 * @property {OptList} engList
 * @property {OptList} iirList
 */

// ── Records (mock: this component's copy) ───────────────────────────────
/**
 * A profile built here: it runs the matrix.
 *
 * @param {Vals} x
 * @returns {Vals}
 */
export const asProfile = (x) => ({ eqname: "", ...x, mxen: "1" }); // a profile built here runs the matrix
/**
 * The listening a profile's values imply.
 *
 * @param {Vals} vals
 * @returns {string}
 */
export const listenOf = (vals) => (vals.xfmode !== "off" ? "headphones" : "speakers");

/**
 * The builder's tables and its edit state as it opens; mountProfileBuilder adds the parts.
 *
 * @param {Station[]} stations
 * @param {Record<string, Record<string, ProfileSource>>} data
 * @param {Opts} o
 * @param {HTMLElement} page
 * @returns {PB}
 */
export function tablesOf(stations, data, o, page) {
  const applied = familyOf("matrix").base; // the chain's applied matrix (what's loaded)
  /** @type {Rows} */
  const R = {
    engine: /** @type {OptRow} */ (rowOf(MATRIX_DRAWER, "Engine")),
    expand: /** @type {MatrixRow} */ (rowOf(MATRIX_DRAWER, "Expand HF")),
    iir: /** @type {OptRow} */ (rowOf(MATRIX_DRAWER, "IIR to FIR")),
    dcen: /** @type {MatrixRow} */ (rowOf(CORRECTION_DRAWER, "DAC correction")),
    dcdac: /** @type {SelectRow} */ (rowOf(CORRECTION_DRAWER, "DAC model")),
  };
  return /** @type {PB} */ ({
    o,
    stations,
    page,
    applied,
    R,
    home: homeOf(stations),
    MODELS: R.dcdac.control.options,
    M: CROSSFEED.man,
    LM: LOUDNESS.man,
    LD: loudnessDefaults(),
    presets: { bauer: CROSSFEED.presets.filter((p) => p.v !== "custom"), structural: CROSSFEED.sPresets }, // bauer: the presets with fixed values
    records: recordsOf(stations, data, applied),
    // Opens on what's loaded: New profile from the running matrix (save it as it is, or change it).
    meta: /** @type {Meta | undefined} */ (undefined), // {name, stations, desc, listen} of the one being edited (its values live in the store)
    known: { crossfeed: "preset", loudness: "preset" }, // "do you know your settings?" per step
    ready: false,
    at: "overview",
    shape: "", // what the showing step lays out: a change re-lays it out (choice made, path changed)
  });
}

/**
 * Each station's profiles over what's loaded.
 *
 * @param {Station[]} stations
 * @param {Record<string, Record<string, ProfileSource>>} data
 * @param {Store} applied
 * @returns {Record<string, Record<string, ProfileRecord>>}
 */
function recordsOf(stations, data, applied) {
  return Object.fromEntries(
    stations.map((st) => [
      st.name,
      Object.fromEntries(
        Object.entries(data[st.name] ?? {}).map(([name, r]) => {
          const vals = asProfile({ ...applied, ...(r.vals ?? {}) });
          if (r.pipes) vals.mxpipes = JSON.stringify(r.pipes(JSON.parse(applied.mxpipes)));
          return [name, { desc: r.desc ?? "", listen: r.listen ?? listenOf(vals), vals }];
        }),
      ),
    ]),
  );
}

/** @returns {Vals} the loudness form's defaults */
const loudnessDefaults = () => ({
  ldlowtype: LOUDNESS.low.type,
  ldlowfreq: LOUDNESS.low.freq,
  ldlowsteep: LOUDNESS.low.steep,
  ldlowlevel: LOUDNESS.low.level,
  ldhightype: LOUDNESS.high.type,
  ldhighfreq: LOUDNESS.high.freq,
  ldhighsteep: LOUDNESS.high.steep,
  ldhighlevel: LOUDNESS.high.level,
  ldrlow: LOUDNESS.rangeLow,
  ldrhigh: LOUDNESS.rangeHigh,
});

/**
 * Start from scratch: the forms' defaults, the stereo pair with no processing.
 *
 * @param {Pick<PB, 'applied' | 'R' | 'LD'>} pb
 * @returns {Vals}
 */
export function scratchOf({ applied, R, LD }) {
  const pipes = /** @type {Pipe[]} */ (JSON.parse(applied.mxpipes))
    .filter((p) => !p.gen)
    .map((p) => ({ ...p, gain: p.src === p.mix ? 0 : p.gain, unit: "dB", stages: [] }));
  return asProfile({
    ...applied,
    mxpipes: JSON.stringify(pipes),
    eqname: "",
    xfgate: "0",
    xfmode: "off",
    xfimpl: "bauer",
    xfpreset: CROSSFEED.bauer.preset,
    xffreq: CROSSFEED.bauer.freq,
    xflevel: CROSSFEED.bauer.level,
    xfcomp: CROSSFEED.bauer.comp,
    xsangle: CROSSFEED.structural.angle,
    xscirc: CROSSFEED.structural.circ,
    xslambda: CROSSFEED.structural.lambda,
    dcen: "0",
    dcdac: "",
    ldon: "0",
    ...LD,
    mxengine: R.engine.control.value,
    mxexpand: R.expand.control.value,
    mxiir2fir: R.iir.control.value,
  });
}
