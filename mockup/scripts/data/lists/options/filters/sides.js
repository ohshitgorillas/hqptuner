// What the PCM and SDM option lists change on a filter family's shared entries (data/lists/derive.js).

import { TWO_STAGE } from "../../conversion-catalog.js";
import { AT_16X_FILTERS, at16x } from "../../derive.js";

/** @typedef {import("../../../../../../hqptuner/static/model/shell/option-list.js").Opt} Opt */
/** @typedef {import("../../derive.js").Delta<Opt>} OptDelta */

/**
 * SDM runs the family in two stages: the engine name takes `-2s`, the Standard prose adds the two-stage note.
 *
 * @type {OptDelta}
 */
export const twoStage = (o) => ({ v: `${o.v}-2s`, d2: `${o.d} ${TWO_STAGE}` });

/**
 * SDM's Standard prose adds the 16x two-stage sentence on the filters that run so.
 *
 * @type {OptDelta}
 */
export const sdm16x = (o) => (AT_16X_FILTERS.has(o.v) ? { d2: at16x(o.d) } : undefined);
