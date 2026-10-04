// Station builder: the header's Station builder button swaps the chain body for this one, as the gear does for Settings.
// Header, engine row and bottom bar stay. It is the setup wizard's station walk (repo docs/wizard/wizard.md §1–§1.6 and
// §4), one station at a time, in the Profile builder's grammar: it edits a copy (nothing reaches the engine until Save;
// saving the loaded station restarts the engine), × on its title, Back / Next, nothing forces the order.
//   Rail   Overview, then Name, Backend, Device, IPv6, USB listings, Connection, Rates, DAC bits · Gain, Volume, Hardware,
//          each with its answer (`Skipped` where it doesn't apply). The page showing is lit (amber name + left-hand bar).
//   Overview  the wizard's intro beside the signal chain with the station's part lit (Volume, Output); what the station
//          holds (one line per part, › jumps to its step) and its Matrix profiles (› the Profile builder); which station
//          (picker · Name) and the ways on: Save, Change something (the walk from here), Start from scratch.
//   Steps  the wizard's question as the guide line, its answers as choice lines beside the manual's paragraph; checks
//          the wizard runs against the engine (IPv6, USB listings, the 48k-family DSD check) run here as mock sequences
//          that print the wizard's lines as they go. The NAA bring-up opens inside the Device step: on demand, and on its
//          own whenever an NAA backend lists nothing.
// Hardware is the machine's, not the station's: its answers are written to every station on Save (wizard §4).
// Edits stay staged per station until Save or Discard, through switching and leaving.
// Exit: ×, Escape with nothing open, the gear (Settings), or another builder's button.
// Mock outcomes: `#naa-none` (no NAA until Refresh devices), `#ipv6-fail`, `#usb-fail-gone` / `#usb-fail-none`,
// `#dsd48-no` (the check finds no 48k-family DSD).
// The shell (switching, staging, Save / Delete, the rail, the overview's frame, the swap) is lib/builder.js: one record
// book holding every station under one key, with the station list's order kept beside it.
// Each step is its own module under station-builder/, the mock checks one more; the decisions they make are
// model/station.js.

import { PLATFORM } from "../../lib/shell/clock.js";
import { mountBuilder, chainPic } from "../../lib/builder/builder.js";
import { homeOf } from "../../model/builders/builder.js";
import { deadListings } from "../../model/builders/station.js";
import { STB_SCRATCH, STB_RECORDS, STB_HW_REC } from "../../data/builders/station-builder.js";
import { ONE } from "./station-builder/frame/parts.js";
import { stationTables } from "./station-builder/frame/tables.js";
import { shellSpec } from "./station-builder/frame/shell.js";
import { show } from "./station-builder/frame/page.js";

/** @typedef {import('../../model/builders/station.js').Rec} Rec */
/** @typedef {import('../../data/builders/station-builder.js').HwAnswers} HwRec  the machine's hardware answers */
/** @typedef {import('../../lib/shell/clock.js').Clock} Clock */
/** @typedef {import('./station-builder/frame/parts.js').Run} Run */
/** @typedef {{ name: string, rec: Rec, hw: HwRec }} Edit  the station being edited */
/** @typedef {{ setOn: (on: boolean, toChain?: boolean) => void }} Body  another body the builder turns off */
/** @typedef {{ settings: Body, snapshot: () => Body | null | undefined, profiles: () => Body | null | undefined }} Others */
/** @typedef {{ names: string[], loaded: string, renamed: { from: string, to: string } | null, restart: boolean }} Saved */

/**
 * @typedef {object} Opts  what the app hands the builder
 * @property {(station: string) => string[]} profilesOf  the station's Matrix profiles
 * @property {() => void} [onRescan]
 * @property {(x: Saved) => void} [onSaved]
 * @property {(station: string) => void} openProfiles
 * @property {import('../../model/shell/flags.js').Flags} flags  the mock checks' outcomes
 */

/** @typedef {import('../../lib/builder/builder.js').Builder<Rec, Edit>} Shell */

