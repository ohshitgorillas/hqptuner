#!/usr/bin/env python3
"""Sweep every tab, accent, hero MODE position and viewport, capturing a screenshot and a measurement JSON each.

The standard visual sweep as one command, so a review does not hand-write a
state machine and a measurement blob every run.

  set -a; source hqpcreds; set +a
  .venv/bin/python scripts/sweep.py http://127.0.0.1:8090 OUTDIR [--viewport WxH]...

Tabs come from the DOM (``.tab-nav button``), accents from ``/store/theme.js``
and hero MODE positions from the ``output_mode`` segment, so a dimension that
grows in the app grows here without an edit. ``--viewport`` is repeatable and
defaults to 1280x900. ``--tab`` is repeatable and keeps only the named tabs,
by id or label; without it every tab is swept. A fragment on the URL stays
on it through the whole sweep: the page opens on it and every tab click keeps
it, so a view the app shows only under a hash is swept by passing that hash
here, on the tab whose body it replaces.

Each state writes ``OUTDIR/<tab>-<accent>-<mode>-<WxH>.png`` and a ``.json``
holding the state, the seven instruments (fonts by text role, alignment edges
and gaps, control kinds, plots with their derived findings, hit-target boxes,
overflow and intersecting rects) and the console errors and failed requests
seen since the previous state. The plot findings are numbers a review quotes:
``few-points``, ``long-segment``, ``hash``, ``aliased``, ``hairline``,
``collision``, ``escape``, ``blurry`` (``scripts/sweepplots.py``).

After the static states, every viewport gets a plot pass in a second browser
context at device scale factor 3: one crop per SVG or canvas per tab
(``OUTDIR/<tab>-<n>-crop.png``), every visible enabled range slider on the
tab stepped across its whole range by keyboard, about twenty frames, each with
a crop per plot in the slider's card, its plot findings and the adjacent-frame
deltas (``jump`` among them) in ``OUTDIR/<tab>-slider<n>-frames.json``, and
then every combination of the tab's sliders at minimum and maximum, one frame
each with a crop per plot, in ``OUTDIR/<tab>-corners.json``
(``scripts/sweepslide.py``). Each slider is restored to its starting value and
the readback printed; a slider keys do not move is printed as uncovered.

The MODE dimension stages one field through the app's own UI, and the slider
pass stages through the sliders that stage. The staged buffer is read before
anything is touched: when it is not empty the MODE dimension and the slider
pass are dropped and nothing is staged, and MODE is clicked back to its
starting position at the end either way. Nothing is applied, the LIVE toggle is
never touched, and no port but the URL's is contacted. The buffer is read back
and printed last; outside an ``abuse.sh`` bracket, a non-empty readback is put
back by the app's own Discard.

Browser binary from ``HQPTUNER_CHROMIUM`` when set, as scripts/snap.py.
"""

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from playwright.sync_api import Browser, Page, Playwright, sync_playwright
from sweepplots import PLOTS_JS, derive_plots
from sweepslide import SETTLE_MS, PlotPass, attach_console, slider_pass

DEFAULT_VIEWPORT = "1280x900"
MODE_SEL = '[data-k="output_mode"] .segment button'

TABS_JS = """
() => Array.from(document.querySelectorAll('.tab-nav button')).map(b => ({
  id: (b.dataset.testid || '').replace(/^tab-/, '') || b.textContent.trim().toLowerCase(),
  label: b.textContent.trim(),
}))
"""

ACCENTS_JS = "async () => (await import('/store/theme.js')).ACCENTS"

APPLY_ACCENT_JS = """
async (name) => {
  const theme = await import('/store/theme.js');
  theme.applyAccent(name);
}
"""

MODES_JS = """
(sel) => Array.from(document.querySelectorAll(sel)).map(b => ({
  value: b.dataset.v,
  active: b.classList.contains('active'),
  disabled: b.disabled,
}))
"""

