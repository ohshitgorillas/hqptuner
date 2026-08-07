// Crossfeed compensation (M/S) — crossfeed-comp spec steps 3+4. The control
// strip lives in the Crossfeed card's Bauer view, the badge sits on the
// Pipelines card, and the lens toggle this file's `lensOn` drives sits on the
// RESPONSE card, where the traces it gates are drawn. The
// compensated stereo pair is LITERAL wire rows (spec fork decision): 8 badged
// pipelines the user can inspect and hand-edit — an edit that breaks the
// structural pattern simply drops the badge/slider, never blocks or rewrites.
//
// Recognizing the block and taking it back out is STATE, not rendering, and
// lives in store/xfeedblock.js — see the note there.
import { signal } from "@preact/signals";
import { html } from "../lib/dom.js";
import { effectivePipelines } from "../store/resolve.js";
import { stagePipelines, edit } from "../store/actions.js";
import { notesVisible } from "../store/prefs.js";
import { bauerSettings, xfeedBlock, removeBlock } from "../store/xfeedblock.js";
import { parseProcess } from "../lib/matrixspec.js";
import { chainResponse } from "../lib/dsp/chain.js";
import { bandFreqs } from "../lib/dsp/curves.js";
import { PlotFrame } from "./plots.js";
import { SliderNumber } from "./controls/index.js";
import { centerMagDb, sideMagDb, centerTiltDb, fitComp, compProcess, msCompile } from "../lib/xfeed.js";
import { db, hz } from "../lib/units.js";

/**
 * @typedef {import("../lib/matrixspec.js").PipelineRow} PipelineRow
 * @typedef {import("../lib/xfeed.js").MsRecognition} MsRecognition
 * @typedef {import("../store/xfeedblock.js").BauerSettings} BauerSettings
 * @typedef {{ issue?: string, eq?: string, gain?: number }} PairInfo
 *   Rows 1+2 read as a symmetric stereo EQ pair — either the reason they are
 *   not one, or the chain and preamp a block can be built from.
 * @typedef {{ min: number, max: number }} Bounds
 *   The plot's running dB extent, widened in place by the traces drawn into it.
 */

const FS = 48000;

// A symmetric stereo EQ pair at rows 0+1 (how AutoEq imports land) — the only
// shape v1 compiles from. Row order is the daemon's business, not a contract
// (live configs arrive with In 2 first), so the pair is accepted either way;
// the compiled block always emits canonical In 1-first order. Returns
// {eq, gain} when eligible, else {issue}.
const straightThrough = (/** @type {PipelineRow} */ x, /** @type {string} */ ch) => x.source === ch && x.mixdown === ch;

// In 1→Out 1 / In 2→Out 2, in either row order.
/**
 * @param {PipelineRow} a
 * @param {PipelineRow} b
 * @returns {boolean}
 */
function straightPair(a, b) {
  const fwd = straightThrough(a, "0") && straightThrough(b, "1");
  return fwd || (straightThrough(a, "1") && straightThrough(b, "0"));
}

/**
 * @param {PipelineRow[]} rows
 * @returns {PairInfo}
 */
function pairInfo(rows) {
  const [a, b] = rows;
  if (!a || !b) return { issue: "needs pipelines 1+2" };
  if (!straightPair(a, b)) return { issue: "pipelines 1+2 must route In 1→Out 1 / In 2→Out 2" };
  if (a.gainunit !== "dB" || b.gainunit !== "dB") return { issue: "pipeline 1+2 gains must be in dB" };
  if (a.process !== b.process || a.gain !== b.gain) return { issue: "pipelines 1+2 are not a symmetric stereo pair" };
  return { eq: a.process, gain: Number(a.gain) };
}

const sliderDrag = signal(null); // % while the slider is being dragged
const pendingPct = signal(null); // % chosen before any block exists — what Turn on uses
// The "what you hear" lens: off until the user asks for it. Public because the
// button that writes it lives on the RESPONSE card (MatrixPlot) while the traces
// it gates are built here and in StructuralXfeed — one toggle over both, so the
// control covers whichever crossfeed is on screen.
//
// Off by default rather than following crossfeed-enabled: the lens answers a
// question about the crossfeed, and the response plot's job is the EQ the user
// is editing. Drawing three extra curves over it unasked buried that.
export const lensOn = signal(false);
export function lensShown() {
  return lensOn.value;
}

/**
 * @param {MsRecognition | null} rec
 * @returns {number}
 */
function currentPct(rec) {
  const drag = sliderDrag.value;
  if (drag !== null) return drag;
  if (rec) return Math.round(rec.sFraction * 100);
  return pendingPct.value ?? 100;
}

/**
 * @param {PipelineRow[]} rows
 * @param {{ eq: string, preampDb: number }} from the EQ chain and preamp to compile the block from
 * @param {number} pct
 * @param {number} restFrom index the rows AFTER the block resume at
 * @returns {void}
 */
