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

from hqptuner.engine import blockstats, junkadvisor

SRC = Path("/srv/hqptuner/state/junkburst")
DER = SRC / "derived"
#: ``JB_REPORT`` is a bare name under the capture directory, or an absolute path taken as written.
_JB_REPORT = os.environ.get("JB_REPORT") or "report.md"
REPORT = Path(_JB_REPORT) if _JB_REPORT.startswith("/") else SRC / Path(_JB_REPORT).name
HEADER = struct.Struct("<4I3fI")

FLOOR_DB = -200.0
CONTRAST_DB = junkadvisor.CONTRAST_DB
DROP_TOP_BINS = blockstats.DROP_TOP_BINS
SMOOTH_BINS = blockstats.SMOOTH_BINS
FLOOR_PCT = junkadvisor.FLOOR_PERCENTILE
#: The retired reference-band fall's own window, reference band and guard, which the cliff candidates here still read.
CLIFF_WINDOW_HZ = (20_000.0, 26_000.0)
CLIFF_REF_HZ = (15_000.0, 18_000.0)
CLIFF_GUARD_HZ = 1_500.0

#: The same window and reference band, which ``JB_CLIFF_LO`` never moves; the walk-up edge reads them.
WALKUP_WINDOW_HZ = (20_000.0, 26_000.0)
WALKUP_REF_HZ = (15_000.0, 18_000.0)

#: ``JB_CLIFF_LO`` moves the bottom of the cliff window down, carrying the reference band down by the same distance so
#: the fall is still read from the same span below the window. The walk-up pair above is never moved.
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
#: Windows the mask reading is scored at, each with its own block length, so the mask sweep can be read at more than
#: the headline window.
MASK_SWEEP_WINDOWS = (1.0, 2.0, 5.0)

#: Candidate F reads mirroring around a fold frequency: content genuinely above a fold correlates with nothing below
#: it, while a mirrored-image artifact leaves the two sides looking like reflections of each other.
CANDIDATE_F_FOLDS_HZ = (22_050.0, 24_000.0)
CANDIDATE_F_INNER_HZ = 500.0
CANDIDATE_F_OUTER_HZ = 6_000.0

#: Candidate G reads the step across each image fold on the block's per-bin minimum curve: the median of a band just
#: above the fold minus the median of the same-width band just below it. An image leaves the curve stepping at the
#: fold; content carrying on through it does not.
CANDIDATE_G_FOLDS_HZ = (22_050.0, 24_000.0)
#: Control folds for GC. Nothing folds at these frequencies, so the step measured there is the curve's own tilt, and
#: GC subtracts the median of it from G.
CANDIDATE_G_CONTROL_FOLDS_HZ = (27_000.0, 30_000.0, 33_000.0)
#: Candidate H reads G's signed step at a fold against the same signed step measured this far below and above it.
#: A curve that steps at the fold alone keeps its reading; a curve tilting through the whole span loses it.
CANDIDATE_H_OFFSET_HZ = 2_000.0

#: Each of G's two bands stands this far clear of its fold and runs this wide.
CANDIDATE_G_GUARD_HZ = 300.0
CANDIDATE_G_BAND_HZ = 1_500.0

#: A block is quiet when the 90th percentile of its 15-18 kHz reference band sits under this level in the metering's
#: own dB. The value is the 10th percentile of that level over every labelled 1 s block of the corpus, so the quiet
#: half is the corpus's own quietest tenth. The quiet and loud halves are thresholded separately, because a candidate
#: reading a band that quiet is reading something different from the same band on a loud block.
QUIET_MAX_LEVEL_DB = -104.9820

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

#: The mask reading walks the same two image folds as candidates F and G. Above each fold it reads the band from
#: ``MASK_ABOVE_HZ[0]`` to ``MASK_ABOVE_HZ[1]`` above the fold, and reads it against the 15-18 kHz music band, so a
#: mirrored image is measured where it lands rather than where the master's own content stops.
MASK_FOLDS_HZ = (22_050.0, 24_000.0)
MASK_ABOVE_HZ = (300.0, 6_000.0)

