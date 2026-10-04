// The shell's state line, its confirm line and the action buttons (Delete / Discard / Save) that follow the state.

import { h } from "../shell/dom.js";
import { NEW, stateOf } from "../../model/builders/builder.js";
import { confirm, discard, remove, save } from "./record.js";

/**
 * @template R, E
 * @typedef {import('./record.js').Shell<R, E>} Shell
 */
/**
 * @template R, E
 * @typedef {import('./builder.js').Spec<R, E>} Spec
 */

/** The state line and the caption beside it. */
export const stateParts = () => ({ stateLine: h("div.pbstate", { role: "status" }), cap: h("span.pbcap") });

/**
 * The state the line and buttons show for the record being edited.
 *
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {Spec<R, E>} spec
 * @param {boolean} d  the edit is dirty
 */
export const stateNow = (sh, spec, d) =>
  stateOf({
    dirty: d,
    isNew: sh.cur.name === NEW,
    ticked: spec.ticked?.() ?? true,
    restarts: !!spec.restarts?.(),
    live: !!spec.live?.(),
  });

/**
 * Enable or disable every Discard and Save as the state says.
 *
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {{ discardOff: boolean, saveOff: boolean }} s
 */
export function paintActs(sh, s) {
  for (const a of sh.acts) {
    a.discard.disabled = s.discardOff;
    if (a.save) a.save.disabled = s.saveOff;
  }
}

/**
 * Paint the state: the buttons, and where the spec has state copy, the state line and the refusal caption.
 *
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {Spec<R, E>} spec
 * @param {{ stateLine: HTMLElement, cap: HTMLElement }} parts
 */
export function paintState(sh, spec, { stateLine, cap }) {
  const d = spec.dirty();
  const s = stateNow(sh, spec, d);
  paintActs(sh, s);
  if (spec.copy.state) {
    stateLine.textContent = spec.copy.state[s.line];
    stateLine.classList.toggle("dirty", s.pending);
    cap.replaceChildren(sh.refused ? h("span.bref", { text: spec.copy.noName }) : "");
  }
  spec.painted?.(d);
}

/**
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {Spec<R, E>} spec
 */
const discardEl = (sh, spec) =>
  /** @type {HTMLButtonElement} */ (
    h("button.btn.sm", { type: "button", text: "Discard", on: { click: () => discard(sh, spec) } })
  );

/**
 * A Discard on its own (a drawer's head); it follows the state.
 *
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {Spec<R, E>} spec
 */
export function discardButton(sh, spec) {
  const el = discardEl(sh, spec);
  sh.acts.push({ discard: el });
  return el;
}

/**
 * Delete / Discard / Save; Discard and Save follow the state.
 *
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {Spec<R, E>} spec
 * @param {string} saveTag
 */
export function buttons(sh, spec, saveTag) {
  const del = h("button.btn.sm", {
    type: "button",
    text: "Delete",
    on: { click: () => confirm(sh, spec, spec.copy.remove(sh.cur.name), () => remove(sh, spec)) },
  });
  const discardBtn = discardEl(sh, spec);
  const saveBtn = /** @type {HTMLButtonElement} */ (
    h(saveTag, { type: "button", text: "Save", on: { click: () => save(sh, spec) } })
  );
  sh.acts.push({ discard: discardBtn, save: saveBtn });
  return { del, discard: discardBtn, save: saveBtn };
}

/**
 * The confirm line: the question asked, Confirm, Cancel.
 *
 * @template R, E
 * @param {Shell<R, E>} sh
 * @param {Pick<Spec<R, E>, 'view'>} spec
 */
export const askLine = (sh, spec) =>
  h(
    "div.bask",
    { role: "alert" },
    h("span", { text: sh.ask?.text }),
    h("button.btn.sm", {
      type: "button",
      text: "Confirm",
      on: {
        click: () => {
          const f = sh.ask?.onConfirm;
          sh.ask = null;
          f?.();
        },
      },
    }),
    h("button.btn.sm", {
      type: "button",
      text: "Cancel",
      on: {
        click: () => {
          sh.ask = null;
          spec.view(null);
        },
      },
    }),
  );
