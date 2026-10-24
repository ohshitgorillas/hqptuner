import { effect, signal } from "@preact/signals";
import { api } from "../../../lib/api.js";
import { PLATFORM } from "../../../lib/clock.js";
import { dragStep } from "../../../model/store/drag.js";
import { setControl } from "../../actions.js";
import { field, holdDrag, refreshReadings } from "../../core/readings.js";
import { latest, op, STALE } from "../../core/ops.js";
import { schema } from "../../schema.js";
import { openStage } from "../view.js";

/** @typedef {import("../../../model/store/drag.js").DragMode} DragMode */
/** @typedef {import("../../../model/store/reading.js").Bounds} Bounds */
/** @typedef {import("../../../lib/clock.js").Clock} Clock */
/** @typedef {{ get: (name: string, init: unknown) => { value: unknown }, reset: () => void }} Session */
/**
 * @typedef {object} Control
 * @property {unknown} value
 * @property {boolean} dirty
 * @property {string} gray
 * @property {boolean} restart
 * @property {Bounds} bounds
 * @property {(v: unknown) => void | Promise<void>} move
 * @property {(v: unknown) => void | Promise<void>} drop
 * @property {(v: unknown) => Promise<void>} pick
 */

/** @type {WeakMap<Session, Set<() => void>>} */
const cleanups = new WeakMap();

/** State and held gestures belonging to one drawer opening. @param {string} stage @returns {Session} */
export function drawerSession(stage) {
  /** @type {Map<string, { value: unknown }>} */
  const values = new Map();
  /** @type {Set<() => void>} */
  const releases = new Set();
  const session = {
    get(/** @type {string} */ name, /** @type {unknown} */ init) {
      const cached = values.get(name);
      if (cached) return cached;
      const value = signal(init);
      values.set(name, value);
      return value;
    },
    reset() {
      for (const release of releases) release();
      releases.clear();
      values.clear();
    },
  };
  cleanups.set(session, releases);
  let previous = openStage.value;
  effect(() => {
    const next = openStage.value;
    if (next !== previous && (previous === stage || next === stage)) session.reset();
    previous = next;
  });
  return session;
}

/** Write ownership lasts through the adopted readback. @param {string} key */
function controlWrites(key) {
  const liveOp = op("live", { engine: true });
  const stageOp = op("apply", { engine: false });
  const newest = latest();
  /** @type {(() => void) | undefined} */
  let heldRelease;
  const hold = (/** @type {unknown} */ value) => {
    heldRelease = holdDrag(key, value);
  };
  const releaseHeld = () => heldRelease?.();
  const invalidate = () => {
    void newest(Promise.resolve());
  };
  /** @param {unknown} v @param {boolean} staged @param {boolean} dropped */
  const run = async (v, staged, dropped) => {
    const release = heldRelease;
    const operation = staged ? stageOp : liveOp;
    const result = await newest(
      operation.run(async () => {
        try {
          if (staged) await setControl(key, String(v));
          else if (field(key).value.lane === "volume") await api.setVolume(String(v));
          else await api.live({ [schema[key]?.field ?? key]: String(v) });
        } finally {
          await refreshReadings();
        }
      }),
    );
    if (dropped && result !== STALE) release?.();
  };
  return { run, invalidate, hold, releaseHeld };
}

/** A control's paced writes and opening cleanup. @param {string} key @param {Clock} clock */
function controlWriter(key, clock) {
  const writes = controlWrites(key);
  let lastWrite = -Infinity;
  /** @type {unknown} */
  let timer = null;
  /** @type {unknown} */
  let pending;
  const cancel = () => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };
  const release = () => {
    cancel();
    writes.releaseHeld();
    lastWrite = -Infinity;
    writes.invalidate();
  };

  /** @param {unknown} v @param {boolean} dropped */
  const live = (v, dropped) => {
    lastWrite = clock.now();
    return writes.run(v, false, dropped);
  };

  /** @param {unknown} v */
  const throttle = (v) => {
    pending = v;
    const remaining = 100 - (clock.now() - lastWrite);
    if (remaining <= 0) {
      cancel();
      return live(v, false);
    }
    if (timer === null)
      timer = clock.setTimeout(() => {
        timer = null;
        void live(pending, false);
      }, remaining);
    return undefined;
  };
  return { live, throttle, cancel, release, ...writes };
}

/**
 * Bind a drawer control to its served field and gesture mode.
 * @param {string} key
 * @param {{ drag?: DragMode, session?: Session, clock?: Clock }} [options]
 * @returns {Control}
 */
export function control(key, { drag = "stage", session, clock = PLATFORM } = {}) {
  const view = field(key);
  const writer = controlWriter(key, clock);

  /** @param {import("../../../model/store/drag.js").DragEvent} event @param {unknown} v */
  const gesture = (event, v) => {
    if (session) cleanups.get(session)?.add(writer.release);
    writer.invalidate();
    const step = dragStep(drag, event);
    writer.hold(v);
    if (event === "drop") writer.cancel();
    if (step.write === "stage") return writer.run(v, true, step.local === "clear");
    if (step.write === "live") return writer.live(v, true);
    if (step.write === "live-throttled") return writer.throttle(v);
    return undefined;
  };

  return {
    get value() {
      return view.value.value;
    },
    get dirty() {
      return view.value.dirty;
    },
    get restart() {
      return view.value.restart;
    },
    get bounds() {
      return view.value.bounds;
    },
    get gray() {
      return (
        schema[key]?.grayWhen?.({
          mode: String(field("output_mode").value.value ?? ""),
          effective: (name) =>
            /** @type {string | number | boolean | undefined} */ (
              field(name).value.staged ?? field(name).value.running
            ),
        }) ?? ""
      );
    },
    move: (v) => gesture("move", v),
    drop: (v) => gesture("drop", v),
    async pick(v) {
      if (String(v) === String(view.value.value)) return;
      if (session) cleanups.get(session)?.add(writer.release);
      writer.invalidate();
      writer.cancel();
      writer.hold(v);
      await writer.run(v, true, true);
    },
  };
}
