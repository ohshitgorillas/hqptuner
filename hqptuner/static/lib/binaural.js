// Structural crossfeed compiler (docs/crossfeed-math.md). Turns three physical
// controls — speaker angle, head radius, and the center-character blend λ — into
// matrix pipeline rows.
//
// The model is Brown & Duda's structural HRTF (IEEE TSAP 6(5), 1998), whose
// head-shadow filter is a single-pole/single-zero that factors EXACTLY into a
// constant plus a scaled first-order lowpass:
//
//   H_HS = (1 + jαx)/(1 + jx) = α + (1−α)/(1 + jx),   x = ω/(2ω₀),  ω₀ = c/a
//
// Matrix rows sum into a shared mixdown and Lin gain may be negative, so that
// parallel form is directly expressible as two rows — a flat one at gain α and
// an lp1 one at gain (1−α). No fit, no rate-bound raw biquads.
//
// The center is on a continuous control while the side path stays physical:
//
//   G_S    = (H_n − H_f)/2                 side — never moves
//   G_M(λ) = λ·(H_n + H_f)/2 + (1 − λ)     center — λ=1 literal, λ=0 flat
//
// Per-source coefficients follow, and expanding H_n and H_f over {flat, lp1} ×
// {dry, delayed} gives four row types per source, eight per output ear:
//
//   A = (G_M + G_S)/2 = [(λ+1)·H_n + (λ−1)·H_f]/4 + (1−λ)/2    same-side
//   B = (G_M − G_S)/2 = [(λ−1)·H_n + (λ+1)·H_f]/4 + (1−λ)/2    opposite

// c is the paper's value, NOT HQPlayer's 343.956. That default belongs to the
// delay plugin's `v` argument, which converts `d=<metres>` into a delay — we emit
// `t=<seconds>`, so `v` is never consulted and there is nothing to match. The
// paper's 343 is the constant a, alpha_min and theta_min were fitted against on
// KEMAR data, and those travel together. The difference is 0.7 us of ITD, under
// the 22.7 us sample floor at 44.1 kHz and dominated ~37x by head-radius spread
// across adults (+/-26 us) — which is why `a` is a control and c is not.
// m/s — Brown & Duda §II.A, per the note above. Not a parameter anywhere downstream: compileRows and recognizeRows both used to take a speedOfSound argument, nothing ever passed one, and a mismatch between the two recovered a silently wrong head radius (0.08673 m for a compiled 0.0875 m) rather than declining the block.
const SPEED_OF_SOUND = 343;
export const HEAD_RADIUS = 0.0875; // m — Brown & Duda's stated average adult
export const SPEAKER_ANGLE = 30; // degrees off center — the stereo standard

const ALPHA_MIN = 0.1;
const THETA_MIN = 150;

// Eq. (5). `theta` is interaural-polar: measured from the interaural axis, so a
// source at `angle` degrees off center sits at 90−angle for the near ear and
// 90+angle for the far one.
function alphaOf(theta) {
  return 1 + ALPHA_MIN / 2 + (1 - ALPHA_MIN / 2) * Math.cos((theta / THETA_MIN) * Math.PI);
}

// Eq. (2), Woodworth & Schlosberg: arrival time relative to the head center,
// in seconds. Negative = early (source on this side).
function rayDelay(theta, a = HEAD_RADIUS, c = SPEED_OF_SOUND) {
  const rad = (Math.abs(theta) * Math.PI) / 180;
  const scale = a / c;
  return rad < Math.PI / 2 ? -scale * Math.cos(rad) : scale * (rad - Math.PI / 2);
}

// The lp1 corner: the pole sits at 2ω₀, so f = ω₀/π = c/(aπ).
function shadowCornerHz(a = HEAD_RADIUS, c = SPEED_OF_SOUND) {
  return c / (a * Math.PI);
}

