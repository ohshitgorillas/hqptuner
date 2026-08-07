#!/usr/bin/env python3
"""Screenshot / measure a page with headless chromium — the visual hand-back harness.

Replaces the per-session playwright boilerplate scratchpad scripts. Two modes,
combinable in one invocation:

  screenshot   .venv/bin/python scripts/snap.py http://127.0.0.1:8090 out.png
  measure      .venv/bin/python scripts/snap.py http://127.0.0.1:8090 --measure ".card"

Measure prints one JSON object per matching element: bounding box plus any
``--style`` properties (computed values). Options:

  --width/--height   viewport (default 1280x900)
  --full-page        capture full scrollable page
  --dark / --light   emulate prefers-color-scheme (default: dark)
  --wait SELECTOR    wait for selector before acting
  --settle MS        extra settle delay after load (default 250)
  --eval JS          run JS in page context after load, print its JSON result
  --measure SELECTOR repeatable; dump geometry for every match
  --style PROP       repeatable; computed style properties to include in measure

Browser binary comes from ``HQPTUNER_CHROMIUM`` if set (on hosts that use a
system chromium instead of an ms-playwright cache), else playwright's default.
"""

import argparse
import json
import os
import sys
from typing import Any

from playwright.sync_api import Browser, Page, Playwright, sync_playwright

MEASURE_JS = """
([sel, props]) => Array.from(document.querySelectorAll(sel)).map(el => {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const styles = Object.fromEntries(props.map(p => [p, cs.getPropertyValue(p)]));
  return {selector: sel, x: r.x, y: r.y, width: r.width, height: r.height, ...styles};
})
"""


def parse_args(argv: list[str]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url")
    ap.add_argument("out", nargs="?", help="screenshot path (.png); omit for measure/eval-only runs")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--full-page", action="store_true")
    scheme = ap.add_mutually_exclusive_group()
    scheme.add_argument("--dark", dest="scheme", action="store_const", const="dark", default="dark")
    scheme.add_argument("--light", dest="scheme", action="store_const", const="light")
    ap.add_argument("--wait", metavar="SELECTOR")
    ap.add_argument("--settle", type=int, default=250, metavar="MS")
    ap.add_argument("--eval", dest="eval_js", metavar="JS")
    ap.add_argument("--measure", action="append", default=[], metavar="SELECTOR")
    ap.add_argument("--style", action="append", default=[], metavar="PROP")
    args = ap.parse_args(argv)
    if not (args.out or args.measure or args.eval_js):
        ap.error("nothing to do: give an output path, --measure, or --eval")
    return args


def launch(pw: Playwright) -> Browser:
    binary = os.environ.get("HQPTUNER_CHROMIUM")
    if binary:
        return pw.chromium.launch(executable_path=binary)
    return pw.chromium.launch()


def run(page: Page, args: argparse.Namespace) -> None:
    page.goto(args.url, wait_until="networkidle")
    if args.wait:
        page.wait_for_selector(args.wait)
    page.wait_for_timeout(args.settle)
    results: dict[str, Any] = {}
    if args.eval_js:
        results["eval"] = page.evaluate(args.eval_js)
    if args.measure:
        results["measure"] = [box for sel in args.measure for box in page.evaluate(MEASURE_JS, [sel, args.style])]
    if args.out:
        page.screenshot(path=args.out, full_page=args.full_page)
        results["screenshot"] = args.out
    json.dump(results, sys.stdout, indent=2)
    print()


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    with sync_playwright() as pw:
        browser = launch(pw)
        try:
            page = browser.new_page(viewport={"width": args.width, "height": args.height}, color_scheme=args.scheme)
            run(page, args)
        finally:
            browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
