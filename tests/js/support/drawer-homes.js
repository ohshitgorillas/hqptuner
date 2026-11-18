// Shared helpers of the one-home suites over the stage drawers (drawer-homes*.test.js): where a control id is
// declared, what the drawer item naming it carries of its own, and the cases the rule is checked by.

import { schema } from "../../../hqptuner/static/store/schema.js";

/** The local module's URL, beside the catalog's group modules. */
const LOCAL_URL = new URL("../../../hqptuner/static/store/schema/local.js", import.meta.url).href;

/** The properties of a drawer item that name it rather than derive it. */
const NAMING = new Set(["id", "key"]);

/**
 * The local module's exports, or none when the module does not exist.
 *
 * @returns {Promise<Record<string, unknown>>}
 */
async function localExports() {
  try {
    return await import(LOCAL_URL);
  } catch (err) {
    if (/** @type {{ code?: string }} */ (err).code === "ERR_MODULE_NOT_FOUND") return {};
    throw err;
  }
}

/**
 * Whether a value is a non-array object.
 *
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The entries the local module declares for `id`: every export holding `id` as a key, or itself carrying it as its id.
 *
 * @param {string} id
 * @returns {Promise<Record<string, unknown>[]>}
 */
async function localEntries(id) {
  const found = Object.values(await localExports()).flatMap((v) => {
    if (!isRecord(v)) return [];
    if (v.id === id || v.key === id) return [v];
    const entry = Object.hasOwn(v, id) ? v[id] : undefined;
    return isRecord(entry) ? [entry] : [];
  });
  return [...new Set(found)];
}

/**
 * How many homes declare `id`: the catalog counts once when it carries the key, the local module once when any of its
 * exports does.
 *
 * @param {string} id
 * @returns {Promise<number>}
 */
export async function homeCount(id) {
  const inCatalog = Object.hasOwn(schema, id) ? 1 : 0;
  const inLocal = (await localEntries(id)).length > 0 ? 1 : 0;
  return inCatalog + inLocal;
}

/**
 * The one home entry for `id`, local first, then the catalog; undefined when neither declares it.
 *
 * @param {string} id
 * @returns {Promise<Record<string, unknown> | undefined>}
 */
async function homeOf(id) {
  const [local] = await localEntries(id);
  if (local) return local;
  const entry = /** @type {Record<string, unknown>} */ (schema)[id];
  return isRecord(entry) ? entry : undefined;
}

/**
 * Every object in a drawer schema that names `id` as its id or key, plus whether a bare string `id` sits anywhere in
 * it, walking plain objects and arrays once each and never into a named item.
 *
 * @param {unknown} node
 * @param {string} id
 * @returns {{ items: Record<string, unknown>[], bare: boolean }}
 */
function itemsNaming(node, id) {
  /** @type {Record<string, unknown>[]} */
  const items = [];
  let bare = false;
  const seen = new Set();
  /** @param {unknown} n */
  const walk = (n) => {
    if (n === id) bare = true;
    if (typeof n !== "object" || n === null || seen.has(n)) return;
    seen.add(n);
    if (isRecord(n) && (n.id === id || n.key === id)) {
      items.push(n);
      return;
    }
    Object.values(n).forEach(walk);
  };
  walk(node);
  return { items, bare };
}

/**
 * The properties the drawer's item for `id` carries beside its name that are not its home's own, sorted; null when
 * the drawer names `id` nowhere.
 *
 * @param {unknown} drawer
 * @param {string} id
 * @returns {Promise<string[] | null>}
 */
export async function ownDerivations(drawer, id) {
  const { items, bare } = itemsNaming(drawer, id);
  if (items.length === 0) return bare ? [] : null;
  const home = await homeOf(id);
  const own = items.flatMap((item) =>
    Object.keys(item).filter((p) => !NAMING.has(p) && (home === undefined || item[p] !== home[p])),
  );
  return [...new Set(own)].sort();
}

/**
 * The one-home rule's cases over `controls`, each a control id with the drawer that draws it: first that exactly one
 * home declares every id, then that the drawer item naming each derives nothing of its own. A case is the name of its
 * test, the evidence the test asks for and the evidence it expects.
 *
 * @param {{ id: string, drawer: unknown }[]} controls
 * @returns {{ name: string, evidence: () => Promise<unknown>, expected: unknown }[]}
 */
export function homeCases(controls) {
  return [
    ...controls.map(({ id }) => ({
      name: `test_the_${id}_control_is_declared_in_exactly_one_home`,
      evidence: () => homeCount(id),
      expected: 1,
    })),
    ...controls.map(({ id, drawer }) => ({
      name: `test_the_${id}_drawer_item_derives_nothing_of_its_own`,
      evidence: () => ownDerivations(drawer, id),
      expected: [],
    })),
  ];
}