// Everything the row compiler needs, derived from the two physical controls.
// `itd` is the far ear's ray delay relative to the near ear's, so the near path
// carries no delay stage and the far path carries all of it.
export function pathParams(angle = SPEAKER_ANGLE, a = HEAD_RADIUS, c = SPEED_OF_SOUND) {
  const near = 90 - angle;
  const far = 90 + angle;
  return {
    alphaNear: alphaOf(near),
    alphaFar: alphaOf(far),
    itd: rayDelay(far, a, c) - rayDelay(near, a, c),
    cornerHz: shadowCornerHz(a, c),
    // group delay each shadow filter contributes, ½(a/c)(1−α); reported for the
    // UI rather than used here — it is inherent to the lp1, not a stage
    groupDelayNear: 0.5 * (a / c) * (1 - alphaOf(near)),
    groupDelayFar: 0.5 * (a / c) * (1 - alphaOf(far)),
  };
}

// --- row synthesis -----------------------------------------------------------

const fmt = (x, dp) => String(Math.round(x * 10 ** dp) / 10 ** dp);

// A process chain in matrixspec's arg order, so it round-trips byte-identically.
function chain(lowpass, delaySec, cornerHz, eqProcess) {
  const stages = [];
  if (lowpass) stages.push(`iir:type=lp1;f=${fmt(cornerHz, 1)}`);
  if (delaySec) stages.push(`delay:t=${delaySec.toFixed(9)}`);
  if (eqProcess) stages.push(eqProcess);
  return stages.join(",");
}

// The eight coefficients feeding one output ear, in row order: for each source
// (same-side then opposite), the four {flat, lp1} × {dry, delayed} terms.
function earCoefficients(lambda, alphaNear, alphaFar) {
  const same = (lambda + 1) / 4;
  const cross = (lambda - 1) / 4;
  const dc = (1 - lambda) / 2;
  return [
    { lowpass: false, delayed: false, gain: same * alphaNear + dc },
    { lowpass: true, delayed: false, gain: same * (1 - alphaNear) },
    { lowpass: false, delayed: true, gain: cross * alphaFar },
    { lowpass: true, delayed: true, gain: cross * (1 - alphaFar) },
    { lowpass: false, delayed: false, gain: cross * alphaNear + dc, opposite: true },
    { lowpass: true, delayed: false, gain: cross * (1 - alphaNear), opposite: true },
    { lowpass: false, delayed: true, gain: same * alphaFar, opposite: true },
    { lowpass: true, delayed: true, gain: same * (1 - alphaFar), opposite: true },
  ];
}

// Compile the block for a stereo pair. `srcA`/`srcB` are wire channel indexes.
// Always emits 16 rows — four fall to zero at λ=1, and a fixed count keeps
// structural recognition simple.
//
// eqProcess and preampDb are PER EAR. A measured headphone correction is often
// asymmetric — the two drivers are not identical and the two ears are not either
// — and refusing those profiles would exclude exactly the listeners most likely
// to want an accurate crossfeed. Pass a string/number for both ears, or
// {left, right} to differ. EQ distributes over each output ear independently, so
// this costs nothing structurally: the rows feeding an ear all carry that ear's
// chain, and its preamp folds into that ear's gains.
const perEar = (v, dflt) => {
  if (v === undefined || v === null) return [dflt, dflt];
  if (typeof v === "object") return [v.left ?? dflt, v.right ?? dflt];
  return [v, v];
};

export function compileRows({
  lambda = 1,
  angle = SPEAKER_ANGLE,
  headRadius = HEAD_RADIUS,
  srcA = 0,
  srcB = 1,
  preampDb = 0,
  eqProcess = "",
} = {}) {
  const p = pathParams(angle, headRadius);
  const eqs = perEar(eqProcess, "");
  const preamps = perEar(preampDb, 0);
  const rows = [];
  const ears = [
    [srcA, srcA, srcB],
    [srcB, srcB, srcA],
  ];
  ears.forEach(([out, near, far], e) => {
    const k = 10 ** (preamps[e] / 20);
    for (const c of earCoefficients(lambda, p.alphaNear, p.alphaFar)) {
      rows.push({
        gain: (c.gain * k).toFixed(9),
        gainunit: "Lin",
        mixdown: String(out),
        process: chain(c.lowpass, c.delayed ? p.itd : 0, p.cornerHz, eqs[e]),
        source: String(c.opposite ? far : near),
      });
    }
  });
  return rows;
}

