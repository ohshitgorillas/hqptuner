// The app's one "ask the user something" affordance — the replacement for the
// native prompt()/confirm() dialogs, which are unstyleable against the rest of
// the app, not gracefully cancellable, and blocked outright in some embedded
// browsers.
//
// A question is a promise: askName / askConfirm resolve when the UI calls
// answer() or cancel(), so a caller reads exactly like the native call it
// replaces. `owner` names the component that asked, so the field or the confirm
// line renders INLINE where the action was taken (the pending bar, the header)
// instead of floating over the page. One question is open at a time.
import { signal } from "@preact/signals";

// The open question — { owner, kind, message, cancelled, refused } — or null.
/**
 * @typedef {object} Question
 *   The one open question. `cancelled` is what "no answer" resolves to for this
 *   kind: null for a name or a choice set, false for a confirm.
 * @property {string} owner component that asked — where the question renders
 * @property {string} kind name | confirm | choices | warn
 * @property {string} message
 * @property {string | boolean | null} cancelled
 * @property {boolean} refused a blank name was submitted and not committed
 * @property {ChoiceOption[]} [options] choices only
 * @property {boolean} [named] choices only — the panel also asks for a name
 * @property {string} [confirm] warn only — wording of the button that proceeds
 * @property {string} [decline] warn only — wording of the button that backs out
 */

// The signals package is declared ambiently (types/vendor.d.ts), so `signal()`
// answers `any` and the shape above cannot be pinned on the signal itself; the
// two places that read `options` back name ChoiceOption inline instead.
export const question = signal(null);

/** @type {((value: unknown) => void) | null} */
let settle = null;

/**
 * @param {unknown} value
 * @returns {void}
 */
function close(value) {
  const done = settle;
  settle = null;
  question.value = null;
  if (done) done(value);
}

/**
 * @param {string} owner
 * @param {string} kind
 * @param {string} message
 * @param {string | boolean | null} cancelled
 * @returns {Promise<unknown>}
 */
function open(owner, kind, message, cancelled) {
  cancel(); // a second question supersedes the first rather than stranding it
  return new Promise((resolve) => {
    settle = resolve;
    question.value = { owner, kind, message, cancelled, refused: false };
  });
}

// Ask for a name. Resolves the trimmed name, or null if the user backs out.
/** Open a name question, resolving the trimmed name or null if the user backs out. */
export const askName = (/** @type {string} */ owner, /** @type {string} */ message) =>
  open(owner, "name", message, null);

// Ask for a yes/no. Resolves true only on an explicit confirm.
/** Open a yes/no question, resolving true only on an explicit confirm. */
export const askConfirm = (/** @type {string} */ owner, /** @type {string} */ message) =>
  open(owner, "confirm", message, false);

// Warn before a hazardous edit. Same yes/no contract as a confirm, but the UI
// renders it as a top-layer popover with explicit consequence wording instead
// of an inline Confirm/Cancel line.
//
// The buttons carry their own wording, because a warning's two answers are only
// as clear as the words on them: the buffer warnings are asking whether the user
// is sure they know better than the daemon's own guidance, while the Direct SDM
// warning is a plain yes/no about a documented consequence. Callers that omit
// labels get the buffer wording.
const WARN_LABELS = { confirm: "Yes, I know what I'm doing, set it", decline: "Revert the change" };

/**
 * Open a warn question, resolving true only on an explicit confirm.
 *
 * @param {string} owner
 * @param {string} message
 * @param {{ confirm: string, decline: string }} [labels] button wording
 * @returns {Promise<unknown>}
 */
export function askWarn(owner, message, labels = WARN_LABELS) {
  const q = open(owner, "warn", message, false);
  question.value = { ...question.value, confirm: labels.confirm, decline: labels.decline };
  return q;
}

// Ask for a subset of options: [{value, label, checked, disabled}]. Resolves
// the checked values in option order, or null if the user backs out. A disabled
// option's checked state is pinned — rendered for honesty, immune to clicks.
// With `{name: true}` the panel also carries a name field and resolves
// {name, values} instead; a blank name is refused the way askName refuses it.
/**
 * Open a multiple-choice question, resolving the checked values in option order
 * (or {name, values} when a name is asked for too) or null if the user backs out.
 *
 * @param {string} owner
 * @param {string} message
 * @param {ChoiceOption[]} options
 * @param {{ name?: boolean }} [opts]
 * @returns {Promise<unknown>}
 */
export function askChoices(owner, message, options, opts = {}) {
  const q = open(owner, "choices", message, null);
  question.value = { ...question.value, options: options.map((o) => ({ ...o })), named: !!opts.name };
  return q;
}

// Flip one choice by value. Disabled options stay as offered.
/**
 * Flip one choice's checked state by value, leaving disabled options as offered.
 *
 * @param {string} value
 * @returns {void}
 */
export function toggleChoice(value) {
  const q = question.value;
  if (!q || q.kind !== "choices") return;
  question.value = {
    ...q,
    options: q.options.map((/** @type {ChoiceOption} */ o) =>
      o.value === value && !o.disabled ? { ...o, checked: !o.checked } : o,
    ),
  };
}

// Commit the answer. A blank or whitespace-only name is REFUSED: nothing is
// committed and the field stays open, so a stray Enter cannot save a nameless
// preset. The refusal is FLAGGED rather than silent — a field that swallows a
// Save click without a word is indistinguishable from one that saved and did
// nothing. A confirm has nothing to type — reaching here at all means yes.
/**
 * Resolve the open question with the user's answer, or flag a blank name as
 * refused and leave the question standing.
 *
 * @param {string | null | undefined} [value] the typed name; unused by the other kinds
 * @returns {void}
 */
export function answer(value) {
  const q = question.value;
  if (!q) return;
  const name = String(value == null ? "" : value).trim();
  if (q.kind === "choices") {
    const values = q.options
      .filter((/** @type {ChoiceOption} */ o) => o.checked)
      .map((/** @type {ChoiceOption} */ o) => o.value);
    if (!q.named) close(values);
    else if (name) close({ name, values });
    else question.value = { ...q, refused: true };
    return;
  }
  if (q.kind !== "name") {
    close(true);
    return;
  }
  if (name) close(name);
  else question.value = { ...q, refused: true };
}

// Withdraw a standing refusal — the user is typing, so the complaint about an
// empty field has stopped being true.
/** Clear a standing blank-name refusal, called as the user types. */
export function clearRefusal() {
  const q = question.value;
  if (q && q.refused) question.value = { ...q, refused: false };
}

// Withdraw the question, resolving whatever "no answer" means for its kind.
/** Withdraw the open question, resolving whatever "no answer" means for its kind. */
export function cancel() {
  const q = question.value;
  if (q) close(q.cancelled);
}
