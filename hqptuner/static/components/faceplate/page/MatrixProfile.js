// The page's Matrix profile section. Its body: the profile select and the Profile builder button, the running profile's
// description in a well the user edits in place, and the running profile's response beside them. Folded, the section
// carries the select and the button alone on its header line. The select switches the running matrix live; the
// response is the magnitude of the pipelines the engine runs, one curve per distinct chain, as v1's matrix plot draws
// them (components/matrix/plot-traces.js); a crossfeed block's internal rows draw as the EQ it was built from.

import { useEffect } from "preact/hooks";
import { html } from "../../../lib/dom.js";
import { parseProcess } from "../../../vendor/eqlab/core/matrixspec.js";
import { pipelineBaseline } from "../../../store/resolve.js";
import { xfeedBlock } from "../../../store/xfeed/block.js";
import { structuralBlock } from "../../../store/xfeed/mode.js";
import { body, showBody } from "../../../store/faceplate/view.js";
import {
  profileChoices,
  switchProfile,
  profileDescription,
  editDescription,
  leaveDescription,
} from "../../../store/faceplate/page/profile.js";
import { rowTraces, eqOverviewTrace } from "../../matrix/plot-traces.js";
import { RespPlot } from "../drawers/loudness/RespPlot.js";

/** @typedef {import("../../matrix/plot-traces.js").PipelineRow} PipelineRow */
/** @typedef {import("../drawers/loudness/RespPlot.js").Trace} Trace */

/** The window's half-height in dB before a curve needs more, and the step it widens by. */
const RANGE = 12;
const STEP = 6;

/**
 * The rows that plot as rows: every pipeline carrying processing, less a crossfeed block's internal rows.
 *
 * @param {PipelineRow[]} rows
 * @returns {number[]}
 */
function plottedRows(rows) {
  const skip = structuralBlock(rows) ? 16 : xfeedBlock(rows).rec ? 8 : 0;
  return rows.flatMap((r, i) => (i >= skip && parseProcess(r.process).length > 0 ? [i] : []));
}

/**
 * dB at any frequency from a curve sampled on a log axis, read between its two nearest samples.
 *
 * @param {[number, number][]} points
 * @returns {(f: number) => number}
 */
const sampled = (points) => (f) => {
  let i = 1;
  while (i < points.length - 1 && points[i][0] < f) i++;
  const [f0, d0] = points[i - 1];
  const [f1, d1] = points[i];
  const t = Math.min(1, Math.max(0, Math.log(f / f0) / Math.log(f1 / f0)));
  return d0 + (d1 - d0) * t;
};

/**
 * A pipeline set's response: its magnitude curves, each named once there are two or more, and the half-height of the
 * window that holds them, ±12 dB widened in 6 dB steps.
 *
 * @param {PipelineRow[]} rows
 * @returns {{ traces: Trace[], range: number }}
 */
export function responsePlot(rows) {
  const bounds = { min: 0, max: 0 };
  const plotted = plottedRows(rows);
  const curves = plotted.length ? rowTraces(rows, plotted, bounds).traces : eqOverviewTrace(rows, bounds) || [];
  const mags = curves.filter((t) => !t.y2 && t.points.length > 1);
  const reach = Math.max(-bounds.min, bounds.max);
  return {
    traces: mags.map((t) => ({ fn: sampled(t.points), label: mags.length > 1 ? t.label : undefined })),
    range: Math.max(RANGE, Math.ceil(reach / STEP) * STEP),
  };
}

/** The select and the Profile builder button: the section's first line, and its header line while folded. */
export function ProfileLine() {
  const { value, options, busy } = profileChoices();
  return html`
    <div class="inline">
      <select
        class="vfd"
        data-testid="profile-select"
        aria-label="Matrix profile"
        disabled=${busy}
        onChange=${(/** @type {{ currentTarget: { value: string } }} */ e) => switchProfile(e.currentTarget.value)}
      >
        ${options.map(
          (o) =>
            html`<option
              value=${o.value}
              selected=${o.value === value}
              disabled=${o.disabled}
              title=${o.reason || undefined}
            >
              ${o.label}
            </option>`,
        )}
      </select>
      <button
        type="button"
        class="btn"
        data-testid="profile-builder"
        aria-pressed=${String(body.value === "profile")}
        onClick=${() => showBody("profile")}
      >
        Profile builder
      </button>
    </div>
  `;
}

/** The running profile's description, edited in place; what was typed is written when the well loses focus or leaves. */
function Well() {
  const { text } = profileDescription();
  useEffect(() => () => void leaveDescription(), []);
  return html`
    <label class="desc">
      <textarea
        data-testid="profile-description"
        aria-label="Matrix profile description"
        spellcheck="false"
        maxlength="500"
        value=${text}
        onInput=${(/** @type {{ currentTarget: { value: string } }} */ e) => editDescription(e.currentTarget.value)}
        onBlur=${() => leaveDescription()}
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

/** The section's body: the select line, a refused switch's sentence, the description well, and the response plot. */
export function MatrixProfileBody() {
  const { error } = profileChoices();
  const { traces, range } = responsePlot(/** @type {PipelineRow[]} */ (pipelineBaseline.value));
  return html`
    <div class="stack mstack">
      <${ProfileLine} />
      ${
        error &&
        html`<p class="aline" data-sev="crit" role="alert">
        <span class="ag" aria-hidden="true">⚠</span>
        <span data-testid="profile-error">${error}</span>
      </p>`
      }
      <${Well} />
    </div>
    <${RespPlot}
      cls="eq"
      aria="Matrix response"
      scale=${{ lo: -range, hi: range, step: STEP, minor: STEP / 2 }}
      traces=${traces}
    />
  `;
}
