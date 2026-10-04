// The Station builder's borrowed tables, read at mount from the drawers that own them (one home per setting; the builder
// borrows the paragraph and the option lines).

import { rowsOf, rowOf } from "../../../../model/builders/schema.js";
import { OUTPUT_DRAWER, RATE_TIERS } from "../../../../data/stages/output.js";
import { VOLUME_DRAWER } from "../../../../data/stages/volume.js";
import { HARDWARE_DRAWER } from "../../../../data/shell/settings.js";

/** Manual copy, option lines and rate tiers the steps read. */
export function stationTables() {
  const MAN = {
    netDevice: rowOf(OUTPUT_DRAWER, "Output device", "network").man,
    alsaDevice: rowOf(OUTPUT_DRAWER, "Output device", "alsa").man,
    discovery: rowOf(OUTPUT_DRAWER, "Discovery", "network").man,
    rate: rowOf(OUTPUT_DRAWER, "Rate").man[0].text,
    dsd: rowOf(OUTPUT_DRAWER, "DSD support", "network").man,
    dsd48: rowOf(OUTPUT_DRAWER, "DSD rates", "network").man,
    bits: rowOf(OUTPUT_DRAWER, "DAC bits", "network").man,
  };
  const FIXED = rowOf(VOLUME_DRAWER, "Fixed volume").control.options; // Off / Manual / Auto lines: their manual copy
  const VMAN = {
    off: FIXED.find((x) => x.v === "off").man,
    iso: FIXED.find((x) => x.v === "auto").man,
    gain: rowOf(VOLUME_DRAWER, "PCM gain compensation").man,
  };
  const HW = Object.fromEntries(rowsOf(HARDWARE_DRAWER).map((r) => [r.control.id ?? r.label, r]));
  const HWMAN = { cuda: HW.cuda.man, devs: HW["CUDA devices"].man, ecores: HW.ecores.man, multicore: HW.multicore.man };
  return {
    MAN,
    VMAN,
    HW,
    HWMAN,
    TIERS: RATE_TIERS.tiers,
    DSD_OPTS: rowOf(OUTPUT_DRAWER, "DSD support", "network").control.options,
    DSD48_OPTS: rowOf(OUTPUT_DRAWER, "DSD rates", "network").control.options,
    DISCOVERY: rowOf(OUTPUT_DRAWER, "Discovery", "network").control.options,
  };
}
