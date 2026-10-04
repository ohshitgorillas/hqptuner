// Snapshot builder: the header's Snapshot builder button swaps the chain body for this one, as the gear does for Settings.
// Header, engine row and bottom bar stay (the Setting Switcher stays live).
//   Rail  every station as a fold (▸ name, count; the loaded one amber), one open at a time (the station tree's fold),
//         its snapshots under it one line each, then New snapshot. No scroll: the open station's list pages to the lines the
//         rail has room for (the DSP pipelines list's numbered page buttons), so 12 × 4 or 1 × 25 both fit. The one
//         being edited: amber name + left-hand selection bar (rail grammar). A
//         snapshot holding unsaved edits keeps a dirty dot (edits stay staged per snapshot until Save or Discard; leaving
//         the builder never discards, the drawers' rule).
//   Page  name window + Stations window (the stations Save writes to: a new snapshot to several at once, an edit to the
//         same-named snapshot in each; unticking its own moves it) +
//         Delete / Discard / Save, then one row per setting a snapshot can hold, in chain order:
//         include box | stage + setting | the snapshot's value | ← | the engine's live value.
//         Excluded rows gray (never hidden): recall leaves that setting where the engine has it (v1).
//         `Use live settings` (head of the Live column) fills every included row from the engine; ← takes one row's, and
//         is live only where the two differ. Editing a row is specifying it. Nothing here writes to the engine.
//         The chain rows follow the snapshot's Output mode (one chain per snapshot) and need it: Mode excluded grays them
//         (their include state is kept and comes back with Mode, as the matrix bypass keeps its dependents' settings).
// Exit: × on the title, the button again, Escape with nothing open, or the gear (straight to Settings).
// The shell (switching, staging, Save / Delete, the stations menu, the swap) is lib/builder.js; every edit lives staged.
// The rail's and rows' decisions are model/snapshot.js; this file draws what they return.

import { h } from "../../lib/shell/dom.js";
import { mountBuilder, nameInput } from "../../lib/builder/builder.js";
import { NEW, homeOf } from "../../../../hqptuner/static/model/builders/builder.js";
import { SNAP_ROWS, SNAP_COPY } from "../../data/builders/snapshots.js";
import { edit, dirtyOf, recordOf, change } from "./snapshot-builder/edit.js";
import { paintRail } from "./snapshot-builder/rail.js";
import { takeAll, rowEl } from "./snapshot-builder/rows.js";

/** @typedef {import('../../data/builders/snapshots.js').Snapshot} Snapshot */
/** @typedef {import('../../../../hqptuner/static/model/builders/snapshot.js').Edit} Edit */
/** @typedef {import('../../lib/builder/builder.js').Spec<Snapshot, Edit>} Spec */
/** @typedef {import('../../lib/builder/builder.js').Builder<Snapshot, Edit>} Builder */
/** @typedef {Record<string, Record<string, Snapshot>>} Records  station → name → the fields it holds */
/** @typedef {{ setOn: (on: boolean) => void }} Settings */
/**
 * The engine now.
 *
 * @typedef {object} Live
 * @property {string} autopilot
 * @property {string} adaptive
 * @property {string} profile
 * @property {string} mode
 * @property {import('../../data/stages/conversion.js').Chain} run  the chain it runs
 * @property {Record<string, string>} pcm  the PCM chain's rows
 * @property {Record<string, string>} sdm  the SDM chain's rows
 */
/**
 * The page's elements the builder lives in.
 *
 * @typedef {object} Els
 * @property {HTMLElement} btn  the header's button
 * @property {HTMLElement} chain  #body
 * @property {HTMLElement} body  #bbody
 * @property {HTMLElement} rail
 * @property {HTMLElement} page
 * @property {Settings} settings
 * @property {import('../../lib/shell/bus.js').Bus} bus
 */
/**
 * The Snapshot builder's state, shared by every file here. B.cur = {st, name}: the snapshot being edited (name NEW = New
 * snapshot).
 *
 * @typedef {object} Snap
 * @property {HTMLElement} rail
 * @property {HTMLElement} page
 * @property {() => Live} live
 * @property {{ name: string, active?: boolean }[]} stations
 * @property {string} home  the loaded station; New lands here
 * @property {string | null} openSt  the station fold that is open
 * @property {Map<string, number>} pageOf  station → its list's page
 * @property {boolean} reveal  the next rail paint turns to the edited snapshot's page
 * @property {(() => void) | null} stationPaint  the Stations menu's paint
 * @property {Builder} B
 * @property {ReturnType<Builder['buttons']>} acts  Delete / Discard / Save, on the title
 */

/**
 * Mount the Snapshot builder on its body; it opens on the loaded station's first snapshot.
 *
 * @param {Els} el
 * @param {{ name: string, active?: boolean }[]} stations  in the tree's order
 * @param {Records} records  station → name → fields (absent = not held)
 * @param {() => Live} live  engine now
 */
