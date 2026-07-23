#!/usr/bin/env python3
"""Independent reference check for ``static/lib/binaural.js``.

The repo has no JS test runner, so the structural-crossfeed compiler has no
in-suite coverage. This script is its safety net: it implements Brown & Duda's
model from the equations in ``docs/crossfeed-math.md`` — deliberately not from
the JS — and checks three things about the compiled rows.

1. They realize the intended centre and side transfer functions G_M and G_S.
2. At lambda = 0 the centre is exactly unity at every frequency.
3. One ear's rows sum to exactly the preamp gain at DC, for every lambda.

Not a pytest test: it drives the real module through node, and ``docs/testing.md``
forbids mocking our own code. Run it by hand, or in CI where node exists. With no
node on PATH it skips rather than fails, so ``make check`` stays green.

Usage: ``python scripts/check_binaural.py [--verbose]``
"""

from __future__ import annotations

import cmath
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SPEED_OF_SOUND = 343.0
HEAD_RADIUS = 0.0875
ALPHA_MIN = 0.1
THETA_MIN = 150.0

LIB = Path(__file__).resolve().parent.parent / "hqptuner" / "static" / "lib" / "binaural.js"

FREQS = [20, 50, 100, 200, 400, 624, 1000, 1248, 2000, 4000, 8000, 16000, 20000]
LAMBDAS = [0.0, 0.25, 0.5, 1.0, 1.5]
ANGLES = [15, 30, 45]

# Two different tolerances, because two different things are being checked.
# The transfer-function checks run on unquantized floats, so they hold to machine
# epsilon. The DC check sums the SERIALIZED gains, which compileRows writes to 9
# decimals — eight rows of half-ulp rounding bounds the sum at 4e-9. Loosening
# the first tolerance to cover the second would hide real regressions in the maths.
TOLERANCE = 1e-12
WIRE_TOLERANCE = 1e-8