#: Candidate M reads mirroring in time rather than in the bin curve: for each offset below it walks the per-frame
#: level at that distance above a fold against the per-frame level the same distance below it, and takes off the
#: same correlation with the upper bin moved ``CANDIDATE_M_SHIFT_HZ`` further out. A mirrored image moves frame for
#: frame with its source; content carrying on past the fold does not, and the shifted pair says how much of the
#: correlation is the band's own common movement.
CANDIDATE_M_FOLDS_HZ = (22_050.0, 24_000.0)
CANDIDATE_M_OFFSETS_HZ = tuple(500.0 + 250.0 * i for i in range(23))
CANDIDATE_M_SHIFT_HZ = 1_000.0

#: The two image folds the edge candidates P, G90 and S all read. Each candidate takes its reading at whichever of
#: them reads stronger, and carries no reading when neither lies on the burst's grid.
EDGE_FOLDS_HZ = (22_050.0, 24_000.0)
#: Candidate P walks a per-frame edge: the highest bin inside ``CANDIDATE_P_EDGE_HZ`` above which every bin for the
#: next ``CANDIDATE_P_HOLD_HZ`` sits under that frame's own mean level over ``CANDIDATE_P_REF_HZ`` plus
#: ``CANDIDATE_P_STEP_DB``. P is the share of the block's frames whose edge lands within ``CANDIDATE_P_NEAR_HZ`` of
#: the fold, so a master whose content stops at the fold frame after frame reads high and one whose edge wanders
#: reads low.
CANDIDATE_P_EDGE_HZ = (15_000.0, 30_000.0)
CANDIDATE_P_REF_HZ = (34_000.0, 40_000.0)
CANDIDATE_P_STEP_DB = 10.0
CANDIDATE_P_HOLD_HZ = 1_000.0
CANDIDATE_P_NEAR_HZ = 300.0
#: Candidate S reads how far the per-bin spread collapses across a fold: the mean over bins of the p90 minus the
#: minimum across frames, taken over the band from ``CANDIDATE_S_INNER_HZ`` to ``CANDIDATE_S_OUTER_HZ`` above the
#: fold, divided by the same over the mirrored band below it.
CANDIDATE_S_INNER_HZ = 300.0
CANDIDATE_S_OUTER_HZ = 1_800.0

#: Candidate T reads the p90 curve's tilt on each side of the fold the loud-frame step selects: the least-squares
#: slope in dB per kHz over a band standing ``CANDIDATE_T_GUARD_HZ`` clear of the fold and running
#: ``CANDIDATE_T_BAND_HZ`` wide, taken above the fold and below it. An image rises into the fold from above and the
#: master's own content falls away below it, so the two slopes carry opposite signs where the fold is a fold. The
#: fold is whichever of ``EDGE_FOLDS_HZ`` carries the larger absolute step, the one the loud-frame step reads.
CANDIDATE_T_GUARD_HZ = 300.0
CANDIDATE_T_BAND_HZ = 1_500.0

#: Candidate U reads the top of the container: the band ending ``CANDIDATE_U_TOP_GUARD_HZ`` below the burst's own
#: Nyquist and running ``CANDIDATE_U_TOP_BAND_HZ`` wide. That band lies above the bins the working grid keeps, so it
#: is read over the burst's full bin range rather than the kept one. U reports that band's level against the
#: ``CANDIDATE_E_REF_HZ`` music band, and how far it moves with the ``CANDIDATE_U_BASS_HZ`` band frame for frame.
CANDIDATE_U_TOP_GUARD_HZ = 300.0
CANDIDATE_U_TOP_BAND_HZ = 2_000.0
CANDIDATE_U_BASS_HZ = (100.0, 500.0)
