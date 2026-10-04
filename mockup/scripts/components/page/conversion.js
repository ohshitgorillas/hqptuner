// Page home of the filters + shaper (Resampling and Shaping sections), the output Mode segment, and the mock
// cross-effects between them and the stage drawers (DSD Processing, Resampling, Shaping: one state, two homes).
//
// The page shows what runs: the running chain is the one the source plays through (SDM mode → SDM chain, PCM → PCM; a
// daemon left in Auto ([source]) elsewhere → the source's family). Only that chain shows. One field is open per section, the rest are one-line folds, so expanding never changes the height. The rail Resampling / Shaping values
// name what runs now. The drawer opens on the same running chain (setRunning).
//
// Mock scenario (data/scenarios.js, the switch above the plate): what plays decides which field runs. A field that isn't
// in this track's path reads `· idle` and its select dims: both filters and the shaper when nothing plays, the 1x filter
// at 192 kHz (Nx runs), the filters and shaper on a DSD → SDM path (remodulation, or Direct: nothing). The section stays
// (nothing hides). The rail names what runs in each slot: on DSD → SDM, Resampling = SDM → SDM
// conversion and Shaping = the integrator …: a processed DSD path adds one conversion stage ahead of
// Resampling (manual 6.1.0: one block of settings), see rail() in conversion/rail.js. The DSD settings never reach the
// page (not live). The path is reported out (hosts.onPath).

import { h } from "../../lib/shell/dom.js";
import { optCopy } from "../lists/vselect.js";
import { chainPick } from "./chain-pick.js";
import { FIELDS, CHAIN_NAMES } from "../../data/stages/conversion.js";
import { subscribe } from "../../lib/narrowing/narrow.js";
import { PLATFORM } from "../../../../hqptuner/static/lib/clock.js";
import { bothRows, fieldRuns, openOn, sectionRows } from "../../model/shell/conversion.js";
import { fit, listOf, path, playOf, rail, running, wraps } from "./conversion/rail.js";

/** @typedef {import('../../data/shell/scenarios.js').Scene} Scene */
/** @typedef {import('../../model/shell/conversion.js').Open} Open */
/** @typedef {import('../lists/vselect.js').ListName} ListName */
/** @typedef {{ label: string, sub: string, man: string }} Field */
/** @typedef {{ tier: number | null, rate: string, rest: string, value: string }} OutReadout  the Output readouts */
/** @typedef {{ set(id: string, v: string): void, setRunning(run: string): void }} DrawerLink  the stage drawer */

/**
 * The page's hosts: the section bodies, the rail's stage buttons, the bus, and who hears what runs.
 *
 * @typedef {object} ConvHosts
 * @property {HTMLElement} rs   Resampling section body
 * @property {HTMLElement} sh   Shaping section body
 * @property {Map<string, HTMLElement>} stages  the rail's stage buttons by id
 * @property {import('../../lib/shell/bus.js').Bus} bus
 * @property {(o: { mode: string, run: string, tier: number | null, rate: string, rest: string }) => void} [onOut]
 * @property {(run: string) => void} [onRun]
 * @property {(path: string, run: string, scene: Scene) => void} [onPath]
 * @property {import('../../../../hqptuner/static/lib/clock.js').Clock} [clock]
 */

/**
 * @typedef {object} ConvState  one mounted page's state, shared by the helpers here and in conversion/rail.js
 * @property {ConvHosts} hosts
 * @property {(run: string, path: string, scene: Scene) => OutReadout} out
 * @property {Scene} scene
 * @property {Record<string, string>} vals
 * @property {string} mode
 * @property {boolean} direct     DSD playback as applied (Direct SDM)
 * @property {string} reported
 * @property {DrawerLink | null} drawer
 * @property {Open | null} open
 * @property {boolean} both
 * @property {{ host: HTMLElement, ch: string, k: string }[]} copies  the open fields' copy
 */

/** @type {Record<string, string>} */
const NAMES = CHAIN_NAMES;

// The page shows the running chain only. Auto ([source]) isn't offered; when the daemon reports it (set elsewhere) the
// page still shows just the chain it runs now (the drawer holds both chains, as always).
/** @param {ConvState} st */
const chains = (st) => [running(st)];
/** @param {string | null} _ch */
const tag = (_ch) => null;
// Idle: every field this track's path doesn't run.
/**
 * @param {ConvState} st
 * @param {string} ch
 * @param {string} k
 */
const idle = (st, ch, k) => !fieldRuns(playOf(st), ch, k);
/**
 * @param {ConvState} st
 * @param {Field} f
 * @param {string} ch
 * @param {string} k
 */
const why = (st, f, ch, k) => (idle(st, ch, k) ? f.sub + " · idle" : f.sub);
/**
 * @param {string} ch
 * @param {string} k
 */
