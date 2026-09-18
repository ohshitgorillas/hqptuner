"""Paths, grid constants and the environment knobs every junkburst stage reads.

The capture directory, the derived directory and the report path are fixed here, so a stage module names no path of
its own. Every knob is an environment variable read once at import.
"""

from __future__ import annotations

import os
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from hqptuner.engine import junkadvisor

SRC = Path("/srv/hqptuner/state/junkburst")
DER = SRC / "derived"
#: ``JB_REPORT`` is a bare name under the capture directory, or an absolute path taken as written.
_JB_REPORT = os.environ.get("JB_REPORT") or "report.md"
REPORT = Path(_JB_REPORT) if _JB_REPORT.startswith("/") else SRC / Path(_JB_REPORT).name
HEADER = struct.Struct("<4I3fI")

FLOOR_DB = -200.0
CONTRAST_DB = junkadvisor.CONTRAST_DB
DROP_TOP_BINS = junkadvisor.DROP_TOP_BINS
SMOOTH_BINS = junkadvisor.SMOOTH_BINS
FLOOR_PCT = junkadvisor.FLOOR_PERCENTILE
CLIFF_WINDOW_HZ = junkadvisor.CLIFF_WINDOW_HZ
CLIFF_REF_HZ = junkadvisor.CLIFF_REF_HZ
CLIFF_GUARD_HZ = junkadvisor.CLIFF_GUARD_HZ

#: junkadvisor's own window and reference band, which ``JB_CLIFF_LO`` never moves; the walk-up edge reads them.
WALKUP_WINDOW_HZ = junkadvisor.CLIFF_WINDOW_HZ
WALKUP_REF_HZ = junkadvisor.CLIFF_REF_HZ

#: ``JB_CLIFF_LO`` moves the bottom of the cliff window down, carrying the reference band down by the same distance so
#: the fall is still read from the same span below the window. ``junkadvisor.classify`` keeps its own constants.
_CLIFF_LO = os.environ.get("JB_CLIFF_LO")
if _CLIFF_LO:
    _SHIFT = CLIFF_WINDOW_HZ[0] - float(_CLIFF_LO)
    CLIFF_WINDOW_HZ = (float(_CLIFF_LO), CLIFF_WINDOW_HZ[1])
    CLIFF_REF_HZ = (CLIFF_REF_HZ[0] - _SHIFT, CLIFF_REF_HZ[1] - _SHIFT)

#: Window bottom the no-reading section re-reads a cliff block's ceiling with, so content stopping below the working
#: window still reports where it stops.
CEILING_PROBE_LO_HZ = 12_000.0

#: ``readings`` walks up from the reference band and stops at the first bin at least ``EDGE_STEP_DB`` below the
#: reference mean, held for the bin guard width. ``JB_EDGE_STEP_DB`` overrides the step. A row whose reference mean
#: sits under ``EDGE_FLOOR_GUARD_DB`` above the row's floor carries no reading at all; ``JB_EDGE_FLOOR_GUARD_DB``
#: overrides that guard.
EDGE_STEP_DB = float(os.environ.get("JB_EDGE_STEP_DB") or 20.0)
EDGE_FLOOR_GUARD_DB = float(os.environ.get("JB_EDGE_FLOOR_GUARD_DB") or 12.0)

LABEL_MIN_RATE = 88_200
LABEL_HZ = 24_000.0
CANDIDATE_C_HZ = 22_000.0
CANDIDATE_D_HZ = 24_000.0
#: Candidates E2 and E3 both read the same two bands: the numerator band above the 24 kHz edge and the reference band
#: well inside every master's content.
CANDIDATE_E_NUM_HZ = (24_000.0, 26_000.0)
CANDIDATE_E_REF_HZ = (15_000.0, 18_000.0)
#: E2 sums linear power over each band per frame and reads how far that band level moves across the block — its 90th
#: percentile minus its 10th, in dB — as the upper band's movement divided by the reference band's. A block whose
#: reference band barely moves carries no reading: the ratio has nothing steady to divide by.
CANDIDATE_E2_MIN_REF_SPREAD_DB = float(os.environ.get("JB_E2_MIN_REF_DB") or 3.0)
#: E3 reads the block's per-bin median curve against a median-smoothed copy of itself and compares the mean absolute
#: residual of the two bands. A block whose reference band sits too close to its own floor carries no reading: the
#: residual there is floor ripple, not content structure.
CANDIDATE_E3_MIN_REF_OVER_FLOOR_DB = float(os.environ.get("JB_E3_MIN_REF_DB") or 12.0)
#: Guard values the ``--labels`` run sweeps each candidate's NaN guard over.
E2_GUARD_SWEEP = tuple(round(0.5 * i, 1) for i in range(25))
E3_GUARD_SWEEP = tuple(float(i) for i in range(31))
#: Candidate AMT's veto band sits this far above whichever edge produced AM's fall, read against the same
#: statistic over the 15-18 kHz reference band times a swept factor.
AMT_NEAR_LO_HZ = 1_500.0
AMT_NEAR_HI_HZ = 4_000.0
AMT_FACTOR_SWEEP = tuple(round(0.5 + 0.05 * i, 2) for i in range(9))
WINDOWS = (0.125, 0.25, 0.5, 1.0, 2.0, 5.0)
HEADLINE_WINDOW = 1.0

#: Candidate F reads mirroring around a fold frequency: content genuinely above a fold correlates with nothing below
#: it, while a mirrored-image artifact leaves the two sides looking like reflections of each other.
CANDIDATE_F_FOLDS_HZ = (22_050.0, 24_000.0)
CANDIDATE_F_INNER_HZ = 500.0
CANDIDATE_F_OUTER_HZ = 6_000.0

#: Width of the median the content test reads the band through. One frame is one FFT, not a folded window, so its
#: noise floor ripples: over the bins above 24 kHz the loudest bin of a narrow median clears the row's low percentile
#: by enough to fire the contrast test on masters carrying nothing up there. At junkadvisor's baseline width the
#: ripple is gone and real content stands well clear.
CONTENT_SMOOTH_BINS = junkadvisor.SPUR_BASELINE_BINS

#: Owner label inputs. ``tracks.tsv`` carries one row per burst; ``labels.tsv`` carries the owner's verdict per artist
#: and album, or per track where the album row reads ``BY_TRACK``.
TRACKS_TSV = SRC / "tracks.tsv"
LABELS_TSV = SRC / "labels.tsv"
BY_TRACK = "BY_TRACK"

#: The two groups every labelled table is split into, transition bursts scored in their own.
GROUPS = ("steady", "transition")