// --- analysis ----------------------------------------------------------------
// Complex response of the compiled block, for plots and for verifying that the
// rows really do realize G_M and G_S. Evaluated on the analog prototype, which
// is what the daemon's rate-independent parametrics implement.

/** @returns {[number, number]} */
function lp1Response(f, cornerHz) {
  const x = f / cornerHz;
  const d = 1 + x * x;
  return [1 / d, -x / d];
}

/** @returns {[number, number]} */
function delayResponse(f, seconds) {
  const w = -2 * Math.PI * f * seconds;
  return [Math.cos(w), Math.sin(w)];
}

/** @type {(a: [number, number], b: [number, number]) => [number, number]} */
const mul = ([ar, ai], [br, bi]) => [ar * br - ai * bi, ar * bi + ai * br];

// Sum of one ear's eight rows at frequency f, as [re, im]. `sameSide` picks
// which source the signal arrived on: pass 1 for correlated (center) content in
// both sources, or use midSideResponse below.
/** @returns {[number, number]} */
function earResponse(f, coeffs, p, sourceGain) {
  let re = 0;
  let im = 0;
  for (const c of coeffs) {
    /** @type {[number, number]} */
    let term = [1, 0];
    if (c.lowpass) term = mul(term, lp1Response(f, p.cornerHz));
    if (c.delayed) term = mul(term, delayResponse(f, p.itd));
    const g = c.gain * sourceGain(c.opposite === true);
    re += g * term[0];
    im += g * term[1];
  }
  return [re, im];
}

// Center and side transfer functions of the compiled block at frequency f.
// Center drives both sources in phase; side drives them in antiphase.
export function midSideResponse(f, { lambda = 1, angle = SPEAKER_ANGLE, headRadius = HEAD_RADIUS } = {}) {
  const p = pathParams(angle, headRadius);
  const coeffs = earCoefficients(lambda, p.alphaNear, p.alphaFar);
  return {
    mid: earResponse(f, coeffs, p, () => 1),
    side: earResponse(f, coeffs, p, (opposite) => (opposite ? -1 : 1)),
  };
}

export const magDb = ([re, im]) => 10 * Math.log10(re * re + im * im);

// --- recognition -------------------------------------------------------------
// Structural, exactly like msRecognize: no tag, no metadata, no stored flag. The
// block is over-determined — alphaNear and alphaFar both derive from the speaker
// angle, and three of the eight gains per ear are redundant — so the redundancy
// IS the hand-edit detector. A block that fails any cross-check is not "broken",
// it is simply not ours: it stands as ordinary rows and the card steps back.

const ANGLE_TOLERANCE = 0.5; // degrees, between the two independent recoveries
const GAIN_TOLERANCE = 1e-6; // on redundant gains, well above 9-decimal wire rounding

// The (lowpass, delayed, opposite) signature each of an ear's eight rows carries,
// in the order compileRows emits them.
const EAR_PATTERN = [
  [false, false, false],
  [true, false, false],
  [false, true, false],
  [true, true, false],
  [false, false, true],
  [true, false, true],
  [false, true, true],
  [true, true, true],
];

// Split a row's chain into the block's own prefix stages and whatever EQ follows.
function splitChain(process) {
  const stages = process ? process.split(",") : [];
  let i = 0;
  let corner = null;
  let delaySec = null;
  const lp = /^iir:type=lp1;f=([\d.]+)$/.exec(stages[i] || "");
  if (lp) {
    corner = Number(lp[1]);
    i += 1;
  }
  const dl = /^delay:t=([\d.]+)$/.exec(stages[i] || "");
  if (dl) {
    delaySec = Number(dl[1]);
    i += 1;
  }
  return { corner, delaySec, eqProcess: stages.slice(i).join(",") };
}

// Invert eq. (5): the speaker angle that produces this alpha, or null if none does.
function angleFromAlpha(alpha, ear) {
  const arg = (alpha - (1 + ALPHA_MIN / 2)) / (1 - ALPHA_MIN / 2);
  if (!(arg >= -1 && arg <= 1)) return null;
  const theta = (THETA_MIN / Math.PI) * Math.acos(arg);
  return ear === "near" ? 90 - theta : theta - 90;
}

