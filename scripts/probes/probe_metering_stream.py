"""Probe hqplayerd's metering side channel (port 4322).

Read-only: connects with no control-channel command, captures a few seconds,
and parses the frame layout (confirmed live 2026-07-28 against hqplayerd on a
44.1k PCM source):

    header, 32 bytes little-endian:
        u32 version (1), u32 channels, u32 xformLength (bins, N/2+1),
        u32 transformBits, f32 bandwidth (Nyquist Hz),
        f32 transformTime (s, = hop/rate), f32 gain, u32 reserved
    per channel:
        f32 peakMax, peak, rms, rmsMax (dBFS)
        2 * xformLength f32 transform values

Frames arrive unconditionally on bare accept, one per transform hop
(~43/s at 44.1k). `analyze` mode tests complex-vs-split interpretations of
the transform block and prints band energies to identify the scale.

Usage:
    probe_metering_stream.py capture [output-path]
    probe_metering_stream.py analyze <capture-path>
"""

import math
import socket
import struct
import sys
import tempfile
import time
from pathlib import Path

HOST = "127.0.0.1"
PORT = 4322
CAP_SECONDS = 3.0
HEADER = struct.Struct("<4I3fI")

BANDS_HZ = (100, 500, 1000, 2000, 5000, 10000, 15000, 18000, 20000, 21000, 22050)


def capture() -> bytes:
    """Return every byte the metering port sends during a fixed capture window on a bare connection."""
    buf = bytearray()
    with socket.create_connection((HOST, PORT), timeout=5) as sock:
        sock.settimeout(1.0)
        deadline = time.monotonic() + CAP_SECONDS
        while time.monotonic() < deadline:
            try:
                chunk = sock.recv(65536)
            except TimeoutError:
                continue
            if not chunk:
                break
            buf += chunk
    return bytes(buf)


def capture_main(argv: list[str]) -> None:
    """Capture the stream to a file, then print the header fields, frame size and observed frame rate."""
    # tempfile.gettempdir() rather than a hardcoded /tmp: the literal trips
    # ruff's S108 and is wrong on any host that puts its scratch elsewhere.
    out = Path(argv[0]) if argv else Path(tempfile.gettempdir()) / "metering-capture.bin"
    start = time.monotonic()
    buf = capture()
    elapsed = time.monotonic() - start
    out.write_bytes(buf)
    print(f"captured {len(buf)} bytes in {elapsed:.2f}s -> {out}")
    if not buf:
        print("no data on bare accept — stream is not unconditional")
        return
    version, channels, bins, bits, bandwidth, xform_time, gain, _ = HEADER.unpack_from(buf, 0)
    frame = 32 + channels * (16 + 8 * bins)
    print(
        f"version={version} channels={channels} bins={bins} bits={bits} "
        f"bandwidth={bandwidth} xformTime={xform_time:.6g} gain={gain}"
    )
    print(f"frame={frame}B, {len(buf) / frame:.1f} frames, {len(buf) / frame / elapsed:.1f}/s")


def db(power: float) -> float:
    """Return a power value in decibels, floored at -200 for zero and negative input."""
    return 10 * math.log10(power) if power > 0 else -200.0


def band_profile(mags_sq: list[float], bandwidth: float) -> str:
    """Return a one-line summary of the mean power in dB of each BANDS_HZ band of the given bin magnitudes."""
    out = []
    lo = 0.0
    for hi in BANDS_HZ:
        if lo >= bandwidth:
            break
        sel = [m for k, m in enumerate(mags_sq) if lo <= k * bandwidth / (len(mags_sq) - 1) < hi]
        if sel:
            out.append(f"{lo / 1000:g}-{hi / 1000:g}k: {db(sum(sel) / len(sel)):6.1f}")
        lo = hi
    return "  ".join(out)


def analyze_main(argv: list[str]) -> None:
    """Read a capture file and print band energies under both the interleaved-complex and split-halves readings."""
    buf = Path(argv[0]).read_bytes()
    version, channels, bins, _, bandwidth, _, _, _ = HEADER.unpack_from(buf, 0)
    frame = 32 + channels * (16 + 8 * bins)
    n_frames = len(buf) // frame
    headers_ok = all(buf[i * frame : i * frame + 4] == buf[:4] for i in range(n_frames))
    print(f"{n_frames} frames of {frame}B, version={version}, headers aligned: {headers_ok}")

    interleaved = [0.0] * bins
    split = [0.0] * bins
    as_db_halves: list[float] = []
    for i in range(n_frames):
        base = i * frame + 32 + 16  # frame i, channel 0, past level block
        vals = struct.unpack_from(f"<{2 * bins}f", buf, base)
        for k in range(bins):
            interleaved[k] += vals[2 * k] ** 2 + vals[2 * k + 1] ** 2
            split[k] += vals[k] ** 2 + vals[bins + k] ** 2
        as_db_halves.extend((min(vals[:bins]), max(vals[:bins])))

    print("interpretation A — interleaved complex (re,im pairs), mean band power dB:")
    print(" ", band_profile([v / n_frames for v in interleaved], bandwidth))
    print("interpretation B — split halves (reals then imags), mean band power dB:")
    print(" ", band_profile([v / n_frames for v in split], bandwidth))
    print("raw first-half value range across frames: " f"min={min(as_db_halves):.4g} max={max(as_db_halves):.4g}")


def main() -> None:
    """Dispatch to the analyze subcommand, otherwise capture."""
    if sys.argv[1:2] == ["analyze"]:
        analyze_main(sys.argv[2:])
    else:
        capture_main(sys.argv[2:] if sys.argv[1:2] == ["capture"] else sys.argv[1:])


if __name__ == "__main__":
    main()
