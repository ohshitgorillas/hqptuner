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

import { PLATFORM } from '../lib/clock.js';
import { mountBuilder, chainPic } from '../lib/builder.js';
import { homeOf } from '../model/builder.js';
import { deadListings } from '../model/station.js';
import { STB_SCRATCH, STB_RECORDS, STB_HW_REC } from '../data/station-builder.js';
import { ONE } from './station-builder/parts.js';
import { stationTables } from './station-builder/tables.js';
import { shellSpec } from './station-builder/shell.js';
import { show } from './station-builder/page.js';

/**
 * The builder's state, shared by reference with every step: the stations, the machine's hardware, the edit and what it
 * has open, and the actions every step takes.
 */
function stationState(stations, o, clock) {
  const order = stations.map((st) => st.name);
  const records = Object.fromEntries(order.map((n) => [n, structuredClone(STB_RECORDS[n] ?? STB_SCRATCH)]));
  return {
    o, flags: o.flags, clock, T: stationTables(), order, loaded: homeOf(stations), records,
    hw: structuredClone(STB_HW_REC),   // the machine's: one record, written to every station
    naaSeen: !o.flags.naaNone,   // mock: an NAA shows only after Refresh devices
    hidden: new Set(deadListings(Object.values(records))),   // listings a resolved pair left dead: hidden from every list (wizard §1.5)
    e: null,       // the one being edited: {name, rec, hw}
    runs: {},      // mock checks in flight or done, this edit: {ipv6, usb, rates}
    bringUp: false, pitch: false, at: 'overview',
    B: null, page: null, chainEl: null, acts: null, show: null, set: null,
  };
}

/**
 * @param {object} el  {btn: header button, chain: #body, body: #stbody, rail, page, others: {settings, snapshot(), profiles()},
 *                     bus: lib/bus.js}
 * @param {{name: string, active?: boolean}[]} stations  in the tree's order
 * @param {object} o  {profilesOf(station) → names, onRescan(), onSaved({names, loaded, renamed, restart}), openProfiles(station),
 *                    flags: model/flags.js (the mock checks' outcomes)}
 * @param {import('../lib/clock.js').Clock} [clock]
 */
export function mountStationBuilder({ btn, chain, body, rail, page, others, bus }, stations, o, clock = PLATFORM) {
  const sb = stationState(stations, o, clock);
  sb.page = page;
  sb.show = (id) => show(sb, id);
  /** Change the edited record and repaint what follows from it. */
  sb.set = (fn) => { fn(sb.e.rec, sb.e); sb.show(sb.at); };
  const B = mountBuilder({ btn, chain, body, bus }, shellSpec(sb, { rail, others }));
  sb.B = B;
  sb.chainEl = chainPic('Signal chain: the station\'s part lit', (id) => ['volume', 'output'].includes(id));
  B.pick.addEventListener('change', () => B.go({ st: ONE, name: B.pick.value }));
  sb.acts = B.buttons();
  B.load(B.cur);
  show(sb, 'overview');
  return B.start();
}
