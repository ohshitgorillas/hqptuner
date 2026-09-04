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
  --console          collect console errors, uncaught page errors and failed
                     requests seen from before load until after settle, into
                     the JSON under ``console``
  --text SELECTOR    repeatable; print the rendered text of every match as
                     numbered blocks after the JSON, with the element's title,
                     aria-label and any popover or tooltip body the DOM already
                     holds (nothing is hovered, clicked or opened)

Browser binary comes from ``HQPTUNER_CHROMIUM`` if set (on hosts that use a
system chromium instead of an ms-playwright cache), else playwright's default.
"""

import argparse
import json
import os
import sys
from typing import Any

from playwright.sync_api import Browser, ConsoleMessage, Error, Page, Playwright, Request, Response, sync_playwright

MEASURE_JS = """
([sel, props]) => Array.from(document.querySelectorAll(sel)).map(el => {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const styles = Object.fromEntries(props.map(p => [p, cs.getPropertyValue(p)]));
  return {selector: sel, x: r.x, y: r.y, width: r.width, height: r.height, ...styles};
})
"""

# Status at or above which a response counts as a failed request rather than a served one.
HTTP_ERROR_STATUS = 400

TEXT_JS = """
(sel) => Array.from(document.querySelectorAll(sel)).map((el, index) => {
  const ref = (attr) => {
    const v = el.getAttribute(attr);
    if (!v) return null;
    const ids = attr === 'aria-describedby' ? v.split(/\\s+/) : [v];
    const text = ids.map(id => document.getElementById(id))
                    .filter(Boolean)
                    .map(n => (n.innerText || n.textContent || '').trim())
                    .filter(Boolean)
                    .join(' ');
    return text || null;
  };
  return {
    selector: sel,
    index,
    tag: el.tagName.toLowerCase(),
    text: (el.innerText || '').trim(),
    title: el.getAttribute('title'),
    ariaLabel: el.getAttribute('aria-label'),
    describedBy: ref('aria-describedby'),
    popover: ref('popovertarget'),
  };
})
"""


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse the CLI arguments, erroring out when no screenshot, measure, or eval work was requested."""
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
    ap.add_argument("--console", action="store_true")
    ap.add_argument("--text", action="append", default=[], metavar="SELECTOR")
    args = ap.parse_args(argv)
    if not (args.out or args.measure or args.eval_js or args.console or args.text):
        ap.error("nothing to do: give an output path, --measure, --eval, --console, or --text")
    return args


def launch(pw: Playwright) -> Browser:
    """Launch chromium, preferring the binary named by ``HQPTUNER_CHROMIUM`` over playwright's default."""
    binary = os.environ.get("HQPTUNER_CHROMIUM")
    if binary:
        return pw.chromium.launch(executable_path=binary)
    return pw.chromium.launch()


def attach_console(page: Page, sink: list[dict[str, Any]]) -> None:
    """Record console errors, uncaught page errors and failed requests into ``sink`` in arrival order."""

    def on_console(msg: ConsoleMessage) -> None:
        if msg.type == "error":
            sink.append({"kind": "console", "text": msg.text, "location": msg.location})

    def on_pageerror(err: Error) -> None:
        sink.append({"kind": "pageerror", "text": err.message})

    def on_requestfailed(req: Request) -> None:
        failure = req.failure
        sink.append({"kind": "requestfailed", "url": req.url, "method": req.method, "failure": failure})

    def on_response(res: Response) -> None:
        if res.status >= HTTP_ERROR_STATUS:
            sink.append({"kind": "httperror", "url": res.url, "method": res.request.method, "status": res.status})

    page.on("console", on_console)
    page.on("pageerror", on_pageerror)
    page.on("requestfailed", on_requestfailed)
    page.on("response", on_response)


def print_text_blocks(blocks: list[dict[str, Any]]) -> None:
    """Print one numbered block per matched element: header, the attributes it carries, then its rendered text."""
    print("---")
    for block in blocks:
        print(f"[{block['index']}] {block['selector']}  <{block['tag']}>")
        print(f"title: {block['title'] or '(none)'}")
        print(f"aria-label: {block['ariaLabel'] or '(none)'}")
        if block["describedBy"]:
            print(f"aria-describedby: {block['describedBy']}")
        print(f"popover: {block['popover'] or '(none)'}")
        print(block["text"])
        print()


def run(page: Page, args: argparse.Namespace) -> None:
    """Load the page, then run the requested eval, measurements, and screenshot, printing results as JSON."""
    console: list[dict[str, Any]] = []
    if args.console:
        attach_console(page, console)
    page.goto(args.url, wait_until="networkidle")
    if args.wait:
        page.wait_for_selector(args.wait)
    page.wait_for_timeout(args.settle)
    results: dict[str, Any] = {}
    if args.console:
        results["console"] = console
    if args.eval_js:
        results["eval"] = page.evaluate(args.eval_js)
    if args.measure:
        results["measure"] = [box for sel in args.measure for box in page.evaluate(MEASURE_JS, [sel, args.style])]
    if args.out:
        page.screenshot(path=args.out, full_page=args.full_page)
        results["screenshot"] = args.out
    blocks = [block for sel in args.text for block in page.evaluate(TEXT_JS, sel)]
    json.dump(results, sys.stdout, indent=2)
    print()
    if args.text:
        print_text_blocks(blocks)


def main(argv: list[str]) -> int:
    """Parse arguments and drive one browser page through the requested run, closing the browser after."""
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
