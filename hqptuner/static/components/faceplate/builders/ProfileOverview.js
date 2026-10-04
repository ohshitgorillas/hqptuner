// The Profile builder's overview page: the title row with ×, the intro and what the profile holds beside the chain
// picture, the picker, the name window, the stations menu, the description, the confirm line, the state line and the
// ways on, then Advanced settings.

import { html } from "../../../lib/dom.js";
import { NEW, keyOf } from "../../../model/builders/builder.js";
import { holdSkipped, pickerOf, renderView } from "../../../model/builders/profile.js";
import {
  MATRIX_STAGES,
  OUTSIDE_STAGES,
  PB_COPY,
  PB_STEPS,
  PROFILE_COPY,
} from "../../../store/faceplate/builders/profile-data.js";
import {
  page,
  meta,
  dirty,
  valsNow,
  profileBook,
  setName,
  setDesc,
  setStations,
  switchTo,
  scratch,
  saveProfile,
  removeProfile,
  discardEdit,
  stateNow,
  skip,
  answerOf,
} from "../../../store/faceplate/builders/profile.js";
import {
  cur,
  staged,
  ask,
  refused,
  confirm,
  answerAsk,
  cancelAsk,
  isDirty,
} from "../../../store/faceplate/builders/shell.js";
import { home, stations } from "../../../store/faceplate/builders/snapshot.js";
import { presetProfiles } from "../../../store/matrix/profiles.js";
import { railStages, railNow } from "../../../store/faceplate/chain.js";
import { showBody, toggleStage } from "../../../store/faceplate/view.js";
import { StationsMenu } from "./StationsMenu.js";

/** @typedef {import("../../../model/builders/builder.js").Ref} Ref */
/** @typedef {import("../../../model/builders/builder.js").Line} Line */

export const TITLE = "Profile builder";
export const NOUN = "Profile";
export const NEW_LABEL = "New profile";
const CLOSE = "Close Profile builder";
const NAME = "Name";
const DIRTY = " •";
const DELETE = "Delete";
const DISCARD = "Discard";
const SAVE = "Save";
const CONFIRM = "Confirm";
const CANCEL = "Cancel";
const SHUT = "×";
const GO = "›";

/** The steps the overview's holds rows show, in order. */
const HOLD_IDS = ["eq", "crossfeed", "correction", "loudness"];

/** @type {Record<Line, string>} */
const STATE_TEXT = {
  restarts: PB_COPY.state.dirtyRun,
  dirty: PB_COPY.state.dirty,
  live: PB_COPY.state.running,
  saved: PB_COPY.state.saved,
};

/**
 * Show page `id`: the overview, a step, or Advanced settings.
 *
 * @param {string} id
 */
export const show = (id) => {
  page.value = id;
};

/** The DSP pipelines stage as the rail reads it. */
export const pipelinesStage = () =>
  railStages(railNow()).find((s) => s.id === "pipelines") ?? { id: "pipelines", name: "", value: "" };

/**
 * What the stations menu reads each station as holding: the loaded one's saved profiles, each other's listed names
 * less the profile being edited, which a station listing it holds as the same profile.
 *
 * @returns {Record<string, Record<string, unknown>>}
 */
function menuBook() {
  const h = home();
  /** @type {Record<string, string[]>} */
  const listed = presetProfiles.value;
  const others = stations().map((st) => [
    st,
    Object.fromEntries((listed[st] ?? []).filter((n) => n !== cur.value.name).map((n) => [n, null])),
  ]);
  return { ...Object.fromEntries(others), [h]: profileBook()[h] };
}

/** The title row: the builder's name and its ×. */
function titleRow() {
  return html`
    <div class="sh btitle">
      <span class="t">${TITLE}</span>
      <span class="ln"></span>
      <button type="button" class="round dx" aria-label=${CLOSE} onClick=${() => showBody("chain")}>${SHUT}</button>
    </div>
  `;
}

/**
 * One line of what the profile holds: its title, its reading, › to where it is set.
 *
 * @param {string} cls
 * @param {string} title
 * @param {string} value
 * @param {() => void} onClick
 */
function holdRow(cls, title, value, onClick) {
  return html`
    <button type="button" class=${cls} onClick=${onClick}>
      <b>${title}</b>
      <span class="pa">${value}</span>
      <span class="pgo" aria-hidden="true">${GO}</span>
    </button>
  `;
}

/** The holds: one row per step the profile holds, then DSP pipelines opening its drawer. */
function holds() {
  const vals = valsNow();
  const pl = pipelinesStage();
  return html`
    <div class="pbholds">
      <div class="pbhh">${PB_COPY.holds}</div>
      ${HOLD_IDS.map((id) => {
        const title = PB_STEPS.find((s) => s.id === id)?.title ?? id;
        const value = holdSkipped(id, skip(id), vals) ? PB_COPY.skipped : answerOf(id);
        return holdRow("pbhold", title, value, () => show(id));
      })}
      ${holdRow("pbhold pbpl", pl.name, pl.value, () => toggleStage("pipelines"))}
    </div>
  `;
}

