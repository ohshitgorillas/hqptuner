// What a drag does at each event: whether the page holds the value and what it writes.

/**
 * @typedef {"stage" | "stage-each" | "preview" | "throttle"} DragMode
 * @typedef {"move" | "drop"} DragEvent
 * @typedef {{ local: "hold" | "clear", write: "none" | "stage" | "live" | "live-throttled" }} DragStep
 */

/** @type {Record<DragMode, Record<DragEvent, DragStep>>} */
const STEPS = {
  stage: {
    move: { local: "hold", write: "none" },
    drop: { local: "clear", write: "stage" },
  },
  "stage-each": {
    move: { local: "hold", write: "stage" },
    drop: { local: "clear", write: "stage" },
  },
  preview: {
    move: { local: "hold", write: "none" },
    drop: { local: "hold", write: "live" },
  },
  throttle: {
    move: { local: "hold", write: "live-throttled" },
    drop: { local: "hold", write: "live" },
  },
};

/**
 * Whether the page holds the value and what it writes, for a drag mode at a move or a drop.
 *
 * @param {DragMode} mode
 * @param {DragEvent} event
 * @returns {DragStep}
 */
export const dragStep = (mode, event) => ({ ...STEPS[mode][event] });
