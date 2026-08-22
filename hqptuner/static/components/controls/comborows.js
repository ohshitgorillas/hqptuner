// The combobox pop's row model (Combobox.js, its only caller): the flat row
// list keyboard indexes live in, the nested family/variant containers the DOM
// renders, and visibility under a collapsed group. Pure data in, data out;
// nothing here touches preact or the DOM.

/**
 * @typedef {SchemaOption & { disabled?: boolean, reason?: string, display?: string,
 *   closedLabel?: string, rec?: boolean, group?: string, subgroup?: string | null,
 *   groupBlurb?: string, subgroupBlurb?: string }} RenderOption
 *   One row as it reaches the combobox. Wider than either shared type: Field.js
 *   forwards a schema literal's SchemaOption list unchanged when the entry
 *   carries `options`, and an OptionItem from the option stores when it carries
 *   `optionsFrom` — so disabled/reason are present on one path only. The
 *   display/closedLabel/group/subgroup fields ride in from the plain-names
 *   decoration (store/plainnames.js) and are absent in Standard mode.
 * @typedef {{ o: RenderOption, oi: number } | { header: string, sub: boolean, blurb?: string }} ListRow
 *   One rendered row of the open pop: an option (with its index in `options`),
 *   or a family/variant header with its optional blurb caption. Headers are
 *   never selectable, never committable, skipped by keyboard navigation; with
 *   collapse wiring they render as disclosure toggles.
 * @typedef {{ r: { o: RenderOption, oi: number }, i: number }} Slot
 *   One option row with its index in the flat row list — the index domain hl,
 *   selIdx and the aria ids live in, whatever the DOM nesting.
 * @typedef {{ head: string, key: string, blurb?: string, items: Slot[] }} VGroup
 *   A variant's subheader, its optional blurb caption and its option rows, one
 *   nested container. `key` is the "family|variant" disclosure key.
 * @typedef {{ head: string, key: string, blurb?: string, kids: (Slot | VGroup)[] }} FGroup
 *   A family's header, its optional blurb caption, its bare option rows and
 *   its variant groups, one nested container. `key` is the family disclosure key.
 * @typedef {"full" | "half" | null} ApodClass
 *   One option's apodizing class as the badge resolver reports it.
 * @typedef {{ collapsed: (key: string) => boolean, onToggle: (key: string) => void }} CollapseCtl
 *   The caller-owned disclosure state for the grouped pop, addressed by the
 *   group keys above. The widget only ever reads and toggles.
 */

/**
 * The open pop's row list: options 1:1 in Standard mode, and with a family
 * header before each family's first option and a variant subheader before each
 * non-null variant's first option when the options carry plain-names groups.
 * Group runs are contiguous by construction (store/plainnames.js sorts them),
 * so a boundary check per option is enough.
 * @param {RenderOption[]} opts
 * @returns {ListRow[]}
 */
export function buildRows(opts) {
  /** @type {ListRow[]} */
  const rows = [];
  /** @type {string | null} */
  let g = null;
  /** @type {string | null} */
  let sg = null;
  opts.forEach((o, oi) => {
    if (o.group != null) {
      if (o.group !== g) {
        rows.push({ header: o.group, sub: false, blurb: o.groupBlurb });
        g = o.group;
        sg = null;
      }
      if (o.subgroup != null && o.subgroup !== sg) rows.push({ header: o.subgroup, sub: true, blurb: o.subgroupBlurb });
      sg = o.subgroup == null ? null : o.subgroup;
    } else {
      g = null;
      sg = null;
    }
    rows.push({ o, oi });
  });
  return rows;
}

/**
 * The row's option, or undefined for a header row.
 * @param {ListRow | undefined} row
 * @returns {RenderOption | undefined}
 */
export const rowOption = (row) => (row && "o" in row ? row.o : undefined);

/**
 * Fold the flat row list into nested family/variant containers for display —
 * a family header owns its group, a variant subheader its subgroup, so each
 * can stick to the pop's top while its own rows scroll under it. Indices stay
 * in the flat row domain; only the DOM nests. Unknown and Standard-mode rows
 * (no group) stay at the top level.
 * @param {ListRow[]} rows
 * @returns {(Slot | FGroup)[]}
 */
export function nestRows(rows) {
  /** @type {(Slot | FGroup)[]} */
  const top = [];
  /** @type {FGroup | null} */
  let g = null;
  /** @type {VGroup | null} */
  let v = null;
  rows.forEach((r, i) => {
    if (!("o" in r)) {
      if (r.sub && g) {
        v = { head: r.header, key: `${g.head}|${r.header}`, blurb: r.blurb, items: [] };
        g.kids.push(v);
      } else if (!r.sub) {
        g = { head: r.header, key: r.header, blurb: r.blurb, kids: [] };
        v = null;
        top.push(g);
      }
      return;
    }
    if (r.o.group == null) {
      g = null;
      v = null;
    } else if (r.o.subgroup == null) {
      v = null; // a bare-family row after a variant group leaves the subgroup
    }
    (v ? v.items : g ? g.kids : top).push({ r, i });
  });
  return top;
}

/**
 * Whether a row is an option still on screen — not a header, and not folded
 * away under a collapsed family or variant. Headers are never hidden; their
 * own container renders them in both states.
 * @param {CollapseCtl | undefined} collapse
 * @returns {(row: ListRow | undefined) => boolean}
 */
export const visibleOption = (collapse) => (row) => {
  const o = rowOption(row);
  if (!o) return false;
  if (!collapse || o.group == null) return true;
  if (collapse.collapsed(o.group)) return false;
  return o.subgroup == null || !collapse.collapsed(`${o.group}|${o.subgroup}`);
};