/** The chain picture: every rail stage named, the matrix engine's part lit, the stages outside it marked. */
function chainPicture() {
  return html`
    <ol class="pbchain">
      ${railStages(railNow()).map(
        (s) => html`
          <li
            key=${s.id}
            class=${[
              MATRIX_STAGES.includes(s.id) ? "mx" : "",
              OUTSIDE_STAGES.includes(s.id) ? "out" : "",
              s.level ? "sub" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span class="d"></span>
            <span>${s.name}</span>
          </li>
        `,
      )}
    </ol>
  `;
}

/**
 * Switch to the record a picker value names: New in the loaded station, else the saved name its key carries.
 *
 * @param {Event} ev
 */
function pickRecord(ev) {
  const v = /** @type {HTMLSelectElement} */ (ev.currentTarget).value;
  if (v === NEW) return switchTo({ st: home(), name: NEW });
  const [st, name] = v.split("\u0001");
  return switchTo({ st, name });
}

/**
 * The picker: each station's profiles, a dirty one marked, then New profile.
 *
 * @param {boolean} d  the edit showing reads dirty
 */
function picker(d) {
  const book = profileBook();
  const groups = pickerOf(Object.keys(book), book, (/** @type {Ref} */ ref) => !!isDirty(ref, d));
  const view = renderView(cur.value, staged.value.has(NEW), d);
  return html`
    <label class="vfd pbpick">
      <span class="l">${NOUN}</span>
      <select aria-label=${NOUN} value=${keyOf(cur.value)} onChange=${pickRecord}>
        ${groups.map(
          (g) => html`
            <optgroup key=${g.st} label=${g.st}>
              ${g.options.map(
                (x) => html`<option key=${x.key} value=${x.key}>${x.dirty ? `${x.name}${DIRTY}` : x.name}</option>`,
              )}
            </optgroup>
          `,
        )}
        <option value=${NEW}>${view.newDirty ? `${NEW_LABEL}${DIRTY}` : NEW_LABEL}</option>
      </select>
    </label>
  `;
}

/**
 * The name window; read only on the station's unnamed profile.
 *
 * @param {boolean} fixed
 */
function nameWindow(fixed) {
  return html`
    <label class="vfd bname">
      <span class="l">${NAME}</span>
      <input
        type="text"
        class="bnin"
        aria-label=${`${NOUN} ${NAME.toLowerCase()}`}
        value=${meta.value.name}
        readonly=${fixed}
        maxlength="60"
        spellcheck="false"
        placeholder=${PROFILE_COPY.name}
        onInput=${(/** @type {Event} */ ev) => setName(/** @type {HTMLInputElement} */ (ev.currentTarget).value)}
      />
    </label>
  `;
}

/** The description, with its pencil. */
function description() {
  return html`
    <label class="desc pbdesc">
      <textarea
        aria-label=${`${NOUN} ${PROFILE_COPY.descLabel.toLowerCase()}`}
        spellcheck="false"
        maxlength="500"
        placeholder=${PROFILE_COPY.desc}
        value=${meta.value.desc}
        onInput=${(/** @type {Event} */ ev) => setDesc(/** @type {HTMLTextAreaElement} */ (ev.currentTarget).value)}
      ></textarea>
      <svg
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M10.5 2.5l3 3-8 8H2.5v-3z" />
        <path d="M9 4l3 3" />
      </svg>
    </label>
  `;
}

/** The confirm line: the question asked, Confirm, Cancel; nothing while none is asked. */
function askLine() {
  const q = ask.value;
  if (!q) return null;
  return html`
    <div class="bask" role="alert">
      <span>${q.text}</span>
      <button type="button" class="btn sm" onClick=${answerAsk}>${CONFIRM}</button>
      <button type="button" class="btn sm" onClick=${cancelAsk}>${CANCEL}</button>
    </div>
  `;
}

/** Ask to delete the profile being edited; it goes on confirm. */
function askRemove() {
  confirm(PROFILE_COPY.remove(cur.value.name), () => void removeProfile());
}

/**
 * The foot: the state line and caption, Start from scratch, Change something, Delete on a saved profile other than the
 * station's unnamed one, Discard and Save following the state.
 *
 * @param {boolean} deletable
 */
function foot(deletable) {
  const s = stateNow();
  return html`
    <div class="pbfoot">
      <div class="pbstw">
        <div class=${s.pending ? "pbstate dirty" : "pbstate"}>${STATE_TEXT[s.line]}</div>
        <div class="pbcap">${refused.value ? html`<span class="bref">${PROFILE_COPY.noName}</span>` : null}</div>
      </div>
      <span class="grow"></span>
      <button type="button" class="btn sm" onClick=${() => scratch()}>${PB_COPY.scratch}</button>
      <button type="button" class="btn sm" onClick=${() => show(PB_STEPS[0].id)}>${PB_COPY.change}</button>
      ${deletable ? html`<button type="button" class="btn sm" onClick=${askRemove}>${DELETE}</button>` : null}
      <button type="button" class="btn sm" disabled=${s.discardOff} onClick=${() => discardEdit()}>${DISCARD}</button>
      <button type="button" class="btn sm" disabled=${s.saveOff} onClick=${() => saveProfile()}>${SAVE}</button>
    </div>
  `;
}

/**
 * The overview: the title row, the intro and the holds beside the chain picture, which profile and the ways on, then
 * Advanced settings.
 */
export function ProfileOverview() {
  const d = dirty();
  const view = renderView(cur.value, staged.value.has(NEW), d);
  return html`
    <div class="pbov">
      ${titleRow()}
      <div class="pbovtop">
        <div class="pbovl">
          <p class="pbintro">${PB_COPY.intro}</p>
          ${holds()}
        </div>
        ${chainPicture()}
      </div>
      <div class="pbsavebox">
        <div class="pbid">
          ${picker(d)} ${nameWindow(view.fixedName)}
          <${StationsMenu}
            stations=${stations()}
            ticked=${meta.value.stations}
            name=${meta.value.name}
            book=${menuBook()}
            cur=${cur.value}
            pick=${setStations}
          />
        </div>
        ${description()}
        <div class="pbask">${askLine()}</div>
        ${foot(view.deletable)}
      </div>
      <button type="button" class="pbadvlink" onClick=${() => show("advanced")}>
        ${PB_COPY.advanced}<span aria-hidden="true">${` ${GO}`}</span>
      </button>
    </div>
  `;
}