// Recognize a compiled block at rows[at..at+15]. Returns the controls that
// produced it — {lambda, angle, headRadius, preampDb, eqProcess} — or null.
// A row this recognizer can even look at. Rows reaching here are whatever the
// user last hand-edited, so a malformed one must DECLINE the block (dropping the
// badge, per the card's contract) rather than throw: recognition runs inside a
// render path, and a TypeError there takes the tab down instead of the badge.
// `process` absent is legal — a bare flat row carries no chain.
const usableRow = (r) => !!r && r.gainunit === "Lin" && (r.process == null || typeof r.process === "string");

// Recognition is a pipeline of independent checks, each of which either yields
// the next stage's input or refuses the block. The helpers below are private:
// the contract is recognizeRows' return value, and tests/js/binaural.test.js
// reaches every one of them through it.

const snap = (x, step) => Math.round(x / step) * step;

// The chain structure shared across the block: one EQ tail per ear, and exactly
// eight lowpass corners and eight delays, each set internally identical.
function chainParts(block) {
  const parts = block.map((r) => splitChain(r.process));
  // per ear, not globally — the two ears may carry different corrections
  const eqProcess = { left: parts[0].eqProcess, right: parts[8].eqProcess };
  if (parts.slice(0, 8).some((p) => p.eqProcess !== eqProcess.left)) return null;
  if (parts.slice(8).some((p) => p.eqProcess !== eqProcess.right)) return null;
  const corners = parts.filter((p) => p.corner !== null).map((p) => p.corner);
  const delays = parts.filter((p) => p.delaySec !== null).map((p) => p.delaySec);
  if (corners.length !== 8 || delays.length !== 8) return null;
  if (corners.some((c) => c !== corners[0]) || delays.some((d) => d !== delays[0])) return null;
  return { eqProcess, corner: corners[0], delay: delays[0] };
}

// One row against its position in the eight-row ear signature.
function rowMatchesPattern(row, i, e, outs, srcs) {
  const [lp, delayed, opposite] = EAR_PATTERN[i];
  const p = splitChain(row.process);
  if ((p.corner !== null) !== lp || (p.delaySec !== null) !== delayed) return false;
  return row.mixdown === outs[e] && row.source === srcs[opposite ? 1 - e : e];
}

// The two ears, once their routing is confirmed. Distinct mixdowns is what
// rejects a degenerate block feeding both ears from one source.
function earLayout(block) {
  const ears = [block.slice(0, 8), block.slice(8, 16)];
  const outs = [ears[0][0].mixdown, ears[1][0].mixdown];
  const srcs = [ears[0][0].source, ears[1][0].source];
  if (outs[0] === outs[1] || srcs[0] !== outs[0] || srcs[1] !== outs[1]) return null;
  const routed = ears.every((ear, e) => ear.every((row, i) => rowMatchesPattern(row, i, e, outs, srcs)));
  return routed ? ears : null;
}

// One ear's controls, from its own eight gains.
function recoverEar(ear) {
  const g = ear.map((r) => Number(r.gain));
  const same = g[6] + g[7]; // (lambda+1)/4 * k
  const cross = g[2] + g[3]; // (lambda-1)/4 * k
  const diff = same - cross; // k/2
  if (!(diff > 0)) return null;
  return {
    k: 2 * diff,
    lambda: (same + cross) / diff,
    alphaFar: g[6] / same,
    alphaNear: 1 - g[1] / same,
  };
}

// Per-ear preamps mean the two k values may legitimately differ, but lambda and
// the two alphas describe one crossfeed and must agree across ears — a
// disagreement is a hand-edit.
function recoverBoth(ears) {
  const [a, b] = ears.map(recoverEar);
  if (!a || !b) return null;
  if (Math.abs(a.lambda - b.lambda) > 1e-4) return null;
  if (Math.abs(a.alphaNear - b.alphaNear) > 1e-4) return null;
  if (Math.abs(a.alphaFar - b.alphaFar) > 1e-4) return null;
  return {
    lambda: (a.lambda + b.lambda) / 2,
    alphaNear: (a.alphaNear + b.alphaNear) / 2,
    alphaFar: (a.alphaFar + b.alphaFar) / 2,
    ks: [a.k, b.k],
  };
}

