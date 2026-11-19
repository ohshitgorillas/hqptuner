// What the number box, slider and select suites share: the input element as a browser holds it, the document the
// element lives in once a control has taken it, the bounds and held value the numeric controls start from, and the
// tables of cases the controls answer alike. Each suite keeps its own gestures and its own control's props.

import { attach, domEvent as event, fire } from "../wheel.js";
import { classes } from "../markup.js";

/** @typedef {import("../markup.js").MarkupElement} MarkupElement */
/** @typedef {import("../wheel.js").VNode} VNode */

/** The value the owner holds unless a case says otherwise. */
export const HELD = "20";

/** The numeric controls' bounds and step. */
const MIN = 0;
const MAX = 50;
export const STEP = 1;

/**
 * The props every numeric control starts from: the held value, the bounds, the step and Off cleared.
 *
 * @param {string} aria  the control's name, as the owner hands it in
 */
export const numericProps = (aria) => ({
  value: HELD,
  aria,
  min: MIN,
  max: MAX,
  step: STEP,
  off: false,
});

/** The input element as a browser holds it: its text, and whether it has focus. */
export class FakeInput {
  /**
   * @param {string} type
   * @param {string} value
   */
  constructor(type, value) {
    this.type = type;
    this.value = value;
    this.tagName = "INPUT";
    this.disabled = false;
    /** @type {(() => void) | null} */
    this.onBlurred = null;
    /** @type {unknown} the document the element lives in, through which the page code reaches its window */
    this.ownerDocument = null;
  }

  /** The browser's numeric reading of the text: NaN for blank or non-numeric text. */
  get valueAsNumber() {
    return this.value.trim() === "" ? NaN : Number(this.value);
  }

  set valueAsNumber(n) {
    this.value = String(n);
  }

  blur() {
    if (this.onBlurred) this.onBlurred();
  }

  focus() {}

  addEventListener() {}

  removeEventListener() {}
}

/**
 * The document one control's element lives in: focus on the body, and a blur that hands focus back to it and tells
 * the control. The element is handed to the control's own node.
 *
 * @param {VNode} node
 * @param {{ ownerDocument: unknown, onBlurred: (() => void) | null }} el
 */
export function documentAround(node, el) {
  const body = {};
  const doc = {
    activeElement: /** @type {unknown} */ (body),
    body,
    defaultView: { scrollBy() {}, scroll() {} },
  };
  el.ownerDocument = doc;
  el.onBlurred = () => {
    doc.activeElement = body;
    fire(node, "onBlur", event("blur", el));
  };
  attach(node, el);
  return { body, doc };
}

/** The typed numbers a control clamps to its bounds, by the number it commits. */
export const clampedRows = () => [
  { name: "a_number_above_the_maximum_commits_as_the_maximum", chars: "80", want: MAX },
  { name: "a_number_below_the_minimum_commits_as_the_minimum", chars: "-5", want: MIN },
];

/**
 * The cases where Off grays the whole control and where it does not, named for the control `noun`.
 *
 * @param {string} noun
 */
export const grayedRows = (noun) => [
  { name: `an_off_${noun}_is_grayed_whole`, off: true, want: true },
  { name: `an_on_${noun}_is_not_grayed`, off: false, want: false },
];

/**
 * Whether the last element of a render, the control's outer, carries the grayed class; undefined when nothing rendered.
 *
 * @param {MarkupElement[]} els
 */
export const grayed = (els) => {
  const outer = els.at(-1);
  return outer ? classes(outer).includes("grayed") : undefined;
};
