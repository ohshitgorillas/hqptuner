// The Snapshot builder's body: the rail, the hairline, and the page of the snapshot being edited. The page runs its
// title row (Delete on a saved snapshot, Discard, Save, ×), its head (name window, stations menu, caption), the confirm
// line while a question is asked, then the rows. The body opens on the loaded station's first snapshot.

import { useEffect } from "preact/hooks";
import { html } from "../../../lib/dom.js";
import { NEW, keyOf } from "../../../model/builders/builder.js";
import {
  SNAP_COPY,
  editNow,
  change,
  recordOf,
  stations,
  home,
  snapshotBook,
} from "../../../store/faceplate/builders/snapshot.js";
import {
  cur,
  staged,
  ask,
  refused,
  save,
  remove,
  discard,
  confirm,
  answerAsk,
  cancelAsk,
  stateNow,
  openOn,
} from "../../../store/faceplate/builders/shell.js";
import { showBody } from "../../../store/faceplate/view.js";
import { bookWanted } from "../../../store/live/presets.js";
import { SnapshotRail } from "./SnapshotRail.js";
import { SnapshotRows } from "./SnapshotRows.js";
import { StationsMenu } from "./StationsMenu.js";

/** @typedef {import("../../../model/builders/snapshot.js").Edit} Edit */

/** Ask to delete the snapshot being edited; it goes on confirm. */
function askRemove() {
  confirm(SNAP_COPY.remove(cur.value.name), () => void remove({ book: snapshotBook() }));
}

/**
 * Save the edit through the shell: its name, its stations and the record it sends.
 *
 * @param {Edit} e
 */
function saveEdit(e) {
  return save({ book: snapshotBook(), name: e.name, to: e.stations, ...recordOf(e), copy: SNAP_COPY });
}

/**
 * The page title in the section header grammar: Delete on a saved snapshot, Discard and Save following the state, ×.
 *
 * @param {Edit} e
 */
function titleRow(e) {
  const isNew = cur.value.name === NEW;
  const s = stateNow({ dirty: staged.value.has(keyOf(cur.value)), ticked: e.stations.length > 0 });
  return html`
    <div class="sh btitle">
      <span class="t">Snapshot builder</span>
      <span class="ln"></span>
      ${isNew ? null : html`<button type="button" class="btn sm" onClick=${askRemove}>Delete</button>`}
      <button type="button" class="btn sm" disabled=${s?.discardOff ?? true} onClick=${discard}>Discard</button>
      <button type="button" class="btn sm" disabled=${s?.saveOff ?? true} onClick=${() => saveEdit(e)}>Save</button>
      <button type="button" class="round dx" aria-label="Close Snapshot builder" onClick=${() => showBody("chain")}>
        ×
      </button>
    </div>
  `;
}

/**
 * Rename the edit as typed; the refusal clears.
 *
 * @param {Event} ev
 */
function rename(ev) {
  const name = /** @type {HTMLInputElement} */ (ev.currentTarget).value;
  change((x) => {
    x.name = name;
  }, true);
  refused.value = false;
}

/** The caption: the refusal while refused, else the New snapshot's prompt. */
function captionText() {
  if (refused.value) return html`<span class="bref">${SNAP_COPY.noName}</span>`;
  return cur.value.name === NEW ? SNAP_COPY.select : "";
}

/**
 * The head: the name window, the stations menu, the caption.
 *
 * @param {Edit} e
 */
function head(e) {
  return html`
    <div class="bhead">
      <label class="vfd bname">
        <span class="l">Name</span>
        <input
          type="text"
          class="bnin"
          aria-label="Snapshot name"
          value=${e.name}
          maxlength="40"
          spellcheck="false"
          onInput=${rename}
        />
      </label>
      <${StationsMenu}
        stations=${stations()}
        ticked=${e.stations}
        name=${e.name}
        book=${snapshotBook()}
        cur=${cur.value}
        pick=${(/** @type {string[]} */ list) =>
          change((y) => {
            y.stations = list;
          }, true)}
      />
      <div class="bcap">${captionText()}</div>
    </div>
  `;
}

/** The confirm line: the question asked, Confirm, Cancel; nothing while none is asked. */
function askLine() {
  const q = ask.value;
  if (!q) return null;
  return html`
    <div class="bask" role="alert">
      <span>${q.text}</span>
      <button type="button" class="btn sm" onClick=${answerAsk}>Confirm</button>
      <button type="button" class="btn sm" onClick=${cancelAsk}>Cancel</button>
    </div>
  `;
}

/** The Snapshot builder's body: rail, hairline, page. */
export function SnapshotBuilder() {
  useEffect(() => {
    openOn(snapshotBook(), home());
    bookWanted.value = true;
  }, []);
  const e = editNow();
  return html`
    <div class="body" data-body="snapshots">
      <${SnapshotRail} />
      <div class="vrule"></div>
      <main class="page bpage" aria-label="Snapshot">
        ${titleRow(e)}
        ${head(e)}
        ${askLine()}
        <${SnapshotRows} />
      </main>
    </div>
  `;
}
