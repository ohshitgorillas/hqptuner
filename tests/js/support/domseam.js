// The document a browser gives lib/dom.js to register its capture listeners on.
//
// dom.js tracks the provenance of a slider edit from document-level listeners it
// installs at module load, so a document has to EXIST before dom.js is imported
// — anything importing dom.js (directly, or through a component) must therefore
// import this module first. Kept as its own module rather than folded into
// pointer.js or wheel.js for exactly that reason: those two are imported by
// suites that want no document at all, and installing one for them would change
// the environment their cases already run green in.
//
// `documentSees` replays an event to every listener registered for its type,
// which is what the capture phase does: a listener on the document sees an event
// whatever element it targets. The events are plain objects carrying the surface
// those listeners read, and nothing of HQPTuner's is stubbed.

const registered = new Map();

globalThis.document = {
  addEventListener(type, fn) {
    if (typeof fn !== "function") return;
    registered.set(type, [...(registered.get(type) || []), fn]);
  },
  removeEventListener(type, fn) {
    registered.set(
      type,
      (registered.get(type) || []).filter((l) => l !== fn),
    );
  },
  body: { addEventListener() {}, removeEventListener() {} },
};

export function documentSees(type, target, extra = {}) {
  const event = { type, target, ...extra };
  for (const fn of registered.get(type) || []) fn(event);
}