/**
 * @typedef {object} StationState  the builder's state, shared by reference with every step
 * @property {Opts} o
 * @property {Opts['flags']} flags
 * @property {Clock} clock
 * @property {import('./station-builder/frame/tables.js').Tables} T  the borrowed tables
 * @property {string[]} order  the stations, in list order
 * @property {string} loaded  the station the engine runs
 * @property {Record<string, Rec>} records
 * @property {HwRec} hw  the machine's: one record, written to every station
 * @property {boolean} naaSeen  mock: an NAA shows only after Refresh devices
 * @property {Set<string>} hidden  listings a resolved pair left dead: hidden from every list (wizard §1.5)
 * @property {Edit} e  the one being edited
 * @property {Partial<Record<string, Run>>} runs  mock checks in flight or done, this edit: {ipv6, usb, rates}
 * @property {boolean} bringUp  the Device step shows the NAA bring-up
 * @property {boolean} pitch  the Volume step's pitch is open
 * @property {string} at  the page showing
 * @property {Shell} B
 * @property {HTMLElement} page
 * @property {HTMLElement} chainEl
 * @property {ReturnType<Shell['buttons']>} acts
 * @property {(id: string) => void} show
 * @property {(fn: (rec: Rec, e: Edit) => void) => void} set  change the edited record and repaint what follows from it
 */

/**
 * The builder's state, shared by reference with every step: the stations, the machine's hardware, the edit and what it
 * has open, and the actions every step takes.
 *
 * @param {{ name: string, active?: boolean }[]} stations
 * @param {Opts} o
 * @param {Clock} clock
 * @returns {StationState}
 */
function stationState(stations, o, clock) {
  const order = stations.map((st) => st.name);
  const known = /** @type {Partial<Record<string, Rec>>} */ (STB_RECORDS);
  const records = Object.fromEntries(order.map((n) => [n, structuredClone(known[n] ?? STB_SCRATCH)]));
  return /** @type {StationState} */ ({
    o,
    flags: o.flags,
    clock,
    T: stationTables(),
    order,
    loaded: homeOf(stations),
    records,
    hw: structuredClone(STB_HW_REC), // the machine's: one record, written to every station
    naaSeen: !o.flags.naaNone, // mock: an NAA shows only after Refresh devices
    hidden: new Set(deadListings(Object.values(records))), // listings a resolved pair left dead: hidden from every list (wizard §1.5)
    runs: {}, // mock checks in flight or done, this edit: {ipv6, usb, rates}
    bringUp: false,
    pitch: false,
    at: "overview",
    // e, B, page, chainEl, acts, show and set are set as the builder mounts, before anything reads them.
  });
}

/**
 * Mount the Station builder over its body.
 *
 * @param {{ btn: HTMLElement, chain: HTMLElement, body: HTMLElement, rail: HTMLElement, page: HTMLElement,
 *   others: Others, bus: { emit: (t: string) => void } }} el  btn: the header button, chain: #body, body: #stbody
 * @param {{ name: string, active?: boolean }[]} stations  in the tree's order
 * @param {Opts} o
 * @param {Clock} [clock]
 */
export function mountStationBuilder({ btn, chain, body, rail, page, others, bus }, stations, o, clock = PLATFORM) {
  const sb = stationState(stations, o, clock);
  sb.page = page;
  sb.show = (id) => show(sb, id);
  /** Change the edited record and repaint what follows from it. */
  sb.set = (fn) => {
    fn(sb.e.rec, sb.e);
    sb.show(sb.at);
  };
  const B = mountBuilder({ btn, chain, body, bus }, shellSpec(sb, { rail, others }));
  sb.B = B;
  sb.chainEl = chainPic("Signal chain: the station's part lit", (id) => ["volume", "output"].includes(id));
  B.pick.addEventListener("change", () => B.go({ st: ONE, name: B.pick.value }));
  sb.acts = B.buttons();
  B.load(B.cur, undefined);
  show(sb, "overview");
  return B.start();
}