PENDING_JS = """
async () => {
  const res = await fetch('/api/config/pending');
  return await res.json();
}
"""

INSTRUMENTS_JS = (
    """
(plotsFn) => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return {x: r.x, y: r.y, width: r.width, height: r.height,
            left: r.left, right: r.right, top: r.top, bottom: r.bottom};
  };
  const cs = (el) => getComputedStyle(el);
  const all = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const tag = (el) => {
    const cls = typeof el.className === 'string' ? el.className.trim() : '';
    return el.tagName.toLowerCase() + (cls ? '.' + cls.split(/\\s+/).join('.') : '');
  };
  const EPS = 1;

  const fonts = {};
  for (const role of ['t-head', 't-eyebrow', 't-label', 't-caption', 't-micro', 't-value']) {
    fonts[role] = all('.' + role).map(el => {
      const s = cs(el);
      return {tag: el.tagName.toLowerCase(), text: (el.textContent || '').trim().slice(0, 40),
              fontSize: s.fontSize, fontWeight: s.fontWeight, fontFamily: s.fontFamily, lineHeight: s.lineHeight};
    });
  }

  const alignment = {rows: [], fields: []};
  for (const container of all('.top-row').concat(all('[data-card]'))) {
    const kids = Array.from(container.children).map(k => ({selector: tag(k), ...box(k)}));
    const gaps = kids.slice(1).map((k, i) => Number((k.top - kids[i].bottom).toFixed(2)));
    alignment.rows.push({container: tag(container), box: box(container), children: kids, gaps});
  }
  for (const f of all('.field')) {
    const label = f.querySelector('label, .t-label, .t-eyebrow');
    const ctrl = f.querySelector('button, select, input, textarea, .segment');
    if (label && ctrl) alignment.fields.push({field: f.dataset.k || tag(f), label: box(label), control: box(ctrl)});
  }

  const controls = [];
  for (const kind of ['button', 'select', 'input', 'textarea', '.segment button', '.field']) {
    for (const el of all(kind)) {
      const s = cs(el);
      controls.push({kind, selector: tag(el), ...box(el), padding: s.padding, borderRadius: s.borderRadius,
                     border: s.border, backgroundColor: s.backgroundColor});
    }
  }

  const plots = ("""
    + PLOTS_JS
    + """)();

  // A control the layout never painted (a collapsed dropdown's rows, an inactive
  // tab's body) has a zero box, and a zero box is under every threshold there is.
  // Those are marked not visible and flagged for nothing: 284 of them buried the
  // seven real ones on the Output tab.
  const hitTargets = all('a, button, select, input, textarea, [role="button"], [tabindex]').map(el => {
    const b = box(el);
    const visible = b.width > 0 && b.height > 0;
    return {selector: tag(el), ...b, visible,
            under24: visible && (b.width < 24 || b.height < 24),
            under32: visible && (b.width < 32 || b.height < 32)};
  });

  const de = document.documentElement;
  const overflow = {document: {scrollWidth: de.scrollWidth, clientWidth: de.clientWidth},
                    cards: [], escapes: [], intersections: []};
  for (const card of all('[data-card]')) {
    const name = card.dataset.card;
    const cb = box(card);
    overflow.cards.push({card: name, scrollWidth: card.scrollWidth, clientWidth: card.clientWidth});
    for (const el of all('*', card)) {
      const b = box(el);
      if (b.width && b.height && (b.left < cb.left - EPS || b.right > cb.right + EPS)) {
        overflow.escapes.push({card: name, selector: tag(el), box: b, cardBox: cb});
      }
    }
    const kids = Array.from(card.children).map(k => ({selector: tag(k), box: box(k)}));
    kids.forEach((a, i) => kids.slice(i + 1).forEach(b => {
      const overX = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) > EPS;
      const overY = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top) > EPS;
      if (overX && overY) overflow.intersections.push({card: name, a, b});
    }));
  }

  return {fonts, alignment, controls, plots, hitTargets, overflow};
}
"""
)