export function mountSnapshotBuilder({ btn, chain, body, rail, page, settings, bus }, stations, records, live) {
  records = Object.fromEntries(stations.map((st) => [st.name, structuredClone(records[st.name] ?? {})]));
  const home = homeOf(stations); // the loaded station; New lands here
  // The state the helpers below share. B.cur opens on the loaded station's first. openSt opens on the loaded station's.
  const S = /** @type {Snap} */ ({
    rail,
    page,
    live,
    stations,
    home,
    openSt: home,
    pageOf: new Map(),
    reveal: false,
    stationPaint: null,
    B: /** @type {Builder | null} */ (null),
    acts: /** @type {Snap['acts'] | null} */ (null),
  });
  const B = (S.B = mountBuilder({ btn, chain, body, bus }, specOf(S, records, settings)));
  S.acts = B.buttons("button.btn.sm.bsave"); // Delete / Discard / Save, on the title

  btn.setAttribute("aria-pressed", "false");
  const api = B.start();
  bus.on("relayout", () => {
    if (!body.hidden) paintRail(S);
  }); // lines per page follow the rail's height
  render(S);
  return {
    ...api,
    refresh: () => {
      if (!body.hidden) render(S);
    },
  };
}

/**
 * The shell's spec: the records, the edit Save writes, and what follows each of the shell's acts.
 *
 * @param {Snap} S
 * @param {Records} records
 * @param {Settings} settings
 * @returns {Spec}
 */
function specOf(S, records, settings) {
  const { stations, home, page } = S;
  return {
    title: "Snapshot builder",
    closeLabel: "Close Snapshot builder",
    noun: "Snapshot", // the other builders' close
    stations: stations.map((st) => st.name),
    book: records,
    cur: { st: home, name: Object.keys(records[home])[0] ?? NEW },
    copy: {
      remove: (/** @type {string} */ n) => SNAP_COPY.remove(n),
      overwrite: (/** @type {string} */ n) => SNAP_COPY.overwrite(n),
      noName: SNAP_COPY.noName,
    },
    name: () => edit(S).name,
    to: () => edit(S).stations,
    take: () => edit(S),
    record: (e) => recordOf(e ?? edit(S)),
    dirty: () => dirtyOf(S, S.B.cur),
    ticked: () => edit(S).stations.length > 0,
    view: () => render(S),
    went: (c) => {
      if (c.name !== NEW) S.openSt = c.st;
    },
    refuse: () => {
      render(S);
      /** @type {HTMLElement | null} */ (page.querySelector(".bhead input"))?.focus();
    },
    saved: () => {
      S.openSt = S.B.cur.st;
      S.reveal = true;
      render(S);
    },
    removed: () => render(S),
    leave: () => settings.setOn(false),
    opened: () => render(S),
    painted: () => {
      S.stationPaint?.();
      paintRail(S);
    },
    toggles: true,
  };
}

// ── Page ────────────────────────────────────────────────────────────────
/**
 * Render the page for the snapshot being edited: title and actions, name and Stations, the rows, then the rail.
 *
 * @param {Snap} S
 */
export function render(S) {
  const { B, page, acts } = S;
  const e = edit(S);
  const isNew = B.cur.name === NEW;

  const nameBox = nameInput(
    { type: "text", "aria-label": "Snapshot name", value: e.name, maxlength: 40, spellcheck: "false" },
    (name) =>
      change(
        S,
        (x) => {
          x.name = name;
        },
        true,
      ),
  );
  nameBox.value = e.name;
  // Page title in the section header grammar (engraved + rule), carrying the snapshot's actions.
  const title = B.title("Snapshot builder", null, [!isNew && acts.del, acts.discard, acts.save]);
  B.paintActs();
  const head = h(
    "div.bhead",
    {},
    h("label.vfd.bname", {}, h("span.l", { text: "Name" }), nameBox),
    stationPick(S),
    h("div.bcap", {}, B.refused ? h("span.bref", { text: SNAP_COPY.noName }) : isNew ? SNAP_COPY.select : ""),
  );

  const L = S.live();
  const cols = h(
    "div.brow.bcols",
    {},
    h("span"),
    h("span"),
    h("span.bct", { text: "Snapshot" }),
    h("span"),
    h(
      "span.bct.blh",
      {},
      h("span", { text: "Live" }),
      h("button.btn.sm", {
        type: "button",
        text: "Use live settings",
        on: { click: () => change(S, (x) => takeAll(x, L)) },
      }),
    ),
  );

  // The rows share the height left under the head (each row grows alike; nothing pools at the bottom).
  page.replaceChildren(
    title,
    head,
    (B.ask && B.askLine()) || "",
    cols,
    h(
      "div.brows",
      {},
      SNAP_ROWS.map((row) => rowEl(S, row, e)),
    ),
  );
  paintRail(S);
}

/**
 * Stations window: the stations Save writes to (the shell's menu). Ticking stays open: several can be picked in one go.
 *
 * @param {Snap} S
 * @returns {HTMLElement}
 */
function stationPick(S) {
  const m = S.B.stationsMenu({
    ticked: () => edit(S).stations,
    name: () => edit(S).name,
    now: true,
    pick: (list) =>
      change(
        S,
        (y) => {
          y.stations = list;
        },
        true,
      ),
  });
  S.stationPaint = m.paint;
  return m.el;
}
