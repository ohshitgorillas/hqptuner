#!/usr/bin/env python3
"""Probe: is hqplayerd's ``iir`` peaking ``q`` the RBJ cookbook Q or the classic EE Q?

``docs/matrix-spec.md`` established that ``q`` occupies the Q slot rather than the
bandwidth or shelf-slope slot (0.019 dB RMS against ``lib/dsp.js`` vs 2.66 / 0.18).
It did NOT discriminate the two *Q conventions*, because the oracle reports only
min/max over the plot grid and an isolated peaking filter's extremes are ``{0, g}``
under either convention — the peak height is the specified gain regardless of Q.

The cookbook states: "Q (the EE kind of definition, except for peakingEQ in which
A*Q is the classic EE Q)", with ``A = 10^(dBgain/40)``. So if the daemon's ``q`` is
the classic EE Q, its internal cookbook Q is ``q/A`` and its alpha is ``A`` times
larger — a materially wider filter at large gain.

Every chain below is chosen so the reported extreme lands on a filter SKIRT, where
alpha is visible, rather than on the peak, where it is not:

  A  peak centred above the grid  — max is the 20 kHz skirt value
  E  peak centred below the grid  — max is the 20 Hz skirt value (rate-insensitive:
                                    at 5-20 Hz the bilinear warping is nil, so the
                                    unknown grid rate cannot muddy this one)
  C  two overlapping peaks        — max is the sum between them, set by their width
  D  single in-band peak          — CONTROL: max must be exactly g under BOTH
                                    hypotheses. If D disagrees, the oracle is not
                                    doing what we think and A/C/E mean nothing.

Read-only. POSTs to ``/matrix/plot`` only, which computes from the submitted form
and never touches stored config (matrix-spec: "Read-only: nine POSTs, each
readback-verified... no reload, engine untouched"). ``GET /matrix`` is captured
before and compared after; the run fails loudly if a single byte moved. Nothing
here POSTs to ``/matrix`` itself, which WOULD write and reload.

    .venv/bin/python scripts/probes/probe_iir_q.py
"""

import asyncio
import math
import os
import re
import sys

import httpx

from hqptuner.conf.httpconf import serialize_matrix_form

HOST = os.environ.get("HQPTUNER_HQP_HOST", "127.0.0.1")
HTTP_PORT = int(os.environ.get("HQPTUNER_HQP_HTTP_PORT", "8088"))
# matrix-spec: joint fit for (rate, grid bounds) lands ~99 kHz / 20 Hz - 20 kHz.
# Both plausible rates are evaluated so a prediction that depends on the guess is
# visible as a spread rather than passed off as a single number.
GRID_LO, GRID_HI = 20.0, 20000.0
RATES = (96000.0, 99000.0)
GRID_POINTS = 4096

CHAINS = {
    "A  peak above grid": "iir:type=peak;f=30000;q=1;g=12",
    "C  two overlapping": "iir:type=peak;f=1000;q=2;g=12,iir:type=peak;f=2000;q=2;g=12",
    "D  control (in-band)": "iir:type=peak;f=1000;q=1;g=12",
    "E  peak below grid": "iir:type=peak;f=5;q=1;g=20",
}
# Which chains actually discriminate. D is a control: identical under both.
DISCRIMINATING = ("A  peak above grid", "C  two overlapping", "E  peak below grid")

_STAGE_RE = re.compile(r"iir:type=(?P<type>\w+);(?P<args>.+)")
_RANGE_RE = re.compile(r"plot magnitude value range:\s*(-?[\d.]+),(-?[\d.]+)")


def _peak_biquad(w0: float, alpha: float, amp: float) -> tuple[float, ...]:
    """RBJ cookbook peakingEQ, normalized to a0 = 1."""
    a0 = 1 + alpha / amp
    return (
        (1 + alpha * amp) / a0,
        (-2 * math.cos(w0)) / a0,
        (1 - alpha * amp) / a0,
        (-2 * math.cos(w0)) / a0,
        (1 - alpha / amp) / a0,
    )


def _mag_db(c: tuple[float, ...], f: float, fs: float) -> float:
    b0, b1, b2, a1, a2 = c
    w = 2 * math.pi * f / fs
    cw, c2w, sw, s2w = math.cos(w), math.cos(2 * w), math.sin(w), math.sin(2 * w)
    num_re, num_im = b0 + b1 * cw + b2 * c2w, -(b1 * sw + b2 * s2w)
    den_re, den_im = 1 + a1 * cw + a2 * c2w, -(a1 * sw + a2 * s2w)
    mag2 = (num_re**2 + num_im**2) / (den_re**2 + den_im**2)
    return 10 * math.log10(mag2)


def _predict(chain: str, fs: float, as_ee_q: bool) -> tuple[float, float]:
    """min/max in dB of a chain over the plot grid, under one Q convention.

    ``as_ee_q`` reads the submitted ``q`` as the classic EE Q, so the cookbook Q
    used to build alpha is ``q/A`` — exactly the cookbook's ``A*Q`` relation
    inverted. ``False`` reads it as the cookbook Q directly.
    """
    stages = []
    for part in chain.split(",iir:"):
        m = _STAGE_RE.match(part if part.startswith("iir:") else "iir:" + part)
        if m is None or m.group("type") != "peak":
            raise SystemExit(f"probe chains are peaking-only, got: {part!r}")
        args = dict(kv.split("=") for kv in m.group("args").split(";"))
        f0, q, g = float(args["f"]), float(args["q"]), float(args["g"])
        amp = 10 ** (g / 40)
        w0 = 2 * math.pi * f0 / fs
        stages.append(_peak_biquad(w0, math.sin(w0) / (2 * (q / amp if as_ee_q else q)), amp))
    lo_log, hi_log = math.log10(GRID_LO), math.log10(GRID_HI)
    values = [
        sum(_mag_db(c, 10 ** (lo_log + (hi_log - lo_log) * i / (GRID_POINTS - 1)), fs) for c in stages)
        for i in range(GRID_POINTS)
    ]
    return min(values), max(values)


