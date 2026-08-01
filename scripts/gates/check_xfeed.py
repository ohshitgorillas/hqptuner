#!/usr/bin/env python3
"""Regression guard for the crossfeed-compensation block's EQ handling.

Covers the 0.5.0 fix: loading a headphone profile while compensation was on used
to append the new filters to pipelines 1+2 only and overwrite their gain with the
profile's preamp in dB. That dropped the block's 0.5 mid/side factor — roughly
6 dB of centre level into one ear — and broke recognition, so the badge, the
strength slider and Turn off all vanished with no error shown.

Checks, in the order they matter:

1. A compiled block is recognized, and survives an EQ import with its strength,
   its Lin gains and its shared chain intact.
2. The OLD per-row append is still detected as broken — without this the first
   check could pass against a recognizer that accepts anything.
3. Library loads replace the previous profile; per-row imports append.
4. Replacing drops EQ stages only — a delay in the same chain survives.

Not a pytest test: it drives the real modules through node, and ``docs/testing.md``
forbids mocking our own code. With no node on PATH it skips rather than fails.

Usage: ``python scripts/gates/check_xfeed.py``
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

LIB = Path(__file__).resolve().parent.parent.parent / "hqptuner" / "static" / "lib" / "xfeed.js"

DRIVER = """
import {{ msCompile, msRecognize, fitComp, applyEqToBlock }} from "{lib}";

const fit = fitComp(700, 4.5);
const OLD = "iir:type=peak;f=105;q=0.70;g=5.5";
const NEW = "iir:type=peak;f=60;q=0.70;g=4.0";
const WITH_DELAY = OLD + ",delay:t=0.0001";

const block = msCompile(OLD, -6.3, fit, 1.0, 0, 1);
const rec = msRecognize(block, 0, 700, 4.5);

// the legacy doImport behaviour this gate pins against: append to the target
// row and its mirror, and overwrite their gain with the profile's preamp in dB
const legacy = block.map((r, i) =>
  i === 0 || i === 1 ? {{ ...r, process: `${{r.process}},${{NEW}}`, gain: "-6.5", gainunit: "dB" }} : r,
);

const appended = msRecognize(applyEqToBlock(block, rec, fit, NEW, null, false), 0, 700, 4.5);
const replaced = msRecognize(applyEqToBlock(block, rec, fit, NEW, "-6.5", true), 0, 700, 4.5);

const delayBlock = msCompile(WITH_DELAY, -6.3, fit, 1.0, 0, 1);
const delayRec = msRecognize(delayBlock, 0, 700, 4.5);
const delayReplaced = msRecognize(
  applyEqToBlock(delayBlock, delayRec, fit, NEW, null, true), 0, 700, 4.5,
);

const count = (s, re) => (s.match(re) || []).length;
console.log(JSON.stringify({{
  baseline_recognized: rec !== null,
  legacy_breaks_block: msRecognize(legacy, 0, 700, 4.5) === null,
  import_keeps_block: appended !== null,
  import_keeps_strength: appended !== null && appended.sFraction === rec.sFraction,
  append_keeps_old: appended !== null && count(appended.eqProcess, /f=105/g) === 1,
  append_adds_new: appended !== null && count(appended.eqProcess, /f=60/g) === 1,
  replace_drops_old: replaced !== null && count(replaced.eqProcess, /f=105/g) === 0,
  replace_adds_new_once: replaced !== null && count(replaced.eqProcess, /f=60/g) === 1,
  replace_takes_preamp: replaced !== null && Math.abs(replaced.preampDb - -6.5) < 0.01,
  replace_keeps_delay: delayReplaced !== null && delayReplaced.eqProcess.includes("delay:t=0.0001"),
  replace_keeps_strength: replaced !== null && replaced.sFraction === rec.sFraction,
}}));
"""

LABELS = {
    "baseline_recognized": "a compiled block is recognized",
    "legacy_breaks_block": "the old per-row append is still detected as broken",
    "import_keeps_block": "importing into the block keeps it recognized",
    "import_keeps_strength": "importing preserves compensation strength",
    "append_keeps_old": "append keeps the existing profile",
    "append_adds_new": "append adds the new profile once",
    "replace_drops_old": "replace drops the previous profile",
    "replace_adds_new_once": "replace adds the new profile once",
    "replace_takes_preamp": "replace folds the profile's preamp into the block",
    "replace_keeps_delay": "replace keeps a non-EQ stage in the chain",
    "replace_keeps_strength": "replace preserves compensation strength",
}


def main() -> int:
    node = shutil.which("node")
    if node is None:
        print("check_xfeed: node not on PATH — skipping (not a failure)")
        return 0
    if not LIB.exists():
        print(f"check_xfeed: {LIB} not found")
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        driver = Path(tmp) / "driver.mjs"
        driver.write_text(DRIVER.format(lib=LIB.as_uri()))
        proc = subprocess.run([node, str(driver)], capture_output=True, text=True, check=True)  # noqa: S603
    got: dict[str, bool] = json.loads(proc.stdout)

    failed = False
    for key, label in LABELS.items():
        ok = bool(got.get(key))
        failed = failed or not ok
        print(f"[{'ok' if ok else 'FAIL'}] {label}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
