// The page Output section's store half: one column per tier of the running band, each with its two exact rates, the rate
// playing and the pin marked; a pin on one exact rate, and Auto clearing it. The DOM half is
// components/faceplate/page/OutputPins.js.
//
// The tiers are the Output drawer's dial (store/faceplate/drawers/output.js), so the hatch a device puts on a tier is
// the same on both. The running band is the chain running now (store/faceplate/path.js): the engine's rate list is the
// running mode's, so the other band has nothing to pin. A rate is offered only while that list carries it, since the
// live lane resolves a pin to the list's index and refuses a rate the list lacks (lanes/live/rate.py). The pin is read
// off the engine (store/live/pin.js), never held here.

import { engineStatus, enums } from "../../signals.js";
import { TIER, TWIN_44K } from "../../schema/options.js";
import { pinnedRate, pinRate } from "../../live/pin.js";
import { dialView } from "../drawers/output.js";
import { playbackPath, runningChain } from "../path.js";
import { tunerColumns } from "../../../model/gauges/output.js";

/** @typedef {import("../drawers/output.js").DialTier} DialTier */
/** @typedef {"f44" | "f48"} Fam */

/**
 * One exact rate of a tier: its family, its frequency as the column prints it and in Hz, whether the engine's rate list
 * carries it, and the marks.
 *
 * @typedef {object} PinCell
 * @property {Fam} fam
 * @property {string} label
 * @property {number} hz
 * @property {boolean} offered
 * @property {boolean} pinned
 * @property {boolean} playing
 */

/**
 * One tier of the running band: its position on the dial, its name and unit, whether the device cannot carry it, and
 * its two rates, 44.1k family first.
 *
 * @typedef {object} PinColumn
 * @property {number} i
 * @property {string} name
 * @property {string} unit
 * @property {boolean} unavailable
 * @property {PinCell[]} cells
 */

/** The families in display order. @type {Fam[]} */
const FAMS = ["f44", "f48"];

/**
 * The exact rate in Hz of one member of a tier.
 *
 * @param {DialTier} tier
 * @param {Fam} fam
 */
const memberHz = (tier, fam) => Number(fam === "f48" ? tier.value : TWIN_44K[tier.value]);

/**
 * Where a rate sits on the dial: its tier's position and its family; null for a rate on no tier.
 *
 * @param {DialTier[]} tiers
 * @param {number} hz
 * @returns {{ tier: number, fam: Fam } | null}
 */
function placeOf(tiers, hz) {
  const base = TIER[String(hz)];
  const tier = base ? tiers.findIndex((t) => t.value === base) : -1;
  return tier < 0 ? null : { tier, fam: base === String(hz) ? "f48" : "f44" };
}

/** The rates the engine's list carries, in Hz, auto left out. */
function listed() {
  /** @type {{ rates?: { rate: string }[] }} */
  const lists = enums.value || {};
  return new Set((lists.rates || []).map((r) => Number(r.rate)).filter((hz) => hz > 0));
}

/**
 * The columns the section draws: each tier of the running band with its two exact rates, the rate playing marked while
 * a source plays, the pin marked where it sits, and a rate offered only on a tier the device carries and while the
 * engine's list holds it.
 *
 * @returns {PinColumn[]}
 */
export function pinColumns() {
  const { tiers } = dialView();
  const status = (engineStatus.value || {}).status || {};
  const active = placeOf(tiers, Number(status.active_rate));
  const pin = placeOf(tiers, pinnedRate.value);
  const now = {
    run: runningChain(),
    tier: active ? active.tier : null,
    src: active && playbackPath() !== "idle" ? active.tier : null,
    fam: active ? active.fam : "f44",
  };
  const carried = listed();
  return tunerColumns(tiers, now, pin, FAMS).map(({ i, unavailable, cells }) => {
    const tier = tiers[i];
    return {
      i,
      name: tier.name,
      unit: tier.unit,
      unavailable,
      cells: cells.map((c) => {
        const fam = /** @type {Fam} */ (c.fam);
        const hz = memberHz(tier, fam);
        return { ...c, fam, label: tier[fam], hz, offered: !unavailable && carried.has(hz) };
      }),
    };
  });
}

/**
 * Pin the exact rate of tier `i` in family `fam`: only a rate the section offers, and not the one already pinned.
 *
 * @param {number} i
 * @param {Fam} fam
 * @returns {Promise<void>}
 */
export async function pinTier(i, fam) {
  const cell = pinColumns()
    .find((c) => c.i === i)
    ?.cells.find((c) => c.fam === fam);
  if (!cell || !cell.offered || cell.pinned) return;
  await pinRate(cell.hz);
}

/**
 * Clear a standing pin, handing the rate back to the engine's automatic choice.
 *
 * @returns {Promise<void>}
 */
export async function pinAuto() {
  if (pinnedRate.value === 0) return;
  await pinRate(0);
}
