// The Station builder's borrowed tables, read at mount from the drawers that own them (one home per setting; the builder
// borrows the paragraph and the option lines).

import { rowsOf, rowOf } from "../../../../model/builders/schema.js";
import { OUTPUT_DRAWER, RATE_TIERS } from "../../../../data/stages/output.js";
import { VOLUME_DRAWER } from "../../../../data/stages/volume.js";
import { HARDWARE_DRAWER } from "../../../../data/settings/hardware.js";

/** @typedef {{ v: string, label: string, man?: string }} RowOption  an option line a row's control offers */
/** @typedef {{ id?: string, options?: RowOption[] }} RowControl */
/** @typedef {{ label: string, man: string, control: RowControl }} ManRow  a drawer row whose manual copy is one paragraph */
/** @typedef {{ label: string, man: { k: string, text: string }[] }} KeyedRow  a drawer row whose manual copy is keyed */
/**
 * @template R
 * @typedef {import('../../../../model/builders/schema.js').Drawer<R>} Drawer
 */
/** @typedef {ReturnType<typeof stationTables>} Tables */

const OUTPUT = /** @type {Drawer<ManRow>} */ (OUTPUT_DRAWER);
const OUTPUT_KEYED = /** @type {Drawer<KeyedRow>} */ (OUTPUT_DRAWER);
const VOLUME = /** @type {Drawer<ManRow>} */ (VOLUME_DRAWER);
const HARDWARE = /** @type {Drawer<ManRow>} */ (HARDWARE_DRAWER);

/**
 * The row labelled `label` (inside `group` when one is named); every row the builder borrows is there.
 *
 * @template {{ label?: string }} R
 * @param {Drawer<R>} drawer
 * @param {string} label
 * @param {string} [group]
 * @returns {R}
 */
const rowIn = (drawer, label, group) => /** @type {R} */ (rowOf(drawer, label, group));

/**
 * The option line valued `v`; every line the builder borrows is there.
 *
 * @param {RowOption[]} options
 * @param {string} v
 * @returns {RowOption}
 */
const optionIn = (options, v) => /** @type {RowOption} */ (options.find((x) => x.v === v));

/** Manual copy, option lines and rate tiers the steps read. */
export function stationTables() {
  const MAN = {
    netDevice: rowIn(OUTPUT, "Output device", "network").man,
    alsaDevice: rowIn(OUTPUT, "Output device", "alsa").man,
    discovery: rowIn(OUTPUT, "Discovery", "network").man,
    rate: rowIn(OUTPUT_KEYED, "Rate").man[0].text,
    dsd: rowIn(OUTPUT, "DSD support", "network").man,
    dsd48: rowIn(OUTPUT, "DSD rates", "network").man,
    bits: rowIn(OUTPUT, "DAC bits", "network").man,
  };
  const FIXED = /** @type {RowOption[]} */ (rowIn(VOLUME, "Fixed volume").control.options); // Off / Manual / Auto lines: their manual copy
  const VMAN = {
    off: optionIn(FIXED, "off").man,
    iso: optionIn(FIXED, "auto").man,
    gain: rowIn(VOLUME, "PCM gain compensation").man,
  };
  /** @type {Record<string, ManRow>} */
  const HW = Object.fromEntries(rowsOf(HARDWARE).map((r) => [r.control.id ?? r.label, r]));
  const HWMAN = { cuda: HW.cuda.man, devs: HW["CUDA devices"].man, ecores: HW.ecores.man, multicore: HW.multicore.man };
  return {
    MAN,
    VMAN,
    HW,
    HWMAN,
    TIERS: RATE_TIERS.tiers,
    DSD_OPTS: /** @type {RowOption[]} */ (rowIn(OUTPUT, "DSD support", "network").control.options),
    DSD48_OPTS: /** @type {RowOption[]} */ (rowIn(OUTPUT, "DSD rates", "network").control.options),
    DISCOVERY: /** @type {RowOption[]} */ (rowIn(OUTPUT, "Discovery", "network").control.options),
  };
}
