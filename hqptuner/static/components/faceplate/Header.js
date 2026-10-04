// The faceplate's header row: the brand knob that lights the connection state, the mark, the Station · Snapshot tree,
// the two builders and the gear. The builders and the gear swap the plate's body and read pressed while it shows.
// In the tree a station's name loads that station, and a snapshot of the loaded station applies to the running engine;
// another station's snapshots wait for it to be loaded.

import { html } from "../../lib/dom.js";
import { connState } from "../../store/faceplate/conn.js";
import { stationTree, toggleStation } from "../../store/faceplate/stations.js";
import { body, showBody, openPopover } from "../../store/faceplate/view.js";
import { activePreset } from "../../store/resolve.js";
import { loadPreset } from "../../store/actions.js";
import { applyLivePreset } from "../../store/live/presets.js";
import { Popover, triggerProps } from "./Popover.js";

/** @typedef {import("../../store/faceplate/conn.js").ConnState} ConnState */
/** @typedef {import("../../store/faceplate/stations.js").Station} Station */
/** @typedef {import("../../store/faceplate/view.js").Body} Body */

/** @type {Record<ConnState, string>} */
const STATES = {
  ok: "Connected",
  busy: "Applying…",
  lost: "Unreachable",
};
const HINT = "Open connection settings to set the HQPlayer Embedded server's IP address and authentication details.";

const TREE = "stations";
const MIN_WIDTH = 330;

/** The brand knob: its ring lights the connection state, which is also its name and its tooltip's lead. */
function Knob() {
  const s = connState();
  return html`
    <button
      type="button"
      class="conn"
      data-testid="conn"
      data-state=${s}
      aria-label=${`${STATES[s]}. Connection settings`}
      title=${`${STATES[s]} — ${HINT}`}
    >
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <circle class="ring" cx="16" cy="16" r="11.5" />
        <line class="ptr" x1="16" y1="16" x2="16" y2="7" />
        <circle class="hub" cx="16" cy="16" r="1.6" />
      </svg>
    </button>
  `;
}

/**
 * Park the tree's panel under its trigger, at least as wide as the trigger. Both sit in the header's station group.
 *
 * @param {HTMLElement} panel
 */
function park(panel) {
  const trigger = panel.parentElement?.querySelector(`button[data-pop="${TREE}"]`);
  if (!(trigger instanceof HTMLElement)) return;
  panel.style.left = `${trigger.offsetLeft}px`;
  panel.style.width = `${Math.max(MIN_WIDTH, trigger.offsetWidth)}px`;
}

/**
 * A snapshot's row. Under the loaded station a tap applies it; under any other it waits for that station to load.
 *
 * @param {Station} st
 * @param {{ name: string }} sn
 */
const snapshotRow = (st, sn) => html`
  <div class="srow" data-testid="snapshot" onClick=${st.active ? () => applyLivePreset(sn.name) : undefined}>
    <span class="pn">${sn.name}</span>
  </div>
`;

/**
 * A station's snapshots, shown while it is unfolded.
 *
 * @param {Station} st
 */
const snapshotGroup = (st) => html`
  <div role="group" data-testid="snapshots" data-station=${st.name} hidden=${!st.open}>
    ${st.snapshots.map((sn) => snapshotRow(st, sn))}
  </div>
`;

/**
 * A station's row, with the chevron that unfolds its snapshots, and the group of those snapshots when it has any.
 *
 * @param {Station} st
 */
function stationRows(st) {
  const has = st.snapshots.length > 0;
  return html`
    <div class=${st.active ? "prow cur" : "prow"} data-testid="station-row" data-station=${st.name}>
      <button
        type="button"
        class=${has ? "chev" : "chev none"}
        data-testid="unfold"
        data-station=${st.name}
        aria-label=${has ? `Show ${st.name} snapshots` : undefined}
        aria-expanded=${has ? String(st.open) : undefined}
        tabindex=${has ? undefined : -1}
        onClick=${has ? () => toggleStation(st.name) : undefined}
      >
        ${st.open ? "▾" : "▸"}
      </button>
      <span class="pn" data-testid="station-name" onClick=${() => loadPreset(st.name)}>${st.name}</span>
      ${st.active ? html`<span class="lamp on"></span>` : html`<span class="rs">↻ restart</span>`}
    </div>
    ${has ? snapshotGroup(st) : null}
  `;
}

/** The Station · Snapshot tree: a trigger naming the loaded station, and the panel listing every station. */
function StationTree() {
  const open = openPopover.value === TREE;
  return html`
    <button type="button" class="vfd tree" data-testid="stations" ...${triggerProps(TREE, "listbox")}>
      <span class="v">${activePreset.value || "(no preset)"}</span>
      <span class="ar">${open ? "▲" : "▼"}</span>
    </button>
    <${Popover} id=${TREE} role="listbox" label="Stations and snapshots" park=${park}>
      ${stationTree().map(stationRows)}
    <//>
  `;
}

/**
 * A button that swaps the plate's body, pressed while that body shows.
 *
 * @param {Body} name
 */
const bodyProps = (name) => ({
  "aria-pressed": String(body.value === name),
  onClick: () => showBody(name),
});

/** The header row. */
export function Header() {
  return html`
    <header class="hdr">
      <${Knob} />
      <div class="mark">HQPTUNER</div>
      <div class="station">
        <span class="eng">Station · Snapshot</span>
        <${StationTree} />
      </div>
      <button type="button" class="btn hb" data-testid="station-builder" ...${bodyProps("station")}>
        Station builder
      </button>
      <button type="button" class="btn hb" data-testid="snapshot-builder" ...${bodyProps("snapshots")}>
        Snapshot builder
      </button>
      <button type="button" class="round gear" data-testid="settings" aria-label="Settings" ...${bodyProps("settings")}>
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
          />
        </svg>
      </button>
    </header>
  `;
}
