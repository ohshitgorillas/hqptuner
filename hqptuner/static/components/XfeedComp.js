// Crossfeed compensation (M/S) — crossfeed-comp spec steps 3+4. The control
// strip lives on the RESPONSE card; the badge sits on the Pipelines card. The
// compensated stereo pair is LITERAL wire rows (spec fork decision): 8 badged
// pipelines the user can inspect and hand-edit — an edit that breaks the
// structural pattern simply drops the badge/slider, never blocks or rewrites.
// Bauer preset internals are not surfaced by the daemon (probe finding), so
// preset → (fc, feed) comes from the vendored bs2b constants in lib/xfeed.js.
import { signal } from "@preact/signals";
import { html, wheelGuard } from "../lib/dom.js";
import { effective, effectivePipelines, stagePipelines, edit } from "../store/state.js";
import { notesVisible } from "../store/prefs.js";
import { parseProcess } from "../lib/matrixspec.js";
import { chainResponse, logFreqs } from "../lib/dsp.js";
import { PlotFrame } from "./plots.js";
import {
  BAUER_PRESETS,
  centerMagDb,
  sideMagDb,
  centerTiltDb,
  fitComp,
  compProcess,
  msCompile,
  msRecognize,
} from "../lib/xfeed.js";

const FS = 48000;
const truthy = (v) => v === true || v === "1" || v === 1;

function bauerSettings() {
  const preset = String(effective("crossfeed_preset") ?? "default");
  const p = BAUER_PRESETS[preset];
  return {
    enabled: truthy(effective("crossfeed_enabled")),
    fc: p ? p.fc : Number(effective("crossfeed_frequency")) || 700,
    feed: p ? p.feed : Number(effective("crossfeed_level")) || 4.5,
  };
}

// The recognized block at rows 0..7 for the CURRENT bauer settings, or null.
export function xfeedBlock(rows) {
  const bs = bauerSettings();
  return { bs, rec: rows.length >= 8 ? msRecognize(rows, 0, bs.fc, bs.feed) : null };
}

// A symmetric stereo EQ pair at rows 0+1 (how AutoEq imports land) — the only
// shape v1 compiles from. Row order is the daemon's business, not a contract
// (live configs arrive with In 2 first), so the pair is accepted either way;
// the compiled block always emits canonical In 1-first order. Returns
// {eq, gain} when eligible, else {issue}.
const straightThrough = (x, ch) => x.source === ch && x.mixdown === ch;

// In 1→Out 1 / In 2→Out 2, in either row order.
function straightPair(a, b) {
  const fwd = straightThrough(a, "0") && straightThrough(b, "1");
  return fwd || (straightThrough(a, "1") && straightThrough(b, "0"));
}

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
// null = follow crossfeed-enabled (lens shows by default while crossfeed is on,
// hidden when off); true/false = an explicit user toggle that overrides that.
const lensOn = signal(null);
function lensShown() {
  return lensOn.value === null ? bauerSettings().enabled : lensOn.value;
}

function currentPct(rec) {
  const drag = sliderDrag.value;
  if (drag !== null) return drag;
  if (rec) return Math.round(rec.sFraction * 100);
  return pendingPct.value ?? 100;
}

function stageBlock(rows, eq, preampDb, pct, restFrom) {
  const { fc, feed } = bauerSettings();
  const next = [...msCompile(eq, preampDb, fitComp(fc, feed), pct / 100, 0, 1), ...rows.slice(restFrom)];
  stagePipelines(next);
  edit("pipelines", String(next.length));
}

// Public because leaving Bauer takes its rows with it, not just its enable flag:
// the mode segment (lib/xfmode.js) and the DSP tab's Speakers switch both call
// this, and a correction left behind would run against a crossfeed that is off.
export function removeBlock(rows, rec) {
  const g = String(Math.round(rec.preampDb * 100) / 100);
  const pair = [
    { gain: g, gainunit: "dB", mixdown: "0", process: rec.eqProcess, source: "0" },
    { gain: g, gainunit: "dB", mixdown: "1", process: rec.eqProcess, source: "1" },
  ];
  const next = [...pair, ...rows.slice(8)];
  stagePipelines(next);
  edit("pipelines", String(Math.max(2, next.length)));
}

