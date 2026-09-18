"""Band levels per burst, so a burst with no HF content is told from a burst with no content at all."""

from __future__ import annotations

import numpy as np
from jbconfig import LABEL_HZ, SMOOTH_BINS
from jbcurves import Grid, frame_content, median_smooth, readings, row_floor
from jbderived import load_burst, summed_db

#: The bands each burst is reported over; a high edge of 0 means the top kept bin.
PROBE_BANDS = ((100.0, 10_000.0), (15_000.0, 18_000.0), (20_000.0, 24_000.0), (24_000.0, 0.0))


def probe(stamps: list[str]) -> None:
    """Print band levels for named bursts, one line each."""
    print("stamp            frames  floor  0.1-10k  15-18k  20-24k  24k-top  hot24  rate  ceiling")
    for stamp in stamps:
        meta, db = load_burst(stamp)
        grid = Grid(int(meta["bins"]), float(meta["bandwidth"]))
        summed = summed_db(db)
        smoothed = median_smooth(summed[:, : grid.kept], SMOOTH_BINS)
        floor = row_floor(smoothed)
        bands = []
        for lo, hi in PROBE_BANDS:
            a = grid.at(lo)
            b = grid.kept - 1 if hi == 0.0 else grid.at(hi)
            bands.append(float(np.median(smoothed[:, a : b + 1].max(axis=1))))
        hot = int(frame_content(summed, grid, LABEL_HZ).sum())
        ceiling, _ = readings(summed.min(axis=0)[None, :], grid)
        print(
            f"{stamp} {summed.shape[0]:6d} {float(np.median(floor)):6.1f} "
            f"{bands[0]:8.1f} {bands[1]:7.1f} {bands[2]:7.1f} {bands[3]:8.1f} {hot:6d} "
            f"{meta['samplerate']:6} {ceiling[0] / 1000 if np.isfinite(ceiling[0]) else -1:7.1f}",
            flush=True,
        )