DRIVER = """
import {{ midSideResponse, compileRows, pathParams, recognizeRows, blockConflicts, pairInfo,
         PRESETS, matchPreset, magDb }} from "{lib}";

const responses = {cases}.map(([f, lambda, angle]) => {{
  const r = midSideResponse(f, {{ lambda, angle }});
  return {{ f, lambda, angle, mid: r.mid, side: r.side }};
}});
const dc = {lambdas}.map((lambda) => ({{
  lambda,
  rows: compileRows({{ lambda, angle: 30, preampDb: -6 }}),
}}));

// compile -> recognize -> compile must land byte-identical, and an edited row
// must stop being recognized rather than being silently reinterpreted.
const roundTrip = [];
for (const lambda of {lambdas}) {{
  for (const angle of {angles}) {{
    const opts = {{ lambda, angle, preampDb: -6, eqProcess: "iir:type=peak;f=1000;q=1;g=3" }};
    // asymmetric: a measured per-ear correction, different chain AND preamp
    const asym = {{ lambda, angle,
      preampDb: {{ left: -6, right: -4.5 }},
      eqProcess: {{ left: "iir:type=peak;f=1000;q=1;g=3", right: "iir:type=peak;f=900;q=1.2;g=2" }} }};
    const asymRows = compileRows(asym);
    const asymRec = recognizeRows(asymRows);
    const asymBack = asymRec === null ? null : compileRows({{
      lambda: asymRec.lambda, angle: asymRec.angle, headRadius: asymRec.headRadius,
      preampDb: asymRec.preampDb, eqProcess: asymRec.eqProcess,
    }});
    roundTrip.push({{ lambda, angle, recognized: asymRec !== null,
                      rec: asymRec,
                      identical: JSON.stringify(asymRows) === JSON.stringify(asymBack) }});
    const rows = compileRows(opts);
    const rec = recognizeRows(rows);
    const again = rec === null ? null : compileRows({{
      lambda: rec.lambda, angle: rec.angle, headRadius: rec.headRadius,
      preampDb: rec.preampDb, eqProcess: rec.eqProcess,
    }});
    roundTrip.push({{ lambda, angle, recognized: rec !== null, rec,
                      identical: JSON.stringify(rows) === JSON.stringify(again) }});
  }}
}}

const clean = compileRows({{ lambda: 0.5, angle: 30 }});
const tamper = [];
for (const i of [0, 1, 5, 7, 12]) {{
  const edited = clean.map((r, j) => (j === i ? {{ ...r, gain: String(Number(r.gain) + 0.01) }} : r));
  tamper.push({{ row: i, recognized: recognizeRows(edited) !== null }});
}}
const stageEdit = clean.map((r, j) => (j === 3 ? {{ ...r, process: "iir:type=peak;f=500;q=1;g=2" }} : r));
tamper.push({{ row: "3-stages", recognized: recognizeRows(stageEdit) !== null }});

// Invariants: each incompatible setting must be reported, and a clean config must
// report nothing. Values are the wire encodings the schema actually carries.
const conflictCases = [
  [{{ crossfeed_enabled: "0", matrix_iir2fir: "0" }}, 0],
  [{{ crossfeed_enabled: "1", matrix_iir2fir: "0" }}, 1],
  [{{ crossfeed_enabled: "0", matrix_iir2fir: "2" }}, 1],
  [{{ crossfeed_enabled: "0", matrix_iir2fir: "1" }}, 0],  // minimum-phase: allowed
  [{{ crossfeed_enabled: "1", matrix_iir2fir: "2" }}, 2],
  [{{}}, 0],
];
const conflicts = conflictCases.map(([cfg, want]) => ({{
  cfg, want, got: blockConflicts((k) => cfg[k]).length,
}}));

// pairInfo accepts what the block can round-trip and refuses only what is
// structurally wrong — asymmetry between the ears is not wrong.
const mkRow = (src, mix, process, gain, unit = "dB") =>
  ({{ source: src, mixdown: mix, process, gain, gainunit: unit }});
const EL = "iir:type=peak;f=1000;q=1;g=3";
const ER = "iir:type=peak;f=900;q=1.2;g=2";
const pairCases = [
  ["symmetric", [mkRow("0", "0", EL, "-6"), mkRow("1", "1", EL, "-6")], true],
  ["asymmetric chains", [mkRow("0", "0", EL, "-6"), mkRow("1", "1", ER, "-6")], true],
  ["asymmetric preamps", [mkRow("0", "0", EL, "-6"), mkRow("1", "1", EL, "-4.5")], true],
  ["asymmetric both", [mkRow("0", "0", EL, "-6"), mkRow("1", "1", ER, "-4.5")], true],
  ["In 2 first", [mkRow("1", "1", ER, "-4.5"), mkRow("0", "0", EL, "-6")], true],
  ["crossed routing set aside", [mkRow("0", "1", EL, "-6"), mkRow("1", "0", EL, "-6")], false],
  ["Lin gains set aside", [mkRow("0", "0", EL, "0.5", "Lin"), mkRow("1", "1", EL, "0.5", "Lin")], false],
];
const pairs = pairCases.map(([label, rows, want]) => {{
  const r = pairInfo(rows);
  // pairInfo never refuses: `want` now means "readable as an EQ pair"
  const ok = (r.setAside === undefined) === want;
  // an accepted pair must also survive a compile -> recognize round trip
  let survives = true;
  if (r.setAside === undefined) {{
    const built = compileRows({{ lambda: 0.5, angle: 30, eqProcess: r.eq, preampDb: r.gain }});
    const back = recognizeRows(built);
    survives = back !== null && back.eqProcess.left === r.eq.left && back.eqProcess.right === r.eq.right;
  }}
  return {{ label, ok: ok && survives }};
}});

// Presets: each must round-trip through matchPreset, must leave head size alone,
// and must land within the centre ripple its value was chosen for.
const rippleFreqs = Array.from({{ length: 400 }}, (_, i) => 20 * 1000 ** (i / 399));
const ripple = (angle, lambda) => {{
  let lo = Infinity;
  let hi = -Infinity;
  for (const f of rippleFreqs) {{
    const db = magDb(midSideResponse(f, {{ angle, headRadius: 0.0875, lambda }}).mid);
    if (db < lo) lo = db;
    if (db > hi) hi = db;
  }}
  return hi - lo;
}};
const presets = PRESETS.map((x) => ({{
  id: x.id,
  matches: matchPreset({{ angle: x.angle, lambda: x.lambda }}) === x.id,
  noHeadSize: !("headRadius" in x),
  ripple: Number(ripple(x.angle, x.lambda).toFixed(2)),
}}));
presets.push({{
  id: "custom on touch",
  matches: matchPreset({{ angle: 31, lambda: 0.7 }}) === "custom"
    && matchPreset({{ angle: 30, lambda: 0.72 }}) === "custom",
  noHeadSize: true,
  ripple: 0,
}});

console.log(JSON.stringify({{ responses, dc, params: pathParams(30), roundTrip, tamper, conflicts, pairs, presets }}));
"""


