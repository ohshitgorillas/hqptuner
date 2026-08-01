#!/usr/bin/env python3
"""Gate: no source file longer than MAX_LINES lines."""

import sys
from pathlib import Path

MAX_LINES = 500


def main() -> int:
    failed = False
    for name in sys.argv[1:]:
        lines = len(Path(name).read_text().splitlines())
        if lines > MAX_LINES:
            print(f"{name}: {lines} lines (max {MAX_LINES}) — split it")
            failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
