// The Crossfeed block's Bauer line (HQPlayer's post-process, libbs2b): Preset, then Frequency and Level (live only on
// Custom), then v1's crossfeed compensation (store/faceplate/drawers/crossfeed/comp.js) with its tilt readout and
// scale; its manual copy; and the response plot under the lines, v1's compensation traces: the center as crossfeed
// leaves it, the center as the compensation corrects it, the sides it leaves alone.

import { html } from "../../../../lib/dom.js";
import { minus } from "../../../../model/shell/format.js";
import { bauerPlot } from "../../../../model/gauges/crossfeed.js";
import { centerMagDb, compProcess, fitComp, sideMagDb } from "../../../../vendor/eqlab/core/xfeed.js";
import { parseProcess } from "../../../../vendor/eqlab/core/matrixspec.js";
import { chainResponse } from "../../../../vendor/eqlab/core/dsp/chain.js";
import { schema as catalog } from "../../../../store/schema.js";
import { describe } from "../../../../store/prose.js";
import { edit } from "../../../../store/actions.js";
import { rowOptions, rowValue } from "../../../../store/faceplate/drawer.js";
import { formBounds } from "../../../../store/faceplate/drawers/loudness.js";
import { commitComp, compView, dragComp } from "../../../../store/faceplate/drawers/crossfeed/comp.js";
import { ManPara, NumBox, Seg } from "../loudness/parts.js";
import { RespPlot } from "../loudness/RespPlot.js";
import { Slider } from "./Slider.js";
import { COMP_MAN, COMP_SCALE, LABEL, NAME, TRACE, compTilt } from "./copy.js";

/** @typedef {import("../../../../store/faceplate/drawers/crossfeed.js").CrossfeedLive} CrossfeedLive */

const FS = 48000;
const SCALE = { lo: -15, hi: 3, step: 3 };

/** @param {string} key */
const meta = (key) => {
  const entry = catalog[key];
  return entry ? { ...describe(entry, key), unit: entry.unit } : { label: key, tooltip: "", unit: undefined };
};

/**
 * Frequency or Level: a labelled number box, staged on change.
 *
 * @param {{ k: string, disabled: boolean }} props
 */
function Custom({ k, disabled }) {
  const m = meta(k);
  return html`
    <label class="ci">
      <span class="cl">${catalog[k]?.label ?? k}</span>
      <${NumBox}
        k=${k}
        aria=${m.label}
        value=${rowValue(k)}
        unit=${m.unit}
        ...${formBounds(k)}
        disabled=${disabled}
        onSet=${(/** @type {number} */ v) => edit(k, v)}
      />
    </label>
  `;
}

/** The Bauer line's controls. @param {{ live: CrossfeedLive }} props */
export function BauerControls({ live }) {
  const c = compView();
  return html`
    <div class=${live.linesGrayed ? "xctl grayed" : "xctl"}>
      <div class="ci">
        <span class="cl">${catalog.crossfeed_preset.label}</span>
        <${Seg}
          aria=${meta("crossfeed_preset").label}
          options=${rowOptions("crossfeed_preset")}
          value=${rowValue("crossfeed_preset")}
          disabled=${!live.controls}
          onPick=${(/** @type {string} */ v) => edit("crossfeed_preset", v)}
        />
      </div>
      <div class=${live.customGrayed ? "cgrp grayed" : "cgrp"}>
        <${Custom} k="crossfeed_frequency" disabled=${!live.custom} />
        <${Custom} k="crossfeed_level" disabled=${!live.custom} />
      </div>
      <div class="ci">
        <${Slider}
          label=${LABEL.comp}
          min=${0}
          max=${150}
          step=${1}
          unit="%"
          dp=${0}
          value=${c.pct}
          disabled=${!live.controls || !c.ready}
          onDrag=${dragComp}
          onCommit=${commitComp}
        />
        <span class="cap">${compTilt(minus(c.tilt, 1))}</span>
        <span class="cap">${COMP_SCALE}</span>
      </div>
    </div>
  `;
}

/** The Bauer line's manual copy: the switch's paragraph, then each control's. */
export function BauerCopy() {
  const keys = ["crossfeed_preset", "crossfeed_frequency", "crossfeed_level"];
  return html`
    <div class="man">
      <${ManPara} text=${meta("crossfeed_enabled").tooltip} />
      ${keys.map((k) => html`<${ManPara} label=${catalog[k]?.label} text=${meta(k).tooltip} />`)}
      <${ManPara} label=${LABEL.comp} text=${COMP_MAN} />
    </div>
  `;
}

/** The Bauer response plot. @param {{ grayed: boolean }} props */
export function BauerPlot({ grayed }) {
  const c = compView();
  const { k, ghost, pct } = bauerPlot({ preset: "custom", freq: c.fc, level: c.feed, comp: c.pct }, {});
  const comp = parseProcess(compProcess(fitComp(c.fc, c.feed), k));
  const mid = (/** @type {number} */ f) => centerMagDb(c.fc, c.feed, f);
  const corrected = (/** @type {number} */ f) => mid(f) + chainResponse(comp, f, FS).db;
  const traces = [
    ...(ghost ? [{ cls: "ghost", label: TRACE.uncorrected, fn: mid }] : []),
    { label: ghost ? TRACE.corrected(pct) : TRACE.uncorrected, fn: ghost ? corrected : mid },
    { cls: "side", label: TRACE.sides, fn: (/** @type {number} */ f) => sideMagDb(c.fc, c.feed, f) },
  ];
  return html`<${RespPlot} cls=${grayed ? "eq xfplot grayed" : "eq xfplot"} aria=${NAME.plot} scale=${SCALE} traces=${traces} />`;
}
