#!/usr/bin/env python3
"""Gate: no source file longer than its limit — 500 lines, 800 under tests/.

Test suites get headroom because the one-assertion-per-test policy inflates
line count without adding coupling; a flat list of cases has no missing
abstraction for a split to surface.
"""

import sys
from pathlib import Path

MAX_LINES = 500
MAX_LINES_TESTS = 800


def limit_for(name: str) -> int:
    return MAX_LINES_TESTS if Path(name).parts[0] == "tests" else MAX_LINES


def main() -> int:
    failed = False
    for name in sys.argv[1:]:
        lines = len(Path(name).read_text().splitlines())
        if lines > limit_for(name):
            print(f"{name}: {lines} lines (max {limit_for(name)}) — split it")
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
