// Where raised alerts land, free of the DOM: which homes blink and in what colour, which drawers and page sections pin
// which alert lines, which drawer rows light, which stages go dark, and which header homes open a popover.
// components/alerts.js paints these decisions on the plate; the homes table is data/alerts.js HOMES.

/** @typedef {'crit' | 'warn' | 'advice'} Sev */
/** @typedef {'crit' | 'warn'} Blink */
/** @typedef {{ kind: string, sev: Sev, text: string, chain?: 'pcm' | 'sdm', rows?: string[] }} Alert */
/**
 * @typedef {object} Home
 * @property {string} [stage]  rail stage whose lamp blinks
 * @property {string} [drawer]  drawer that pins the alert line
 * @property {string[]} [row]  drawer rows that fix it
 * @property {string} [section]  page section whose header pins the line
 * @property {string} [el]  header element that blinks
 * @property {string} [set]  Settings rail category that blinks
 * @property {string[]} [dark]  rail stages that go dark
 */
/** @typedef {{ label: string, chain: Alert['chain'], sev: Sev }} LitRow */
/**
 * @typedef {object} AlertPlan
 * @property {{ stage: Map<string, Blink>, el: Map<string, Blink>, set: Map<string, Blink> }} blinks  each blinking home's colour
 * @property {Map<string, { alerts: Alert[], rows: LitRow[] }>} drawers  each drawer's pinned lines and lit rows
 * @property {Map<string, Alert[]>} sections  each page section's pinned lines
 * @property {string[]} dark  stages that go dark
 */

/** @type {Record<Sev, number>} */
const RANK = { crit: 2, warn: 1, advice: 0 };

/**
 * The blink a home shows once `sev` lands on it: the worst severity wins, and advice blinks amber like a warning.
 *
 * @param {string | undefined} cur  the blink already up, if any
 * @param {Sev} sev
 * @returns {string}
 */
export function worseBlink(cur, sev) {
  if (cur && RANK[sev] <= RANK[cur === "crit" ? "crit" : "warn"]) return cur;
  return sev === "crit" ? "crit" : "warn";
}

/**
 * Raise one blink on a home's map, the worst severity winning.
 *
 * @param {Map<string, Blink>} map
 * @param {string | undefined} id
 * @param {Sev} sev
 */
function raise(map, id, sev) {
  if (id) map.set(id, /** @type {Blink} */ (worseBlink(map.get(id), sev)));
}

/**
 * Append a value to the list a key holds.
 *
 * @template T
 * @param {Map<string, T[]>} map
 * @param {string} key
 * @param {T} value
 */
function push(map, key, value) {
  const at = map.get(key);
  if (at) at.push(value);
  else map.set(key, [value]);
}

/**
 * Where every raised alert lands, in raised order. An alert whose kind has no home lands nowhere.
 *
 * @param {Alert[]} list
 * @param {Record<string, Home>} homes
 * @returns {AlertPlan}
 */
export function alertPlan(list, homes) {
  /** @type {AlertPlan} */
  const plan = {
    blinks: { stage: new Map(), el: new Map(), set: new Map() },
    drawers: new Map(),
    sections: new Map(),
    dark: [],
  };
  /** @type {Map<string, Alert[]>} */
  const byDrawer = new Map();
  for (const a of list) {
    const home = homes[a.kind];
    if (!home) continue;
    raise(plan.blinks.stage, home.stage, a.sev);
    raise(plan.blinks.el, home.el, a.sev);
    raise(plan.blinks.set, home.set, a.sev);
    if (home.drawer) push(byDrawer, home.drawer, a);
    if (home.section) push(plan.sections, home.section, a);
    for (const id of home.dark || []) if (!plan.dark.includes(id)) plan.dark.push(id);
  }
  for (const [id, alerts] of byDrawer) {
    const rows = alerts.flatMap((a) =>
      (a.rows || homes[a.kind].row || []).map((label) => ({ label, chain: a.chain, sev: a.sev })),
    );
    plan.drawers.set(id, { alerts, rows });
  }
  return plan;
}

/**
 * The alerts a header popover shows: those homed on its element, in raised order.
 *
 * @param {Alert[]} list
 * @param {Record<string, Home>} homes
 * @param {string} sel  the header element's selector
 * @returns {Alert[]}
 */
export const alertsAt = (list, homes, sel) => list.filter((a) => homes[a.kind]?.el === sel);

/**
 * The header homes that open their alerts in a popover: an element with no Settings category to carry the line, once
 * each, in table order.
 *
 * @param {Record<string, Home>} homes
 * @returns {string[]}
 */
export const noteHomes = (homes) => [...new Set(Object.values(homes).flatMap((x) => (x.el && !x.set ? [x.el] : [])))];