// Near and far ear are independent routes to the speaker angle; require both to
// be in the model's domain and to agree.
function angleFromAlphas(alphaNear, alphaFar) {
  const fromNear = angleFromAlpha(alphaNear, "near");
  const fromFar = angleFromAlpha(alphaFar, "far");
  if (fromNear === null || fromFar === null) return null;
  if (Math.abs(fromNear - fromFar) > ANGLE_TOLERANCE) return null;
  return (fromNear + fromFar) / 2;
}

// Every one of the sixteen gains must match what the recovered controls
// generate, each ear against its own preamp. This subsumes the redundancy
// within an ear and covers both — an edit to a second-ear row would otherwise
// pass unnoticed.
function gainsMatch(ears, lambda, p, preampDb) {
  const coeffs = earCoefficients(lambda, p.alphaNear, p.alphaFar);
  const ks = [10 ** (preampDb.left / 20), 10 ** (preampDb.right / 20)];
  return ears.every((ear, e) =>
    ear.every((row, i) => Math.abs(Number(row.gain) - coeffs[i].gain * ks[e]) <= GAIN_TOLERANCE),
  );
}

export function recognizeRows(rows, at = 0) {
  const block = rows.slice(at, at + 16);
  if (block.length < 16 || !block.every(usableRow)) return null;

  const chains = chainParts(block);
  if (!chains) return null;
  const ears = earLayout(block);
  if (!ears) return null;
  const raw = recoverBoth(ears);
  if (!raw) return null;
  const angle = angleFromAlphas(raw.alphaNear, raw.alphaFar);
  if (angle === null) return null;

  // Snap to the control grid before anything else. The gains arrive quantized to
  // the wire's 9 decimals, so raw recovery lands a few ulps off the values that
  // produced them; recompiling from those would differ in the last digit and the
  // block would read as edited on every render. Snapping is what makes
  // compile -> recognize -> compile byte-stable, the same reason msRecognize
  // snaps its slider fraction to a 1 % grid. It is also why an off-grid control
  // is REFUSED rather than rounded: the gain check below re-derives from the
  // snapped value at a tolerance far tighter than the snap step.
  const lambda = snap(raw.lambda, 1e-4);
  const headRadius = snap(SPEED_OF_SOUND / (Math.PI * chains.corner), 1e-5);
  const preampDb = {
    left: snap(20 * Math.log10(raw.ks[0]), 1e-3),
    right: snap(20 * Math.log10(raw.ks[1]), 1e-3),
  };

  const angleSnapped = snap(angle, 0.01);
  const p = pathParams(angleSnapped, headRadius);
  if (!gainsMatch(ears, lambda, p, preampDb)) return null;
  // corner and delay are independent routes to the head radius; require agreement
  if (Math.abs(p.itd - chains.delay) > 2e-6) return null;

  return { lambda, angle: angleSnapped, headRadius, preampDb, eqProcess: chains.eqProcess };
}

// --- invariants --------------------------------------------------------------
// Two settings elsewhere in the app are incompatible with this block, and both
// are reachable today by a user doing something otherwise reasonable. Neither is
// a matter of taste, so neither is left to the user to get right:
//
//   post_bauer_enabled — the matrix runs BEFORE post-process, so bauer on top of
//     this block is two crossfeeds in series.
//   matrix_iir2fir = 2 — converts the matrix's parametric stages to linear phase,
//     and linear phase means constant group delay, which deletes the low-frequency
//     ITD the head-shadow filter supplies (docs/crossfeed-math.md §3). The
//     magnitude response stays correct, so nothing on a plot would show it.
//
// iir2fir = 1 is ALLOWED. The manual calls it "direct conversion, retain
// minimum-phase", and minimum phase preserves group delay for a given magnitude —
// which is exactly why T_g falls out of eq. (3) rather than being added on top.
// The conversion applies to parametric EQs, so `delay` stages are untouched.
//
// This reports; it does not mutate. The caller stages the fixes so they appear in
// the pending bar like any other change — the app never silently rewrites config
// the user can see, and a conflict arriving via a preset load (whose snapshot
// carries post_bauer_enabled) has to be visible for the same reason.