function stageBlock(rows, { eq, preampDb }, pct, restFrom) {
  const { fc, feed } = bauerSettings();
  const next = [
    ...msCompile(eq, preampDb, { fit: fitComp(fc, feed), s: pct / 100 }, { a: 0, b: 1 }),
    ...rows.slice(restFrom),
  ];
  stagePipelines(next);
  edit("pipelines", String(next.length));
}

// Lens traces for the RESPONSE plot (spec step 4): what the listener's ear
// receives through the crossfeed — center (with comp at the slider position),
// the uncompensated center as a ghost, and the side path (deliberately
// untouched). Magnitude only.
/**
 * @param {PipelineRow[]} rows
 * @param {Bounds} bounds
 * @returns {PlotTrace[]}
 */
export function xfeedLensTraces(rows, bounds) {
  if (!lensShown()) return [];
  const { bs, rec } = xfeedBlock(rows);
  if (!bs.enabled) return [];
  const pair = rec ? null : pairInfo(rows);
  const eqProcess = rec ? rec.eqProcess : pair && !pair.issue ? pair.eq : null;
  if (eqProcess === null) return [];
  const pct = currentPct(rec);
  const eq = parseProcess(eqProcess);
  const comp = parseProcess(compProcess(fitComp(bs.fc, bs.feed), pct / 100));
  const freqs = bandFreqs(160);
  const mk = (/** @type {(f: number) => number} */ fn) => {
    const pts = freqs.map((f) => {
      const level = fn(f);
      bounds.min = Math.min(bounds.min, level);
      bounds.max = Math.max(bounds.max, level);
      return /** @type {[number, number]} */ ([f, level]);
    });
    return pts;
  };
  const eqDb = (/** @type {number} */ f) => chainResponse(eq, f, FS).db;
  return [
    {
      points: mk((/** @type {number} */ f) => eqDb(f) + centerMagDb(bs.fc, bs.feed, f)),
      kind: "ghost",
      label: "center, uncorrected",
    },
    {
      points: mk((/** @type {number} */ f) => eqDb(f) + chainResponse(comp, f, FS).db + centerMagDb(bs.fc, bs.feed, f)),
      kind: "xfm",
      label: `center, corrected ${pct}%`,
    },
    {
      points: mk((/** @type {number} */ f) => eqDb(f) + sideMagDb(bs.fc, bs.feed, f)),
      kind: "xfs",
      label: "stereo sides",
    },
  ];
}

// Whether the Bauer lens has anything to draw: crossfeed running, over rows this
// file can read an EQ out of. The RESPONSE card asks before offering the toggle,
// so the button appears only where pressing it would change the plot.
/**
 * @param {PipelineRow[]} rows
 * @returns {boolean}
 */
export function xfeedLensAvailable(rows) {
  const { bs, rec } = xfeedBlock(rows);
  if (!bs.enabled) return false;
  return rec ? true : !pairInfo(rows).issue;
}

// Badge on the Pipelines card when rows 0..7 are a recognized block.
export function XfeedBadge() {
  const rows = effectivePipelines.value;
  const { bs, rec } = xfeedBlock(rows);
  if (!rec) return null;
  return html`
    <div class="xfc-badge ${rec.stale ? "stale" : ""}">
      ⇄ These 8 pipelines are the crossfeed tone correction (mid/side), at ${Math.round(rec.sFraction * 100)}%
      ${
        rec.stale
          ? html` ·
              <span class="xfc-stale"
                >out of date — the crossfeed settings changed; press Rebuild on the Response card</span
              >`
          : ` · built for Bauer ${hz(bs.fc, 0)} / ${db(bs.feed, 1)}`
      }
    </div>
  `;
}

// The strip's primary action. An installed block offers Turn off (plus Rebuild
// once the crossfeed settings have moved out from under it); an uninstalled one
// offers Turn on, grayed with the reason when the stereo pair is not eligible.
/**
 * @param {PipelineRow[]} rows
 * @param {MsRecognition | null} rec
 * @param {PairInfo | null} pair
 * @param {{ pct: number, issue: string }} state
 */
function xfcActions(rows, rec, pair, { pct, issue }) {
  if (!rec) {
    return html`<button
      type="button"
      class="mtx-tool mtx-primary"
      disabled=${!!issue}
      title=${issue || "Build the correction from pipelines 1+2 (they become 8 mid/side pipelines — see the Pipelines card)"}
      onClick=${() => stageBlock(rows, { eq: pair.eq, preampDb: pair.gain }, pct, 2)}
    >
      Turn on
    </button>`;
  }
  return html`
    ${
      rec.stale
        ? html`<button
            type="button"
            class="mtx-tool mtx-primary"
            title="The crossfeed settings changed after this correction was built — rebuild it to match them"
            onClick=${() => stageBlock(rows, { eq: rec.eqProcess, preampDb: rec.preampDb }, pct, 8)}
          >
            Rebuild
          </button>`
        : null
    }
    <button
      type="button"
      class="mtx-tool mtx-remove"
      title="Undo the correction — back to the plain stereo EQ pair"
      onClick=${() => removeBlock(rows, rec)}
    >
      Turn off
    </button>
  `;
}

