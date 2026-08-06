// Installation-side surface of the structural crossfeed block: the settings it
// cannot coexist with, what it carries in from the rows it replaces, and the
// named control points offered for it. Split from binaural.js for the
// file-length gate; binaural.js holds the maths, this file the install surface,
// and callers import from whichever they need.
//
// Like binaural.js, this module imports NOTHING — that is what lets the
// binaural tests run under plain node with no shim.

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

// What the block carries in from the rows it takes over, or a refusal.
//
// The install is all-or-nothing, and this is the half that decides. A starting
// point the block cannot carry is REFUSED, not carried in partially: the
// alternative — installing an EQ-less block over rows that had EQ on them —
// destroys settings the user already had, which is not honouring their action
// but doing something they never asked for. Refusing costs them a click;
// installing over the top costs them their tuning.
//
// Readable means a plain stereo pair: two rows, each routed from a source to
// its own matching mixdown, with a gain the block can carry as a preamp. Ears
// come off the SOURCE channel, never off row position. Gains marked dB carry as
// they stand; gains marked Lin convert, which is undefined at or below zero.
// Rows past the pair ride along untouched, so none of them may write into a
// mixdown the block owns.
export const REFUSAL =
  "⚠ Structural crossfeed requires a stereo starting point. Ensure the first two pipelines route to themselves.";

const refused = () => ({ refused: true });

// A row's gain in dB, or null when it has none the block can carry.
//
// Snapped to the 1e-3 dB grid the block's preamp lives on. `recognizeRows` snaps
// to that grid and then re-derives all sixteen gains from the snapped value at a
// far tighter tolerance, so a preamp compiled off-grid produces a block that is
// not recognized as one — installed and instantly invisible. A converted linear
// gain lands off-grid almost always, an entered dB gain occasionally, and both
// come back out through `removeStructural` at this same precision anyway.
const snapDb = (v) => Math.round(v * 1000) / 1000;

function gainDb(row) {
  const raw = Number(row.gain);
  if (!Number.isFinite(raw)) return null;
  if (row.gainunit === "dB") return snapDb(raw);
  return raw > 0 ? snapDb(20 * Math.log10(raw)) : null;
}

export function pairInfo(rows) {
  const [a, b] = rows;
  if (!a || !b) return refused();
  const straight = (x, ch) => x.source === ch && x.mixdown === ch;
  let l;
  let r;
  if (straight(a, "0") && straight(b, "1")) [l, r] = [a, b];
  else if (straight(a, "1") && straight(b, "0")) [l, r] = [b, a];
  else return refused();
  if (rows.slice(2).some((x) => x.mixdown === "0" || x.mixdown === "1")) return refused();
  const left = gainDb(l);
  const right = gainDb(r);
  if (left === null || right === null) return refused();
  return { eq: { left: l.process, right: r.process }, gain: { left, right } };
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
