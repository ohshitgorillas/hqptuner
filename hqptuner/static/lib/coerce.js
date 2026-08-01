// Small shared value helpers, shared because they are one-liners — exactly the
// kind of copy that drifts when every consumer hand-rolls its own.
//
// A checkbox's truth crosses domains — the daemon's form reports a real bool, a
// staged edit carries "1"/"0" — so every consumer normalizes through `truthy`.
// The "on"/"true" arms cover HTML's default submit value, which hqplayerd's own
// forms override with an explicit "1" but which costs nothing to admit.
export const truthy = (v) => v === true || v === 1 || v === "1" || v === "on" || v === "true";

// Number with a fallback: form values arrive as strings, and an empty or
// unparseable one has to read as the default rather than as NaN.
export const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
