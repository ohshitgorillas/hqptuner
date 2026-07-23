// Structural crossfeed compiler (docs/crossfeed-math.md). Turns three physical
// controls — speaker angle, head radius, and the centre-character blend λ — into
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
// The centre is on a continuous control while the side path stays physical:
//
//   G_S    = (H_n − H_f)/2                 side — never moves
//   G_M(λ) = λ·(H_n + H_f)/2 + (1 − λ)     centre — λ=1 literal, λ=0 flat
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
export const SPEED_OF_SOUND = 343; // m/s — Brown & Duda §II.A
export const HEAD_RADIUS = 0.0875; // m — Brown & Duda's stated average adult
export const SPEAKER_ANGLE = 30; // degrees off centre — the stereo standard

const ALPHA_MIN = 0.1;
const THETA_MIN = 150;

// Eq. (5). `theta` is interaural-polar: measured from the interaural axis, so a
// source at `angle` degrees off centre sits at 90−angle for the near ear and
// 90+angle for the far one.
export function alphaOf(theta) {
  return 1 + ALPHA_MIN / 2 + (1 - ALPHA_MIN / 2) * Math.cos((theta / THETA_MIN) * Math.PI);
}

// Eq. (2), Woodworth & Schlosberg: arrival time relative to the head centre,
// in seconds. Negative = early (source on this side).
export function rayDelay(theta, a = HEAD_RADIUS, c = SPEED_OF_SOUND) {
  const rad = (Math.abs(theta) * Math.PI) / 180;
  const scale = a / c;
  return rad < Math.PI / 2 ? -scale * Math.cos(rad) : scale * (rad - Math.PI / 2);
}

// The lp1 corner: the pole sits at 2ω₀, so f = ω₀/π = c/(aπ).
export function shadowCornerHz(a = HEAD_RADIUS, c = SPEED_OF_SOUND) {
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
export function earCoefficients(lambda, alphaNear, alphaFar) {
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

// Compile the block for a stereo pair. `srcA`/`srcB` are wire channel indexes;
// `eqProcess` is a per-ear EQ chain appended to every row feeding that ear (EQ
// distributes over the sum, same as msCompile); `preampDb` folds into the Lin
// gains. Always emits 16 rows — four of them fall to zero at λ=1, and keeping
// the count fixed keeps structural recognition simple.
export function compileRows({
  lambda = 1,
  angle = SPEAKER_ANGLE,
  headRadius = HEAD_RADIUS,
  speedOfSound = SPEED_OF_SOUND,
  srcA = 0,
  srcB = 1,
  preampDb = 0,
  eqProcess = "",
} = {}) {
  const p = pathParams(angle, headRadius, speedOfSound);
  const k = 10 ** (preampDb / 20);
  const rows = [];
  for (const [out, near, far] of [
    [srcA, srcA, srcB],
    [srcB, srcB, srcA],
  ]) {
    for (const c of earCoefficients(lambda, p.alphaNear, p.alphaFar)) {
      rows.push({
        gain: (c.gain * k).toFixed(9),
        gainunit: "Lin",
        mixdown: String(out),
        process: chain(c.lowpass, c.delayed ? p.itd : 0, p.cornerHz, eqProcess),
        source: String(c.opposite ? far : near),
      });
    }
  }
  return rows;
}

// --- analysis ----------------------------------------------------------------
// Complex response of the compiled block, for plots and for verifying that the
// rows really do realize G_M and G_S. Evaluated on the analog prototype, which
// is what the daemon's rate-independent parametrics implement.

function lp1Response(f, cornerHz) {
  const x = f / cornerHz;
  const d = 1 + x * x;
  return [1 / d, -x / d];
}

function delayResponse(f, seconds) {
  const w = -2 * Math.PI * f * seconds;
  return [Math.cos(w), Math.sin(w)];
}

const mul = ([ar, ai], [br, bi]) => [ar * br - ai * bi, ar * bi + ai * br];

// Sum of one ear's eight rows at frequency f, as [re, im]. `sameSide` picks
// which source the signal arrived on: pass 1 for correlated (centre) content in
// both sources, or use midSideResponse below.
function earResponse(f, coeffs, p, sourceGain) {
  let re = 0;
  let im = 0;
  for (const c of coeffs) {
    let term = [1, 0];
    if (c.lowpass) term = mul(term, lp1Response(f, p.cornerHz));
    if (c.delayed) term = mul(term, delayResponse(f, p.itd));
    const g = c.gain * sourceGain(c.opposite === true);
    re += g * term[0];
    im += g * term[1];
  }
  return [re, im];
}

// Centre and side transfer functions of the compiled block at frequency f.
// Centre drives both sources in phase; side drives them in antiphase.
export function midSideResponse(f, { lambda = 1, angle = SPEAKER_ANGLE, headRadius = HEAD_RADIUS, speedOfSound = SPEED_OF_SOUND } = {}) {
  const p = pathParams(angle, headRadius, speedOfSound);
  const coeffs = earCoefficients(lambda, p.alphaNear, p.alphaFar);
  return {
    mid: earResponse(f, coeffs, p, () => 1),
    side: earResponse(f, coeffs, p, (opposite) => (opposite ? -1 : 1)),
  };
}

export const magDb = ([re, im]) => 10 * Math.log10(re * re + im * im);
