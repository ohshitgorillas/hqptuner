// Installation-side surface of the structural crossfeed block: the settings it
// cannot coexist with, what it carries in from the rows it replaces, and the
// named control points offered for it. Split from binaural.js for the
// file-length gate; binaural.js re-exports these four names, so the block keeps
// a single import site.
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
