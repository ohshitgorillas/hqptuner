#!/usr/bin/env python3
"""Unpack every junkburst capture once, then score block-level cliff candidates against track labels.

Stage 1 (``unpack``) decodes each ``junkburst-*.json.gz`` with the header struct and body layout the file names, and
writes ``derived/<stamp>.npy`` — per-frame per-bin dB per channel, float16 — beside ``derived/<stamp>.json`` carrying
the header constants, the status and the arrival times. A burst whose two derived files exist is skipped, so no burst
is unpacked twice.

Stage 2 (``report``) reads only the derived files. Every block is labelled cliff or full from the per-frame contrast
test over its own frames, and three block candidates plus ``junkadvisor.classify`` on the block's per-bin minimum are
scored against those per-block labels over a sweep of block lengths.

``JB_REPORT`` names the output file under the capture directory, or is taken as written when it begins with a slash;
``JB_CLIFF_LO`` moves the bottom of the cliff window
and carries the fall reference band down by the same distance.

``report --labels`` grades the same blocks against the owner's labels in ``labels.tsv`` instead of the spectrum rule,
adds candidate D, scores transition bursts in their own table, and picks each candidate's threshold by sweeping that
candidate's own values for the fewest wrong-side blocks.

Usage: ``python scripts/junkburst_blocks.py unpack [--workers N]`` then ``python scripts/junkburst_blocks.py report``.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent / "junkburst"))

from jbconfig import DER
from jblabelled import report_labelled
from jbprobe import probe
from jbscore import report
from jbunpack import unpack


def main() -> None:
    """Run the stage named on argv."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("unpack", "report", "probe"))
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--stamps", nargs="*", default=[])
    parser.add_argument(
        "--labels",
        action="store_true",
        help="grade every block against the owner's label from labels.tsv instead of the spectrum rule",
    )
    args = parser.parse_args()
    if args.stage == "unpack":
        unpack(args.workers)
    elif args.stage == "probe":
        probe(args.stamps or sorted(p.stem for p in DER.glob("*.npy")))
    elif args.labels:
        report_labelled()
    else:
        report()


if __name__ == "__main__":
    main()