const fieldOf = (ch, k) => (k === "sh" ? FIELDS[ch + "sh"] : FIELDS[k]);

/**
 * The page's picker: nameplate + knob + siblings (components/chain-pick.js).
 *
 * @param {ConvState} st
 * @param {string} ch
 * @param {string} k
 * @param {string} aria
 */
function pick(st, ch, k, aria) {
  const id = ch + k;
  return chainPick({
    id: "pg-" + id,
    aria,
    idle: idle(st, ch, k),
    value: st.vals[id],
    stage: k === "nx" ? "nx" : "1x",
    list: k === "sh" ? (ch === "sdm" ? "modulators" : "dithers") : /** @type {ListName} */ (ch + "Filters"),
    onChange: (v) => {
      update(st, id, v);
      st.drawer?.set(id, v);
    },
  });
}

/**
 * One-line fold (▸): names a field or a chain, its value at the right; tapping it opens it.
 *
 * @param {{ name: string, ch: string | null, whyText: string, value: string, onOpen: () => void }} o
 */
function line({ name, ch, whyText, value, onOpen }) {
  return h(
    "button.fline",
    { type: "button", on: { click: onOpen } },
    h("b", { text: name }),
    tag(ch),
    whyText && h("span", { text: whyText }),
    h("span.fn", { text: value }),
  );
}

/**
 * The open field: head + select (dim while idle). Its copy goes to the section's right column.
 *
 * @param {ConvState} st
 * @param {string} ch
 * @param {string} k
 * @returns {HTMLElement[]}
 */
function field(st, ch, k) {
  const f = fieldOf(ch, k);
  // What narrowing leaves of the list reads in the nameplate (`4 of 21`), so the head carries no count.
  return [
    h("div.fh", {}, h("b", { text: f.label }), tag(ch), h("span.s", { text: why(st, f, ch, k) })),
    pick(st, ch, k, f.label),
  ];
}

/**
 * @param {ConvState} st
 * @param {string} ch
 * @param {string} k
 */
function copyOf(st, ch, k) {
  const host = h("div.man", {}, optCopy(listOf(ch, k), st.vals[ch + k]));
  st.copies.push({ host, ch, k });
  return host;
}

/**
 * Resampling: one field open (the open chain's other filter and every other chain folded), or both filters open.
 *
 * @param {ConvState} st
 * @param {string[]} cs
 * @param {Open} open
 */
function renderResampling(st, cs, open) {
  const o = open.rs;
  /** @param {string} ch */
  const chainLine = (ch) =>
    line({
      name: NAMES[ch],
      ch: null,
      whyText: ch === running(st) ? "" : "idle",
      value: st.vals[ch + "1x"],
      onOpen: () => {
        o.chain = ch;
        o.field = "1x";
        render(st);
      },
    });
  if (st.both) {
    // One row per filter (field | its copy).
    const { fields, others } = bothRows(cs, o.chain);
    st.hosts.rs.replaceChildren(
      h(
        "div.rsboth",
        {},
        fields.map(({ ch, k }) => h("div.two", {}, h("div.fld", {}, field(st, ch, k)), copyOf(st, ch, k))),
        others.length > 0 && h("div.two", {}, h("div.fld", {}, others.map(chainLine))),
      ),
    );
  } else {
    const left = sectionRows(cs, o, ["1x", "nx"]).flatMap(({ kind, ch, k }) =>
      kind === "field"
        ? field(st, ch, k)
        : kind === "line"
          ? [
              line({
                name: FIELDS[k].label,
                ch,
                whyText: why(st, FIELDS[k], ch, k),
                value: st.vals[ch + k],
                onOpen: () => {
                  o.field = k;
                  render(st);
                },
              }),
            ]
          : [chainLine(ch)],
    );
    st.hosts.rs.replaceChildren(h("div.two", {}, h("div.fld", {}, left), copyOf(st, o.chain, o.field)));
  }
}

/**
 * Shaping: the open chain's shaper open, every other chain's folded.
 *
 * @param {ConvState} st
 * @param {string[]} cs
 * @param {Open} open
 */
function renderShaping(st, cs, open) {
  const sl = sectionRows(cs, { chain: open.sh, field: "sh" }, ["sh"]).flatMap(({ kind, ch }) =>
    kind === "field"
      ? field(st, ch, "sh")
      : [
          line({
            name: fieldOf(ch, "sh").label,
            ch,
            whyText: ch === running(st) ? "" : "idle",
            value: st.vals[ch + "sh"],
            onOpen: () => {
              open.sh = ch;
              render(st);
            },
          }),
        ],
  );
  st.hosts.sh.replaceChildren(h("div.two", {}, h("div.fld", {}, sl), copyOf(st, open.sh, "sh")));
}

