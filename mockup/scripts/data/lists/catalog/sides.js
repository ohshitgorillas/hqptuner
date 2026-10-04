// What the PCM and SDM filter catalogs change on a filter family's shared entries (data/lists/derive.js).

import { AT_16X_FILTERS, at16x } from "../derive.js";

/**
 * One filter in the catalog: engine name, plain short title, plain-name family, manual prose, and whether the two-stage
 * note follows it.
 *
 * @typedef {{ v: string, label: string, group: string, man: string, twoStage?: boolean }} CatalogFilter
 */
/** @typedef {import("../derive.js").Delta<CatalogFilter>} CatalogDelta */

/**
 * SDM runs the filter in two stages: the engine name takes `-2s`, the title says so, the two-stage note follows.
 *
 * @type {CatalogDelta}
 */
export const twoStage = (e) => ({ v: `${e.v}-2s`, label: `${e.label}, 2-stage`, twoStage: true });

/**
 * SDM's manual prose adds the 16x two-stage sentence on the filters that run so.
 *
 * @type {CatalogDelta}
 */
export const sdm16x = (e) => (AT_16X_FILTERS.has(e.v) ? { man: at16x(e.man) } : undefined);