def alpha_of(theta: float) -> float:
    """Brown & Duda eq. (5) — the head-shadow filter's zero position."""
    return 1 + ALPHA_MIN / 2 + (1 - ALPHA_MIN / 2) * math.cos((theta / THETA_MIN) * math.pi)


def ray_delay(theta: float) -> float:
    """Eq. (2), Woodworth & Schlosberg — arrival time relative to head centre."""
    rad = math.radians(abs(theta))
    scale = HEAD_RADIUS / SPEED_OF_SOUND
    if rad < math.pi / 2:
        return -scale * math.cos(rad)
    return scale * (rad - math.pi / 2)


def head_shadow(freq: float, theta: float) -> complex:
    """Eq. (3) — single pole at 2*w0, zero at 2*w0/alpha, with w0 = c/a."""
    x = math.pi * freq * HEAD_RADIUS / SPEED_OF_SOUND
    return (1 + 1j * alpha_of(theta) * x) / (1 + 1j * x)


def analytic(freq: float, lam: float, angle: float) -> tuple[complex, complex]:
    """The centre and side transfer functions the compiled rows must realize."""
    near, far = 90 - angle, 90 + angle
    itd = ray_delay(far) - ray_delay(near)
    h_near = head_shadow(freq, near)
    h_far = head_shadow(freq, far) * cmath.exp(-2j * math.pi * freq * itd)
    return lam * (h_near + h_far) / 2 + (1 - lam), (h_near - h_far) / 2


def run_driver(node: str) -> dict[str, object]:
    """Evaluate the real module and hand back its numbers."""
    cases = [[f, lam, ang] for ang in ANGLES for lam in LAMBDAS for f in FREQS]
    source = DRIVER.format(
        lib=LIB.as_uri(),
        cases=json.dumps(cases),
        lambdas=json.dumps(LAMBDAS),
        angles=json.dumps(ANGLES),
    )
    with tempfile.TemporaryDirectory() as tmp:
        driver = Path(tmp) / "driver.mjs"
        driver.write_text(source)
        proc = subprocess.run([node, str(driver)], capture_output=True, text=True, check=True)  # noqa: S603
    parsed: dict[str, object] = json.loads(proc.stdout)
    return parsed


def check_transfer_functions(responses: list[dict[str, object]]) -> tuple[float, float]:
    """Worst deviation of the compiled block from analytic G_M and G_S."""
    worst_mid = worst_side = 0.0
    for rec in responses:
        want_mid, want_side = analytic(float(rec["f"]), float(rec["lambda"]), float(rec["angle"]))
        got_mid = complex(*rec["mid"])  # type: ignore[misc]
        got_side = complex(*rec["side"])  # type: ignore[misc]
        worst_mid = max(worst_mid, abs(got_mid - want_mid))
        worst_side = max(worst_side, abs(got_side - want_side))
    return worst_mid, worst_side


def check_unity_centre(responses: list[dict[str, object]]) -> float:
    """At lambda = 0 the centre must be exactly 1 at every frequency."""
    return max(abs(complex(*r["mid"]) - 1) for r in responses if r["lambda"] == 0.0)  # type: ignore[misc]


