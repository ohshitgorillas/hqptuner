// What a drag does at each event: whether the page holds the value and what it writes.

/**
 * @typedef {"stage" | "preview" | "throttle"} DragMode
 * @typedef {"move" | "drop"} DragEvent
 * @typedef {{ local: "hold" | "clear", write: "none" | "stage" | "live" | "live-throttled" }} DragStep
 */

/**
 * Whether the page holds the value and what it writes, for a drag mode at a move or a drop.
 *
 * @param {DragMode} _mode
 * @param {DragEvent} _event
 * @returns {DragStep}
 */
export const dragStep = (_mode, _event) => ({ local: "clear", write: "none" });
