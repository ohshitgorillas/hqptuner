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
export const question = signal(null);

let settle = null;

function close(value) {
  const done = settle;
  settle = null;
  question.value = null;
  if (done) done(value);
}

function open(owner, kind, message, cancelled) {
  cancel(); // a second question supersedes the first rather than stranding it
  return new Promise((resolve) => {
    settle = resolve;
    question.value = { owner, kind, message, cancelled, refused: false };
  });
}

// Ask for a name. Resolves the trimmed name, or null if the user backs out.
export const askName = (owner, message) => open(owner, "name", message, null);

// Ask for a yes/no. Resolves true only on an explicit confirm.
export const askConfirm = (owner, message) => open(owner, "confirm", message, false);

// Ask for a subset of options: [{value, label, checked, disabled}]. Resolves
// the checked values in option order, or null if the user backs out. A disabled
// option's checked state is pinned — rendered for honesty, immune to clicks.
export function askChoices(owner, message, options) {
  const q = open(owner, "choices", message, null);
  question.value = { ...question.value, options: options.map((o) => ({ ...o })) };
  return q;
}

// Flip one choice by value. Disabled options stay as offered.
export function toggleChoice(value) {
  const q = question.value;
  if (!q || q.kind !== "choices") return;
  question.value = {
    ...q,
    options: q.options.map((o) => (o.value === value && !o.disabled ? { ...o, checked: !o.checked } : o)),
  };
}

// Commit the answer. A blank or whitespace-only name is REFUSED: nothing is
// committed and the field stays open, so a stray Enter cannot save a nameless
// preset. The refusal is FLAGGED rather than silent — a field that swallows a
// Save click without a word is indistinguishable from one that saved and did
// nothing. A confirm has nothing to type — reaching here at all means yes.
export function answer(value) {
  const q = question.value;
  if (!q) return;
  if (q.kind === "choices") {
    close(q.options.filter((o) => o.checked).map((o) => o.value));
    return;
  }
  if (q.kind !== "name") {
    close(true);
    return;
  }
  const name = String(value == null ? "" : value).trim();
  if (name) close(name);
  else question.value = { ...q, refused: true };
}

// Withdraw a standing refusal — the user is typing, so the complaint about an
// empty field has stopped being true.
export function clearRefusal() {
  const q = question.value;
  if (q && q.refused) question.value = { ...q, refused: false };
}

// Withdraw the question, resolving whatever "no answer" means for its kind.
export function cancel() {
  const q = question.value;
  if (q) close(q.cancelled);
}