@dataclass
class Run:
    """One sweep in progress: the page it drives, where it writes, and which state it is standing in."""

    page: Page
    outdir: Path
    tabs: list[dict[str, str]]
    console: list[dict[str, Any]] = field(default_factory=list)
    viewport: str = DEFAULT_VIEWPORT
    accent: str = ""
    mode: str = "asis"


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse the CLI arguments, defaulting the viewport list when none was given."""
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url")
    ap.add_argument("outdir", type=Path)
    ap.add_argument("--viewport", action="append", default=[], metavar="WxH")
    ap.add_argument("--tab", action="append", default=[], metavar="NAME", help="sweep only this tab (id or label)")
    args = ap.parse_args(argv)
    if not args.viewport:
        args.viewport = [DEFAULT_VIEWPORT]
    return args


def parse_viewport(value: str) -> tuple[int, int]:
    """Split a ``WxH`` viewport string into its two integers."""
    match = re.fullmatch(r"(\d+)x(\d+)", value.strip().lower())
    if not match:
        raise SystemExit(f"bad --viewport {value!r}: expected WxH, e.g. 1280x900")
    return int(match.group(1)), int(match.group(2))


def launch(pw: Playwright) -> Browser:
    """Launch chromium, preferring the binary named by ``HQPTUNER_CHROMIUM`` over playwright's default."""
    binary = os.environ.get("HQPTUNER_CHROMIUM")
    if binary:
        return pw.chromium.launch(executable_path=binary)
    return pw.chromium.launch()


def keep_tabs(tabs: list[dict[str, Any]], wanted: list[str]) -> list[dict[str, Any]]:
    """Keep the tabs named by ``--tab``, by id or label, case-insensitively; no names keeps all."""
    if not wanted:
        return tabs
    names = {w.strip().lower() for w in wanted}
    kept = [t for t in tabs if t["id"].lower() in names or t["label"].lower() in names]
    if not kept:
        raise SystemExit(f"--tab matched nothing among {[t['id'] for t in tabs]}")
    return kept


def slug(value: str) -> str:
    """Collapse a control value into a filename-safe token."""
    return re.sub(r"[^A-Za-z0-9]+", "-", value).strip("-").lower() or "none"


def select_tab(page: Page, tab_id: str) -> None:
    """Click a tab by its id and let its body paint."""
    page.click(f'.tab-nav button[data-testid="tab-{tab_id}"]')
    page.wait_for_timeout(SETTLE_MS)


def mode_options(page: Page) -> list[dict[str, Any]]:
    """Read the hero MODE segment's options, with which one is active and which are refused."""
    select_tab(page, "output")
    options: list[dict[str, Any]] = page.evaluate(MODES_JS, MODE_SEL)
    return options


def select_mode(page: Page, value: str) -> None:
    """Stage a hero MODE position by clicking its segment button, as a user would."""
    select_tab(page, "output")
    page.click(f'{MODE_SEL}[data-v="{value}"]')
    page.wait_for_timeout(SETTLE_MS)


def read_pending(page: Page) -> dict[str, Any]:
    """Read the staged-changes buffer through the page's own origin."""
    pending: dict[str, Any] = page.evaluate(PENDING_JS)
    return pending