// Lens traces for the RESPONSE plot (spec step 4): what the listener's ear
// receives through the crossfeed — center (with comp at the slider position),
// the uncompensated center as a ghost, and the side path (deliberately
// untouched). Magnitude only.
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
  const freqs = logFreqs(20, 20000, 160);
  const mk = (fn) => {
    const pts = freqs.map((f) => {
      const db = fn(f);
      bounds.min = Math.min(bounds.min, db);
      bounds.max = Math.max(bounds.max, db);
      return [f, db];
    });
    return pts;
  };
  const eqDb = (f) => chainResponse(eq, f, FS).db;
  return [
    {
      points: mk((f) => eqDb(f) + centerMagDb(bs.fc, bs.feed, f)),
      kind: "ghost",
      label: "center, uncorrected",
    },
    {
      points: mk((f) => eqDb(f) + chainResponse(comp, f, FS).db + centerMagDb(bs.fc, bs.feed, f)),
      kind: "xfm",
      label: `center, corrected ${pct}%`,
    },
    {
      points: mk((f) => eqDb(f) + sideMagDb(bs.fc, bs.feed, f)),
      kind: "xfs",
      label: "stereo sides",
    },
  ];
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
          : ` · built for Bauer ${bs.fc} Hz / ${bs.feed} dB`
      }
    </div>
  `;
}

// The strip's primary action. An installed block offers Turn off (plus Rebuild
// once the crossfeed settings have moved out from under it); an uninstalled one
// offers Turn on, grayed with the reason when the stereo pair is not eligible.
function xfcActions(rows, rec, pair, pct, issue) {
  if (!rec) {
    return html`<button
      type="button"
      class="mtx-tool mtx-primary"
      disabled=${!!issue}
      title=${issue || "Build the correction from pipelines 1+2 (they become 8 mid/side pipelines — see the Pipelines card)"}
      onClick=${() => stageBlock(rows, pair.eq, pair.gain, pct, 2)}
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
            onClick=${() => stageBlock(rows, rec.eqProcess, rec.preampDb, pct, 8)}
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

function xfcNote(bs, tilt) {
  if (!notesVisible.value) return null;
  return html`<div class="field-note xfc-note">
    Bauer crossfeed blends the channels below ~${bs.fc} Hz. Centered sound — vocals, bass, most of the mix — comes out
    about ${tilt.toFixed(1)} dB duller in the treble than the sides, close to what a real pair of speakers at ±30° does
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
  const commit = (v) => {
    sliderDrag.value = null;
    const clamped = Math.max(0, Math.min(150, Math.round(v)));
    if (rec) stageBlock(rows, rec.eqProcess, rec.preampDb, clamped, 8);
    else pendingPct.value = clamped;
  };
  // nothing to aim at until there is a block or an eligible pair to build one from
  const locked = !rec && !!issue;
  return html`
    <div class="xfc-strip">
      <input
        class="xfc-slider"
        type="range"
        min="0"
        max="150"
        step="1"
        value=${pct}
        disabled=${locked}
        onWheel=${wheelGuard}
        onInput=${(e) => (sliderDrag.value = Number(e.target.value))}
        onChange=${(e) => commit(Number(e.target.value))}
      />
      <label class="xfc-pct">
        <input
          type="number"
          min="0"
          max="150"
          step="1"
          value=${pct}
          disabled=${locked}
          onWheel=${wheelGuard}
          onChange=${(e) => commit(Number(e.target.value))}
        />
        <span>%</span>
      </label>
      <span
        class="xfc-tilt"
        title="Bauer ${bs.fc} Hz / ${bs.feed} dB dulls centered sound by ${tilt.toFixed(2)} dB toward the treble (bs2b model). Speakers at ±30° do much the same."
      >
        crossfeed dulls the center by ${tilt.toFixed(1)} dB
      </span>
      ${xfcActions(rows, rec, pair, pct, issue)}
      <button
        type="button"
        class="mtx-tool ${lensShown() ? "active" : ""}"
        title="Plot what actually reaches your ears through the crossfeed: corrected center, uncorrected center, and the stereo sides"
        onClick=${() => (lensOn.value = !lensShown())}
      >
        ∿ what you hear
      </button>
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
  const freqs = logFreqs(20, 20000, 120);
  const trace = (fn) => freqs.map((f) => [f, fn(f)]);
  const xf = (f) => centerMagDb(bs.fc, bs.feed, f);
  const corr = (f) => chainResponse(comp, f, FS).db;
  return html`
    <div class="xfc-mini">
      <${PlotFrame}
        traces=${[
          { points: trace(xf), kind: "ghost", label: "crossfeed", dy: 3 },
          { points: trace(corr), kind: "xfm", label: "correction", dy: -3 },
          { points: trace((f) => xf(f) + corr(f)), kind: "applied", label: "result" },
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

// Compensation used to be its own card here (2026-07-21 reorg). It now renders
// inside the Crossfeed card's Bauer mode from `XfeedStrip` + `CompMiniPlot`
// directly, so there is no card wrapper in this file to keep in step with it.