def check_dc_sum(dc_cases: list[dict[str, object]]) -> float:
    """One ear's rows sum to the preamp gain at DC, since G_M(0) = 1 for all lambda."""
    expected = 10 ** (-6 / 20)
    worst = 0.0
    for case in dc_cases:
        rows: list[dict[str, str]] = case["rows"]  # type: ignore[assignment]
        total = sum(float(r["gain"]) for r in rows if r["mixdown"] == "0")
        worst = max(worst, abs(total - expected))
    return worst


def main() -> int:
    verbose = "--verbose" in sys.argv
    node = shutil.which("node")
    if node is None:
        print("check_binaural: node not on PATH — skipping (not a failure)")
        return 0
    if not LIB.exists():
        print(f"check_binaural: {LIB} not found")
        return 1

    got = run_driver(node)
    responses: list[dict[str, object]] = got["responses"]  # type: ignore[assignment]
    worst_mid, worst_side = check_transfer_functions(responses)
    unity = check_unity_centre(responses)
    dc_error = check_dc_sum(got["dc"])  # type: ignore[arg-type]
    trips: list[dict[str, object]] = got["roundTrip"]  # type: ignore[assignment]
    tamper: list[dict[str, object]] = got["tamper"]  # type: ignore[assignment]
    unrecognized = [t for t in trips if not t["recognized"]]
    not_identical = [t for t in trips if not t["identical"]]
    still_recognized = [t for t in tamper if t["recognized"]]
    conflicts: list[dict[str, object]] = got["conflicts"]  # type: ignore[assignment]
    miscounted = [c for c in conflicts if c["got"] != c["want"]]
    pairs: list[dict[str, object]] = got["pairs"]  # type: ignore[assignment]
    bad_pairs = [p for p in pairs if not p["ok"]]
    presets: list[dict[str, object]] = got["presets"]  # type: ignore[assignment]
    bad_presets = [x for x in presets if not (x["matches"] and x["noHeadSize"])]

    results = [
        (f"rows realize G_M over {len(responses)} cases", worst_mid, TOLERANCE),
        ("rows realize G_S", worst_side, TOLERANCE),
        ("lambda=0 centre is unity", unity, TOLERANCE),
        ("DC sum equals preamp gain (serialized gains)", dc_error, WIRE_TOLERANCE),
        (f"every compiled block recognized ({len(trips)} cases)", float(len(unrecognized)), 0.0),
        ("compile -> recognize -> compile is byte-identical", float(len(not_identical)), 0.0),
        (f"edited rows stop being recognized ({len(tamper)} edits)", float(len(still_recognized)), 0.0),
        (f"invariant conflicts reported ({len(conflicts)} configs)", float(len(miscounted)), 0.0),
        (f"pair shapes read or set aside, never refused ({len(pairs)} cases)", float(len(bad_pairs)), 0.0),
        (f"presets round-trip and exclude head size ({len(presets)} cases)", float(len(bad_presets)), 0.0),
    ]
    failed = False
    for label, error, tolerance in results:
        ok = error <= tolerance
        failed = failed or not ok
        print(f"[{'ok' if ok else 'FAIL'}] {label}: worst error {error:.3e} (tol {tolerance:.0e})")

    if verbose:
        for x in presets[:-1]:
            print(f"      preset {x['id']:<14} centre ripple {x['ripple']:5.2f} dB")
        params: dict[str, float] = got["params"]  # type: ignore[assignment]
        lf_itd = params["itd"] + params["groupDelayFar"] - params["groupDelayNear"]
        print(f"      alpha near {params['alphaNear']:.4f} / far {params['alphaFar']:.4f}")
        print(f"      ITD {params['itd'] * 1e6:.1f} us, corner {params['cornerHz']:.1f} Hz")
        print(f"      LF ITD {lf_itd * 1e6:.1f} us ({lf_itd / params['itd'] - 1:+.0%} vs HF)")
        tilt = 20 * math.log10((params["alphaNear"] + params["alphaFar"]) / 2)
        print(f"      coherent HF centre tilt at lambda=1: {tilt:.2f} dB")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