const BLOCK_CONFLICTS = [
  {
    key: "crossfeed_enabled",
    required: "0",
    conflicts: (value) => value === "1" || value === true,
    reason: "HQPlayer's own crossfeed runs after the matrix, so both at once is two crossfeeds in series.",
  },
  {
    key: "matrix_iir2fir",
    required: "0",
    conflicts: (value) => String(value) === "2",
    reason: "Linear-phase conversion flattens the group delay, which is what carries the delay between your ears.",
  },
];

// Conflicts standing between the current config and this block, as
// [{ key, current, required, reason }]. Empty means the block is safe to install.
export function blockConflicts(effective) {
  return BLOCK_CONFLICTS.filter((c) => c.conflicts(effective(c.key))).map((c) => ({
    key: c.key,
    current: effective(c.key),
    required: c.required,
    reason: c.reason,
  }));
}

// --- what the block compiles from -------------------------------------------

// What the block should carry in from rows 0+1, and whether it could read them.
//
// This NEVER refuses. An earlier version returned an issue and blocked the mode
// switch, which was wrong twice: the guard was inherited from the compensation
// block, where it protected a round trip that here is guaranteed by stashing the
// original rows instead; and a control that silently declines to go where the
// user pointed it is worse than one that goes and explains.
//
// A straight-through dB pair hands its chains and gains to the block, per ear.
// Anything else is SET ASIDE — the block installs with no EQ of its own, the
// original rows are stashed verbatim, and Turn off puts them back untouched.
export function pairInfo(rows) {
  const [a, b] = rows;
  const aside = (why) => ({
    eq: { left: "", right: "" },
    gain: { left: 0, right: 0 },
    setAside: why,
  });
  if (!a || !b) return aside("there was nothing on pipelines 1+2");
  const straight = (x, ch) => x.source === ch && x.mixdown === ch;
  const pair = (l, r) =>
    l.gainunit === "dB" && r.gainunit === "dB"
      ? { eq: { left: l.process, right: r.process }, gain: { left: Number(l.gain), right: Number(r.gain) } }
      : aside("pipelines 1+2 use linear gain, which the block cannot carry as a preamp");
  if (straight(a, "0") && straight(b, "1")) return pair(a, b);
  if (straight(a, "1") && straight(b, "0")) return pair(b, a);
  return aside("pipelines 1+2 do not route straight through");
}

// --- presets -----------------------------------------------------------------
// Angle and center character only. HEAD SIZE IS DELIBERATELY EXCLUDED and
// persists across preset changes: it is anatomy, not taste, and it is the one
// parameter with a physically correct per-person answer — it sets the lp1 corner
// (w0 = c/a) and scales the ITD. A preset resizing the listener's skull would be
// wrong, not merely presumptuous.
//
// Center values are picked from the measured ripple curve rather than by feel.
// lambda controls the depth of the phantom-center comb the ITD produces, and it
// does so almost independently of angle (<=3 dB ripple at lambda ~39% for every
// angle tested, <=6 dB at ~67%). What angle moves is WHERE the notch sits:
// 2039 Hz at 22 deg, 1426 Hz at 30 deg, 952 Hz at 45 deg. Wide gets a lower
// center value not because its ripple is worse but because its notch lands on
// vocal fundamentals — which is the wide-angle vocal oddity Phonitor users report.
export const PRESETS = [
  { id: "standard", label: "Standard", angle: 30, lambda: 0.7 },
  { id: "anechoic", label: "Anechoic", angle: 30, lambda: 1.0 },
  { id: "intimate", label: "Intimate", angle: 22, lambda: 0.7 },
  { id: "wide", label: "Wide", angle: 45, lambda: 0.5 },
  { id: "neutral", label: "Neutral center", angle: 30, lambda: 0.0 },
];

// Which preset the current controls correspond to, or "custom". Derived, never
// stored — the same convention the Bauer preset dropdown follows, so any manual
// touch of angle or center falls to Custom on its own.
export function matchPreset({ angle, lambda }) {
  const hit = PRESETS.find((p) => Math.abs(p.angle - angle) < 0.05 && Math.abs(p.lambda - lambda) < 0.005);
  return hit ? hit.id : "custom";
}