def _row_gain_db(fields: dict[str, str]) -> float:
    """Reported quantity is 'row gain (dB) + chain magnitude' (matrix-spec)."""
    raw = float(fields.get("gain_0") or 0.0)
    unit = (fields.get("gainunit_0") or "").strip().lower()
    if unit.startswith("db"):
        return raw
    if raw <= 0:
        raise SystemExit(f"row-0 linear gain {raw} is not positive — cannot take its dB")
    return 20 * math.log10(raw)


def _plot_fields(fields: dict[str, str], chain: str) -> dict[str, str]:
    """The complete form with row 0 carrying the test chain and plotted alone."""
    out = {k: v for k, v in fields.items() if not k.startswith("plot_")}
    out["process_0"] = chain
    out["plot_0"] = "1"
    if out.get("enabled") in ("0", "on", ""):
        out.pop("enabled", None)
    return out


async def _tail_log() -> str:
    """The plot result goes to the systemd journal only.

    The daemon's own ``/log`` page does NOT carry it — that page is the engine
    log, and a plot never reaches it. Measured here 2026-07-28: four plot POSTs
    produced four journal lines and zero ``/log`` lines. ``matrix-spec.md`` says
    "journalctl -u hqplayerd or daemon's own /log"; the second half is wrong.
    """
    proc = await asyncio.create_subprocess_exec(
        "journalctl",
        "-u",
        "hqplayerd",
        "--since",
        "-30 min",
        "-o",
        "cat",
        "--no-pager",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    return out.decode("utf-8", "replace")


async def _measure(client: httpx.AsyncClient, fields: dict[str, str], chain: str) -> tuple[float, float] | None:
    before = len(_RANGE_RE.findall(await _tail_log()))
    # The daemon's /matrix form is enctype="multipart/form-data". A urlencoded
    # body is silently ignored here exactly as a partial POST is (matrix-spec),
    # so this must go out as multipart to be seen at all. (None, value) gives a
    # filename-less part — what a browser sends for a plain text field.
    payload = {k: (None, v) for k, v in _plot_fields(fields, chain).items()}
    r = await client.post("/matrix/plot", files=payload)
    if os.environ.get("PROBE_DEBUG"):
        body = " ".join(r.text.split())[:160]
        print(f"  POST /matrix/plot -> {r.status_code}  fields={len(payload)}  body={body!r}")
    for _ in range(20):
        found = _RANGE_RE.findall(await _tail_log())
        if len(found) > before:
            return float(found[-1][0]), float(found[-1][1])
        await asyncio.sleep(0.5)
    return None


async def main() -> int:
    user = os.environ.get("HQPTUNER_HQP_USERNAME")
    password = os.environ.get("HQPTUNER_HQP_PASSWORD")
    if not user or not password:
        raise SystemExit("set HQPTUNER_HQP_USERNAME / HQPTUNER_HQP_PASSWORD (see hqpcreds)")

    client = httpx.AsyncClient(
        base_url=f"http://{HOST}:{HTTP_PORT}", auth=httpx.DigestAuth(user, password), timeout=60.0
    )
    try:
        pristine = (await client.get("/matrix")).text
        fields, _ = serialize_matrix_form(pristine)
        offset = _row_gain_db(fields)
        print(f"row-0 gain offset: {offset:+.4f} dB  (gain_0={fields.get('gain_0')} {fields.get('gainunit_0')})\n")

        rows = []
        for label, chain in CHAINS.items():
            got = await _measure(client, fields, chain)
            if got is None:
                rows.append((label, chain, None, None, None))
                continue
            measured = (got[0] - offset, got[1] - offset)
            cook = [_predict(chain, fs, as_ee_q=False) for fs in RATES]
            ee = [_predict(chain, fs, as_ee_q=True) for fs in RATES]
            rows.append((label, chain, measured, cook, ee))

        print(f"{'chain':22} {'measured max':>13} {'cookbook Q':>20} {'classic EE Q':>20}")
        print("-" * 78)
        verdict_cook = verdict_ee = 0
        for label, _chain, measured, cook, ee in rows:
            if measured is None:
                print(f"{label:22} {'NO LOG LINE':>13}")
                continue
            cook_r = f"{min(c[1] for c in cook):.2f}..{max(c[1] for c in cook):.2f}"
            ee_r = f"{min(e[1] for e in ee):.2f}..{max(e[1] for e in ee):.2f}"
            print(f"{label:22} {measured[1]:>13.4f} {cook_r:>20} {ee_r:>20}")
            if label in DISCRIMINATING:
                d_cook = min(abs(measured[1] - c[1]) for c in cook)
                d_ee = min(abs(measured[1] - e[1]) for e in ee)
                verdict_cook += d_cook <= d_ee
                verdict_ee += d_ee < d_cook

        print(
            f"\nDiscriminating chains favouring cookbook Q: {verdict_cook}/{len(DISCRIMINATING)}"
            f"   classic EE Q: {verdict_ee}/{len(DISCRIMINATING)}"
        )

        after = (await client.get("/matrix")).text
        print(f"READBACK: /matrix byte-identical after {len(CHAINS)} plot POSTs: {after == pristine}")
        if after != pristine:
            print("  !! form changed — investigate before trusting any number above")
            return 1
    finally:
        await client.aclose()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