/**
 * @param {BauerSettings} bs
 * @param {number} tilt
 */
function xfcNote(bs, tilt) {
  if (!notesVisible.value) return null;
  return html`<div class="field-note xfc-note">
    Bauer crossfeed blends the channels below ~${hz(bs.fc, 0)}. Centered sound — vocals, bass, most of the mix — comes
    out about ${db(tilt, 1)} duller in the treble than the sides, close to what a real pair of speakers at ±30° does
    to a centered image. Turning this on rebuilds pipelines 1+2 into eight mid/side pipelines that bring the centered
    part back to neutral; the crossfeed's stereo width effect is left untouched. 100% restores a neutral center exactly,
    lower keeps some of the speaker-like warmth, higher overshoots brighter.
  </div>`;
}

// Control strip on the RESPONSE card.
export function XfeedStrip() {
  const rows = effectivePipelines.value;
  const { bs, rec } = xfeedBlock(rows);
  const pair = rec ? null : pairInfo(rows);
  const issue = rec ? "" : pair.issue || "";
  const pct = currentPct(rec);
  const tilt = centerTiltDb(bs.fc, bs.feed);
  if (!bs.enabled && !rec) {
    return html`
      <div class="xfc-strip off">
        <span class="field-gray-reason"
          >Crossfeed is off, so there is nothing to correct. Enable it on the Crossfeed card above.</span
        >
      </div>
    `;
  }
  const commit = (/** @type {number} */ v) => {
    sliderDrag.value = null;
    const clamped = Math.max(0, Math.min(150, Math.round(v)));
    if (rec) stageBlock(rows, { eq: rec.eqProcess, preampDb: rec.preampDb }, clamped, 8);
    else pendingPct.value = clamped;
  };
  // nothing to aim at until there is a block or an eligible pair to build one from
  const locked = !rec && !!issue;
  return html`
    <div class="xfc-strip">
      <${SliderNumber}
        anchor="min"
        min="0"
        max="150"
        step="1"
        value=${pct}
        unit="%"
        disabled=${locked}
        onDrag=${(/** @type {string | number} */ v) => (sliderDrag.value = Number(v))}
        onCommit=${(/** @type {string | number} */ v) => commit(Number(v))}
      />
      <span
        class="xfc-tilt"
        title="Bauer ${hz(bs.fc, 0)} / ${db(bs.feed, 1)} dulls centered sound by ${db(tilt, 2)} toward the treble (bs2b model). Speakers at ±30° do much the same."
      >
        crossfeed dulls the center by ${db(tilt, 1)}
      </span>
      ${xfcActions(rows, rec, pair, { pct, issue })}
      <span class="xfc-scale">0% off · 100% neutral · above 100% brighter than neutral</span>
      <span class="xfc-scale"
        >Guide: mixes that live in the center — vocals, pop, mono-ish recordings — take 100% or a touch more. Wide or
        hard-panned material (early stereo, live and orchestral recordings) starts slightly thin under crossfeed, so it
        sits better around 50–75%.</span
      >
      ${xfcNote(bs, tilt)}
    </div>
  `;
}

// Mini correction plot — the card's own graphic, isolated from the Response
// card's full-EQ picture: what crossfeed does to the center (dip), the
// correction at the current slider (mirror boost), and their net result (flat
// at 100%, visible residual elsewhere). Small ±3 dB scale so a ~2 dB story
// reads large.
export function CompMiniPlot() {
  const rows = effectivePipelines.value;
  const { bs, rec } = xfeedBlock(rows);
  if (!bs.enabled && !rec) return null;
  const pct = currentPct(rec);
  const comp = parseProcess(compProcess(fitComp(bs.fc, bs.feed), pct / 100));
  const freqs = bandFreqs(120);
  const trace = (/** @type {(f: number) => number} */ fn) => freqs.map((f) => [f, fn(f)]);
  const xf = (/** @type {number} */ f) => centerMagDb(bs.fc, bs.feed, f);
  const corr = (/** @type {number} */ f) => chainResponse(comp, f, FS).db;
  return html`
    <div class="xfc-mini">
      <${PlotFrame}
        traces=${[
          { points: trace(xf), kind: "ghost", label: "crossfeed", dy: 3 },
          { points: trace(corr), kind: "xfm", label: "correction", dy: -3 },
          { points: trace((/** @type {number} */ f) => xf(f) + corr(f)), kind: "applied", label: "result" },
        ]}
        yMin=${-3}
        yMax=${3}
        dbStep=${1}
        height=${190}
        handles=${[]}
      />
    </div>
  `;
}

// Compensation renders inside the Crossfeed card's Bauer mode from `XfeedStrip`
// + `CompMiniPlot` directly — no card wrapper in this file to keep in step.