def capture(run: Run, tab: dict[str, str]) -> None:
    """Capture one state: screenshot, instruments, the console since the last state, and a progress line."""
    page = run.page
    page.wait_for_timeout(SETTLE_MS)
    data: dict[str, Any] = page.evaluate(INSTRUMENTS_JS)
    data["plots"]["findings"] = derive_plots(data["plots"])
    data["state"] = {
        "url": page.url,
        "tab": tab["id"],
        "accent": run.accent,
        "mode": run.mode,
        "viewport": run.viewport,
    }
    data["console"] = list(run.console)
    run.console.clear()
    name = f"{tab['id']}-{run.accent}-{run.mode}-{run.viewport}"
    page.screenshot(path=str(run.outdir / f"{name}.png"))
    (run.outdir / f"{name}.json").write_text(json.dumps(data))
    fonts = sum(len(v) for v in data["fonts"].values())
    hits = [h for h in data["hitTargets"] if h["visible"]]
    small = [h for h in hits if h["under24"]]
    print(
        f"{name}  fonts={fonts} controls={len(data['controls'])} "
        f"hits={len(hits)} small={len(small)} plots={len(data['plots']['findings'])} console={len(data['console'])}"
    )


def sweep_accent(run: Run, accent: str) -> None:
    """Apply one accent and capture every tab under it."""
    run.accent = accent
    run.page.evaluate(APPLY_ACCENT_JS, accent)
    for tab in run.tabs:
        select_tab(run.page, tab["id"])
        capture(run, tab)


def sweep_mode(run: Run, accents: list[str], mode: dict[str, Any] | None) -> None:
    """Stage one hero MODE position, when there is one to stage, and capture every accent under it."""
    if mode is not None:
        select_mode(run.page, mode["value"])
        run.mode = slug(mode["value"])
    for accent in accents:
        sweep_accent(run, accent)


def sweep_viewport(run: Run, accents: list[str], modes: list[dict[str, Any] | None], viewport: str) -> None:
    """Resize to one viewport and capture every mode under it."""
    width, height = parse_viewport(viewport)
    run.viewport = viewport
    run.page.set_viewport_size({"width": width, "height": height})
    for mode in modes:
        sweep_mode(run, accents, mode)


def plan_modes(page: Page, *, dirty: bool) -> tuple[list[dict[str, Any] | None], str]:
    """Decide the MODE dimension: every clickable position, or none at all when the staged buffer is dirty."""
    if dirty:
        print("staged buffer is not empty: MODE dimension skipped, nothing staged")
        return [None], ""
    options = mode_options(page)
    start = next((o["value"] for o in options if o["active"]), "")
    modes: list[dict[str, Any] | None] = [o for o in options if not o["disabled"]]
    refused = [o["value"] for o in options if o["disabled"]]
    if refused:
        print(f"MODE positions refused by the app, not swept: {', '.join(refused)}")
    return modes, start


def sweep(browser: Browser, args: argparse.Namespace) -> None:
    """Open the app once, sweep every state, run the plot pass, put the hero MODE back, and print the staged buffer."""
    width, height = parse_viewport(args.viewport[0])
    page = browser.new_page(viewport={"width": width, "height": height})
    run = Run(page=page, outdir=args.outdir, tabs=[])
    attach_console(page, run.console)
    page.goto(args.url, wait_until="networkidle")
    page.wait_for_selector(".tab-nav button")
    page.wait_for_timeout(SETTLE_MS)
    run.tabs = keep_tabs(page.evaluate(TABS_JS), args.tab)
    accents: list[str] = page.evaluate(ACCENTS_JS)
    pending = read_pending(page)
    dirty = any(pending.values())
    modes, start = plan_modes(page, dirty=dirty)
    for viewport in args.viewport:
        sweep_viewport(run, accents, modes, viewport)
    if start:
        select_mode(page, start)
    plan = PlotPass(url=args.url, tabs=run.tabs, outdir=args.outdir, dirty=dirty)
    for viewport in args.viewport:
        print(f"plot pass at {viewport}, device scale factor 3:")
        slider_pass(browser, plan, parse_viewport(viewport))
    print("pending after sweep:", json.dumps(read_pending(page)))


def main(argv: list[str]) -> int:
    """Parse arguments, run one sweep in one browser session, and close the browser after."""
    args = parse_args(argv)
    args.outdir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = launch(pw)
        try:
            sweep(browser, args)
        finally:
            browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
