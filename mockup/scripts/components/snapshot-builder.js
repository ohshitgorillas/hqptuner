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

import { h } from "../lib/dom.js";
import { seg } from "./seg.js";
import { vselect, optionStyle } from "./vselect.js";
import { mountBuilder, nameInput } from "../lib/builder.js";
import { NEW, homeOf } from "../model/builder.js";
import { SNAP_ROWS, SNAP_COPY } from "../data/snapshots.js";
import { CHAIN_NAMES } from "../data/conversion.js";
import { classNames } from "../model/format.js";
import { pageButtons } from "../lib/pager.js";
import { isChain, valOf, railPer, revealPage, railFolds, litEntry, snapRow } from "../model/snapshot.js";

/**
 * @param {object} el     {btn: header button, chain: #body, body: #bbody, rail, page, settings: {setOn}, bus: lib/bus.js}
 * @param {{name: string, active?: boolean}[]} stations  in the tree's order
 * @param {object} records  station → name → fields (absent = not held)
 * @param {() => object} live  engine now: {autopilot, adaptive, profile, mode, run, pcm: {1x,nx,sh}, sdm: {...}}
 */
export function mountSnapshotBuilder({ btn, chain, body, rail, page, settings, bus }, stations, records, live) {
  records = Object.fromEntries(stations.map((st) => [st.name, structuredClone(records[st.name] ?? {})]));
  const home = homeOf(stations); // the loaded station; New lands here
  // The state the helpers below share. B.cur = {st, name}: the snapshot being edited (name NEW = New snapshot); it
  // opens on the loaded station's first. openSt: the station fold that is open (the edited snapshot's; it opens on the
  // loaded station's). pageOf: station → its list's page. reveal: next rail paint turns to the edited snapshot's page.
  const S = {
    rail,
    page,
    live,
    stations,
    home,
    openSt: home,
    pageOf: new Map(),
    reveal: false,
    stationPaint: null,
    B: null,
    acts: null,
  };
  const B = (S.B = mountBuilder(
    { btn, chain, body, bus },
    {
      title: "Snapshot builder",
      closeLabel: "Close Snapshot builder",
      noun: "Snapshot", // the other builders' close
      stations: stations.map((st) => st.name),
      book: records,
      cur: { st: home, name: Object.keys(records[home])[0] ?? NEW },
      copy: { remove: (n) => SNAP_COPY.remove(n), overwrite: (n) => SNAP_COPY.overwrite(n), noName: SNAP_COPY.noName },
      name: () => edit(S).name,
      to: () => edit(S).stations,
      take: () => edit(S),
      record: (e) => recordOf(e),
      dirty: () => dirtyOf(S, B.cur),
      ticked: () => edit(S).stations.length > 0,
      view: () => render(S),
      went: (c) => {
        if (c.name !== NEW) S.openSt = c.st;
      },
      refuse: () => {
        render(S);
        page.querySelector(".bhead input")?.focus();
      },
      saved: () => {
        S.openSt = B.cur.st;
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
    },
  ));
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

// ── Edit buffers ────────────────────────────────────────────────────────
/** A record as an edit: every row has a value (the engine's where the record holds none); inc = what it holds. */
function fromRecord(S, r) {
  const L = S.live();
  const mode = r?.mode ?? L.run;
  const vals = {
    autopilot: L.autopilot,
    adaptive: L.adaptive,
    profile: L.profile,
    mode,
    pcm: { ...L.pcm },
    sdm: { ...L.sdm },
  };
  const inc = new Set();
  if (!r) {
    // New: what the engine runs now, everything attached (v1: every row checked)
    for (const row of SNAP_ROWS) inc.add(row.id);
    vals.mode = L.run;
    return { name: "", stations: [S.home], inc, vals };
  }
  for (const [k, v] of Object.entries(r)) {
    inc.add(k);
    if (isChain(k)) vals[mode][k] = v;
    else vals[k] = v;
  }
  return { name: S.B.cur.name, stations: [S.B.cur.st], inc, vals };
}
const saved = (S, c) => (c.name === NEW ? fromRecord(S, null) : fromRecord(S, S.B.book[c.st][c.name]));
const edit = (S) => S.B.staged.get(S.B.K(S.B.cur)) ?? saved(S, S.B.cur);
const key = (e) =>
  JSON.stringify([
    e.name,
    [...e.stations].sort(),
    [...held(e)].sort(),
    ...[...held(e)].sort().map((id) => valOf(e, id)),
  ]);
/** What the snapshot would store: chain rows only with Mode (they index its chain). */
const held = (e) => new Set([...e.inc].filter((id) => !isChain(id) || e.inc.has("mode")));
const dirtyOf = (S, c) => S.B.staged.has(S.B.K(c));

/** What the snapshot stores: the rows it holds, at the edit's values. */
function recordOf(e) {
  const r = {};
  for (const id of SNAP_ROWS.map((x) => x.id)) if (held(e).has(id)) r[id] = valOf(e, id);
  return r;
}

/** Change the edit; stage it while it differs from what is saved, drop it once it matches again. soft = no re-render
 *  (the name box: typing must not rebuild the page under the caret, or under a Save tap that blurs it). */
function change(S, fn, soft) {
  const { B } = S;
  const e = structuredClone(edit(S));
  e.inc = new Set(edit(S).inc);
  fn(e);
  B.stage(key(e) === key(saved(S, B.cur)) && (B.cur.name !== NEW || !e.name) ? null : e);
  if (soft) {
    B.paintState();
    return;
  }
  B.refused = false;
  render(S);
}

// ── Live values ─────────────────────────────────────────────────────────
/** The live value in the words the snapshot's control uses: the same Option style as the pickers (Visual settings). */
const labelOf = (row, e, v) => {
  if (row.kind === "seg") return row.options.find((o) => o.v === v)?.label ?? (v === "auto" ? "Auto" : v);
  if (row.kind === "list" && optionStyle() !== "standard")
    return row.list(e.vals.mode).find((o) => o.v === v)?.label ?? v;
  return v;
};

// ── Rail ────────────────────────────────────────────────────────────────
/** Rail at the most lines that fit: the open station's page shrinks until nothing runs past the rail (no scroll). */
function paintRail(S) {
  // Measured on the fullest page (the first), so every page holds the same number of lines.
  const per = railPer((n) => {
    paintRailAt(S, n, true);
    return { client: S.rail.clientHeight, scroll: S.rail.scrollHeight };
  });
  // After a save (or a station opened on its snapshot), its page is the one shown.
  const { cur } = S.B;
  if (S.reveal) {
    const pg = revealPage(S.B.book, cur, per);
    if (pg !== null) S.pageOf.set(cur.st, pg);
  }
  S.reveal = false;
  paintRailAt(S, per);
}
function paintRailAt(S, per, first) {
  const { B, home } = S;
  const e = edit(S);
  const nw = { st: home, name: NEW };
  const folds = railFolds({
    stations: S.stations.map((st) => st.name),
    book: B.book,
    open: S.openSt,
    home,
    staged: [...B.staged.keys()],
    per,
    pages: S.pageOf,
    first,
  });
  S.rail.replaceChildren(
    // Each station a fold, one open at a time; its snapshots under it. The loaded station's name amber.
    ...folds.flatMap((f) => [
      h(
        "button.brh",
        {
          type: "button",
          class: classNames(f.loaded && "cur", f.dirty && "dirty"),
          aria: { expanded: f.open },
          on: {
            click: () => {
              S.openSt = f.open ? null : f.name;
              paintRail(S);
            },
          },
        },
        h("span.chv", { text: f.open ? "▾" : "▸" }),
        h("span.sn", { text: f.name }),
        h("span.ln"),
        h("span.cnt", { text: String(f.count) }),
      ),
      ...f.items.map((name) => railEntry(S, e, { st: f.name, name })),
      // A short last page keeps its full height (the pipelines list's fixed page), so nothing under it moves.
      ...Array.from({ length: f.fill }, () => h("div.bfill")),
      ...(f.open ? railPager(S, f.name, f.count, per) : []),
    ]),
    h(
      "button.st.bst.bnew",
      {
        type: "button",
        class: classNames(litEntry(nw, B.cur, e) && "open", dirtyOf(S, nw) && "dirty"),
        on: { click: () => B.go(nw) },
      },
      h("span.n", {}, h("span.plus", { text: "+" }), "New snapshot"),
    ),
  );
}
/** One snapshot's line, lit with the edit (the same-named one in every other ticked station too: Save writes there). */
function railEntry(S, e, c) {
  const lit = litEntry(c, S.B.cur, e);
  return h(
    "button.st.bst",
    {
      type: "button",
      class: classNames(lit && "open", dirtyOf(S, c) && "dirty"),
      aria: { current: lit },
      title: c.name,
      on: { click: () => S.B.go(c) },
    },
    h("span.n", { text: c.name }),
  );
}
function railPager(S, st, n, per) {
  const kids = pageButtons({
    n,
    per,
    page: S.pageOf.get(st) ?? 0,
    go: (k) => {
      S.pageOf.set(st, k);
      paintRail(S);
    },
  });
  return kids.length ? [h("div.opg.bpg", {}, kids)] : [];
}

// ── Page ────────────────────────────────────────────────────────────────
function render(S) {
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

function takeAll(x, L) {
  if (x.inc.has("mode")) x.vals.mode = L.run;
  for (const row of SNAP_ROWS) {
    if (!x.inc.has(row.id) || row.id === "mode") continue;
    if (isChain(row.id)) x.vals[x.vals.mode][row.id] = L[x.vals.mode][row.id];
    else x.vals[row.id] = L[row.id];
  }
}

function rowEl(S, row, e) {
  const ch = e.vals.mode;
  const d = snapRow(row, e, S.live());
  const label = typeof row.label === "function" ? row.label(ch) : row.label;

  const box = h("button.binc", {
    type: "button",
    role: "checkbox",
    aria: { checked: d.on, label: `Attach ${label}` },
    disabled: d.gated,
    on: {
      click: () =>
        change(S, (x) => {
          if (x.inc.has(row.id)) x.inc.delete(row.id);
          else x.inc.add(row.id);
        }),
    },
  });

  let ctl;
  const set = (nv) =>
    change(S, (x) => {
      if (isChain(row.id)) x.vals[x.vals.mode][row.id] = nv;
      else x.vals[row.id] = nv;
    });
  if (row.kind === "seg") ctl = seg({ aria: label, options: row.options, value: d.value, onChange: set });
  else if (row.kind === "select") ctl = vselect({ aria: label, options: row.options, value: d.value, onChange: set });
  else
    ctl = vselect({
      id: `bd-${ch}${row.id}`,
      aria: `${CHAIN_NAMES[ch]} ${label}`,
      options: row.list(ch),
      value: d.value,
      onChange: set,
    });
  const ctlWrap = h("div.bval", { class: !d.on && "grayed" }, ctl);
  if (!d.on) for (const b of ctlWrap.querySelectorAll("button,select")) b.disabled = true;

  const take = h("button.round.btake", {
    type: "button",
    "aria-label": `${label}: use the live value`,
    text: "←",
    disabled: !d.take,
    on: { click: () => set(row.id === "mode" ? S.live().run : d.live) },
  });

  const liveTxt = labelOf(row, e, d.live);
  return h(
    "div.brow",
    { class: classNames(!row.stage && "cont", !d.on && "off"), data: { id: row.id } },
    box,
    h("div.bset", {}, row.stage && h("span.bst2", { text: row.stage }), h("span.bl", {}, h("b", { text: label }))),
    ctlWrap,
    take,
    // Differences mark only on attached rows (an excluded row is left as is on recall, so it can't differ).
    h(
      "div.vfd.blive",
      { class: d.differs && d.on && "diff", title: d.idle ? `${liveTxt} · idle` : liveTxt },
      h("span.v", {}, h("span.bt", { text: liveTxt }), d.idle && h("span.bidle", { text: "· idle" })),
    ),
  );
}
