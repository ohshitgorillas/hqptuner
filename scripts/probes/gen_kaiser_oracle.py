#!/usr/bin/env python3
"""Oracle rows for ``designPoint`` in ``lib/dsp/fir.js``, from scipy.

Writes ``tests/support/fixtures/kaiser-oracle.json``: for each (taps, widthHz,
rate) the depth and transition band the primer's design reaches, computed by an
implementation of the Kaiser relations that is not ours
(``docs/plans/filter-primer-math.md`` §1.3, §1.4):

  - predicted depth: ``scipy.signal.kaiser_atten``
  - floor: 21 dB, where ``scipy.signal.kaiser_beta`` first returns 0, so every
    design under it is the same rectangular window
  - cap: 120 dB, the primer's design choice (math §1.4)
  - band at a clamped depth: the widest band ``scipy.signal.kaiserord`` still
    rounds up to ``taps`` for, found by bisection on forward calls only

Rows deliberately include two below the floor at different lengths, one at
the cap, and two inside the relation's range, one of them off every band the
primer's controls produce. Needs scipy in ``.venv``; run from the repo root:

    .venv/bin/python scripts/probes/gen_kaiser_oracle.py [output path]
"""

import json
import sys
from pathlib import Path

from scipy.signal import kaiser_atten, kaiser_beta, kaiserord

FLOOR_DB = 21.0
CAP_DB = 120.0
ROWS = [
    (17, 2700, 176400),
    (33, 2700, 176400),
    (101, 2700, 176400),
    (1411, 2646, 176400),
    (203, 1500, 88200),
]
DEFAULT_OUT = Path("tests/support/fixtures/kaiser-oracle.json")


def band_hz(atten_db: float, taps: int, rate: int) -> float:
    """Widest band, in hertz, that ``kaiserord`` still rounds up to ``taps`` at ``atten_db``."""
    lo, hi = 1e-9, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2
        numtaps, _beta = kaiserord(atten_db, mid)
        if numtaps > taps:
            lo = mid
        else:
            hi = mid
    return hi * rate / 2


def main() -> None:
    """Write the oracle rows to the path in argv, or the default fixture path."""
    if not kaiser_beta(FLOOR_DB - 0.001) == 0 < kaiser_beta(FLOOR_DB + 0.001):
        raise SystemExit(f"scipy's kaiser_beta does not floor at {FLOOR_DB} dB")
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    rows = []
    for taps, width_hz, rate in ROWS:
        predicted = float(kaiser_atten(taps, width_hz / (rate / 2)))
        atten_db = min(CAP_DB, max(FLOOR_DB, predicted))
        rows.append(
            {
                "taps": taps,
                "widthHz": width_hz,
                "rate": rate,
                "attenDb": round(atten_db, 4),
                "bandHz": round(band_hz(atten_db, taps, rate), 2),
            }
        )
    out.write_text(json.dumps(rows, indent=2) + "\n")
    print(f"{len(rows)} rows -> {out}")


if __name__ == "__main__":
    main()
