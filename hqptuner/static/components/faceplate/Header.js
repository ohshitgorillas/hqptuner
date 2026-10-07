// The faceplate's header row: the brand knob that lights the connection state, the mark, the Station · Snapshot tree,
// the two builders and the gear. The builders and the gear swap the plate's body and read pressed while it shows.
// In the tree a station's name loads that station, and a snapshot of the loaded station applies to the running engine;
// another station's snapshots wait for it to be loaded. An alert homed on the knob or the gear blinks it in the alert's
// colour. The knob's tap opens the connection panel, with a popover of the alert lines homed there over it when any are.

import { html } from "../../lib/dom.js";
import { connState } from "../../store/faceplate/conn.js";
import { stationTree, toggleStation } from "../../store/faceplate/stations.js";
import { snapshotTip } from "../../store/faceplate/builders/rows.js";
import { body, showBody, openPopover, plate } from "../../store/faceplate/view.js";
import { activePreset } from "../../store/resolve.js";
import { loadPreset } from "../../store/actions.js";
import { openSetup } from "../../store/setup.js";
import { applyLivePreset } from "../../store/live/presets.js";
import { alertsNow, alertNotes } from "../../store/faceplate/alerts.js";
import { clampToPlate } from "../../model/shell/place.js";
import { Popover, triggerProps } from "./Popover.js";
import { AlertLines } from "./AlertLines.js";

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

/**
 * The popover id of a header home's alert lines.
 *
 * @param {string} el  the home's name
 */
export const noteId = (el) => `alerts-${el}`;

/**
 * Park an alert popover 8 px under its home, kept off the plate's sides and foot. The home is any element carrying the
 * popover's id, the gauge being no button.
 *
 * @param {HTMLElement} panel
 */
function parkNote(panel) {
  const face = panel.closest(".plate");
  const home = face?.querySelector(`[data-pop="${panel.dataset.pop}"]:not(.pop)`);
  if (!face || !home) return;
  const box = home.getBoundingClientRect(),
    origin = face.getBoundingClientRect();
  const fit = plate.value;
  const at = clampToPlate({
    anchor: { left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height },
    panel: { w: panel.offsetWidth, h: panel.offsetHeight },
    plate: { w: fit.w, h: fit.h },
    scale: fit.scale,
    side: 22,
    foot: 14,
    at: { x: "start", y: "below", gap: 8 },
  });
  panel.style.left = `${Math.round(at.left)}px`;
  panel.style.top = `${Math.round(at.top)}px`;
}

/**
 * The popover of the alert lines homed on a header element, one line per alert in raised order. Draws nothing while
 * none is homed there.
 *
 * @param {{ el: string }} props  the home's name
 */
export function AlertNote({ el }) {
  const lines = alertNotes(el);
  if (!lines.length) return null;
  return html`
    <${Popover} id=${noteId(el)} cls="notepop alnote" role="dialog" label="Alert" park=${parkNote}>
      <${AlertLines} alerts=${lines} />
    <//>
  `;
}

/**
 * The brand knob: its ring lights the connection state, which is also its name and its tooltip's lead. Its tap opens the
 * connection panel. An alert homed on it blinks the ring, and the tap then also opens the alert lines over the panel.
 */
function Knob() {
  const s = connState();
  const alert = alertsNow.value.blinks.el.get("conn");
  const note = alert ? triggerProps(noteId("conn"), "dialog") : null;
  const onTap = () => {
    openSetup();
    note?.onClick();
  };
  return html`
    <button
      type="button"
      class="conn"
      data-testid="conn"
      data-state=${s}
      data-alert=${alert}
      aria-label=${`${STATES[s]}. Connection settings`}
      title=${`${STATES[s]} — ${HINT}`}
      ...${note ?? {}}
      onClick=${onTap}
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
 * A snapshot's row, titled with what it holds. Under the loaded station it is a button whose tap applies it; under any
 * other it waits for that station to load.
 *
 * @param {Station} st
 * @param {Station["snapshots"][number]} sn
 */
const snapshotRow = (st, sn) =>
  st.active
    ? html`
        <button
          type="button"
          class="srow"
          data-testid="snapshot"
          title=${snapshotTip(sn.rec)}
          onClick=${() => applyLivePreset(sn.name)}
        >
          <span class="pn">${sn.name}</span>
        </button>
      `
    : html`
        <div class="srow" data-testid="snapshot" title=${snapshotTip(sn.rec)}>
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
      <button type="button" class="pn" data-testid="station-name" onClick=${() => loadPreset(st.name)}>
        ${st.name}
      </button>
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
      <${AlertNote} el="conn" />
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
      <button
        type="button"
        class="round gear"
        data-testid="settings"
        data-alert=${alertsNow.value.blinks.el.get("gear")}
        aria-label=${body.value === "settings" ? "Close settings" : "Settings"}
        ...${bodyProps("settings")}
      >
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
