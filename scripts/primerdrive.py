#!/usr/bin/env python3
"""Drive the filter primer graph through a list of states and capture each one.

The visual and numerical hand-back harness for the primer graph
(components/primer/Graph.js, store/primergraph.js). One browser session, one
page, many states, so one run covers a whole sweep.

  set -a; source hqpcreds; set +a
  .venv/bin/python scripts/primerdrive.py STATES.json OUTDIR [--width N]

STATES.json is a list of objects. Every key is optional; a missing key keeps
the previous state, and the first state starts from the app's opening state::

  {"name": "slug", "rate": 44100, "outputRate": 176400,
   "phase": "linear", "lengthMs": 2, "rolloff": 0.5, "transientUs": 100,
   "content": {"spurs": false, "fakeHires": false, "risingNoise": false}}

``outputRate`` null means no oversampling. For each state the script writes
``OUTDIR/<name>.png`` (the whole graph block: all three panes, controls, readouts)
and ``OUTDIR/<name>.json`` holding the store's state, design (taps, cutoff,
width, the tap values), pulse, readouts text, axis top, spectrum arrays on the
store's grid, the delay arrays (NaN blanked, as null), and every pane's drawn
polylines, paths and text labels in the SVG viewBox. Browser binary from
``HQPTUNER_CHROMIUM`` when set, as scripts/snap.py.
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from playwright.sync_api import Browser, Playwright, sync_playwright

URL = "http://127.0.0.1:8090/#primer"
# Tall viewport: the graph block must fit without scrolling, or the app's
# sticky tab bar and fixed pending bar paint across the element capture.
HEIGHT = 1800

SET_STATE = """
async (s) => {
  const st = await import('/store/primergraph.js');
  if ('rate' in s) st.rate.value = s.rate;
  if ('outputRate' in s) st.outputRate.value = s.outputRate;
  if ('phase' in s) st.phase.value = s.phase;
  if ('lengthMs' in s) st.lengthMs.value = s.lengthMs;
  if ('rolloff' in s) st.rolloff.value = s.rolloff;
  if ('transientUs' in s) st.transientUs.value = s.transientUs;
  if ('content' in s) st.content.value = { ...st.content.value, ...s.content };
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const d = st.design.value;
  const sp = st.spectrum.value;
  const pane = (name) => {
    const svg = document.querySelector(`[data-pane="${name}"] svg`);
    const out = {};
    const key = (tag, el, i) => `${tag}${i}:${el.getAttribute('class')}`;
    svg.querySelectorAll('polyline').forEach((el, i) => { out[key('polyline', el, i)] = el.getAttribute('points'); });
    svg.querySelectorAll('path').forEach((el, i) => { out[key('path', el, i)] = el.getAttribute('d'); });
    out.texts = Array.from(svg.querySelectorAll('text')).map(t => t.textContent);
    return out;
  };
  const readouts = {};
  const dl = document.querySelector('.primer-readouts');
  if (dl) {
    const dts = dl.querySelectorAll('dt'); const dds = dl.querySelectorAll('dd');
    dts.forEach((dt, i) => { readouts[dt.textContent.trim()] = dds[i] ? dds[i].textContent.trim() : null; });
  }
  return {
    state: { rate: st.rate.value, outputRate: st.outputRate.value, phase: st.phase.value, lengthMs: st.lengthMs.value,
             rolloff: st.rolloff.value, transientUs: st.transientUs.value, content: st.content.value },
    design: { designRate: d.designRate, taps: d.taps, cutoffHz: d.cutoffHz, widthHz: d.widthHz, h: Array.from(d.h) },
    pulse: Array.from(st.pulse.value),
    readouts,
    axisHz: st.axisHz.value,
    spectrum: {
      freqsHz: sp.freqsHz,
      sourceDb: Array.from(sp.sourceDb),
      filterDb: Array.from(sp.filterDb),
      resultDb: Array.from(sp.resultDb),
      heardDb: Array.from(sp.heardDb),
    },
    delay: {
      freqsHz: st.delay.value.freqsHz,
      linearMs: Array.from(st.delay.value.linearMs),
      minimumMs: Array.from(st.delay.value.minimumMs),
    },
    impulse: pane('impulse'),
    delayPane: pane('delay'),
    frequency: pane('frequency'),
  };
}
"""


def launch(pw: Playwright) -> Browser:
    """Launch chromium, preferring the binary named by ``HQPTUNER_CHROMIUM`` over playwright's default."""
    binary = os.environ.get("HQPTUNER_CHROMIUM")
    if binary:
        return pw.chromium.launch(executable_path=binary)
    return pw.chromium.launch()


def capture(browser: Browser, states: list[dict[str, Any]], outdir: Path, width: int) -> None:
    """Open the primer once, then set each state, capture the graph block, and dump its numbers."""
    page = browser.new_page(viewport={"width": width, "height": HEIGHT})
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector('[data-pane="impulse"]')
    page.wait_for_timeout(300)
    for i, state in enumerate(states):
        name = state.get("name") or f"state{i:02d}"
        data = page.evaluate(SET_STATE, state)
        page.wait_for_timeout(100)
        page.locator(".primer-graph").screenshot(path=str(outdir / f"{name}.png"))
        (outdir / f"{name}.json").write_text(json.dumps(data))
        print(name, json.dumps(data["readouts"]), "taps", data["design"]["taps"])


def main(argv: list[str]) -> int:
    """Read the states file, run the capture, and close the browser after."""
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("states", type=Path)
    ap.add_argument("outdir", type=Path)
    ap.add_argument("--width", type=int, default=1280)
    args = ap.parse_args(argv)
    states = json.loads(args.states.read_text())
    outdir: Path = args.outdir
    width: int = args.width
    outdir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = launch(pw)
        try:
            capture(browser, states, outdir, width)
        finally:
            browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