/** @param {ConvState} st */
function render(st) {
  st.copies.length = 0;
  const cs = chains(st);
  if (!st.open) st.open = openOn(playOf(st), cs[0]);
  renderResampling(st, cs, st.open);
  renderShaping(st, cs, st.open);
  rail(st);
  fit(st);
}

/**
 * A filter or shaper changed (drawer or page): the page re-renders (what is open stays open), then the rail.
 *
 * @param {ConvState} st
 * @param {string} id
 * @param {string} v
 */
function update(st, id, v) {
  st.vals[id] = v;
  render(st);
}

/**
 * The scenario switch, or DSD playback applied (Direct): the path changes; the running chain may too (a daemon in Auto).
 *
 * @param {ConvState} st
 * @param {Scene} sc
 * @param {boolean} dir
 */
function setScene(st, sc, dir) {
  st.scene = sc;
  st.direct = dir;
  st.open = null;
  st.drawer?.setRunning(running(st));
  render(st);
}

/**
 * @param {ConvState} st
 * @param {string} m
 */
function setMode(st, m) {
  if (m === st.mode) return;
  st.mode = m;
  st.open = null; // a new mode opens on its running 1x and shaper
  st.drawer?.setRunning(running(st));
  render(st);
}

/**
 * What the engine runs now (Snapshot builder's Live column): mode, running chain, both chains' picks.
 *
 * @param {ConvState} st
 */
function state(st) {
  const { vals } = st;
  return {
    mode: st.mode,
    run: running(st),
    pcm: { "1x": vals.pcm1x, nx: vals.pcmnx, sh: vals.pcmsh },
    sdm: { "1x": vals.sdm1x, nx: vals.sdmnx, sh: vals.sdmsh },
  };
}

/**
 * The page's Resampling and Shaping sections and the rail values they drive, one state with the stage drawers.
 *
 * @param {ConvHosts} hosts   section bodies, the rail's stages, the bus, the listeners; `clock` defaults to the platform's
 * @param {{ mode: string, values: Record<string, string> }} conv    CONV mock state
 * @param {(run: string, path: string, scene: Scene) => OutReadout} out   Output readouts for what plays
 * @param {Scene} scene   the mock scenario playing (data/scenarios.js)
 */
export function mountConversion(hosts, conv, out, scene) {
  const clock = hosts.clock ?? PLATFORM;
  const vals = { ...conv.values };
  /** @type {ConvState} */
  const st = {
    hosts,
    out,
    scene,
    vals,
    mode: conv.mode,
    direct: vals.dsdplay === "1", // DSD playback as applied (Direct SDM)
    reported: "",
    drawer: null,
    // One field open per section (expanding Nx pushed Output off the page). The open field shows its head
    // and select, its copy in the right column; every other field is one line (no accent: ink-2 like any fold). So a
    // section's height never changes with what is open. Resampling: the running chain's 1x / Nx.
    open: null, // {rs: {chain, field}, sh: chain}
    // Room for both filters: the open chain shows 1x and Nx open, each with its copy beside it; nothing folds. Only where
    // the plate is tall enough to hold both (13″; lib/plate.js SIZES both, setRoom). With the Matrix engine bypassed its
    // room goes to the page's Source meter at every size, not to the idle filter (main.js paintPageMeter).
    both: false,
    copies: [],
  };
  // The page's height changes under it (Matrix engine section shown / hidden, bottom bar, resize): refit.
  hosts.bus.on("relayout", () =>
    clock.requestAnimationFrame(() => {
      fit(st);
      wraps(hosts);
    }),
  );

  render(st);
  subscribe(() => render(st)); // narrowing moved: the filters' sibling strips follow
  hosts.bus.on("optstyle", () => render(st)); // Option style: the nameplates' names (vselect.js setOptionStyle)
  return {
    /**
     * @param {string} id
     * @param {string} v
     */
    update: (id, v) => update(st, id, v),
    /** @param {string} m */
    setMode: (m) => setMode(st, m),
    /**
     * @param {Scene} sc
     * @param {boolean} [dir]
     */
    setScene: (sc, dir = st.direct) => setScene(st, sc, dir),
    running: () => running(st),
    path: () => path(st),
    state: () => state(st),
    /** @param {DrawerLink} api */
    bindDrawer: (api) => {
      st.drawer = api;
    },
    /** Matrix engine bypassed as applied: both filters open on the page. */
    /**
     * The display size holds both filters open (13″): the spare height goes to the idle filter, not the Matrix plot.
     *
     * @param {boolean} on
     */
    setRoom: (on) => {
      if (st.both !== on) {
        st.both = on;
        render(st);
      }
    },
    /** Something the Output readouts read changed (DAC bits applied): repaint them. */
    refresh: () => render(st),
  };
}
