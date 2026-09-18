"""Stage 1: decode every junkburst capture once into a derived ``.npy`` and ``.json`` pair."""

from __future__ import annotations

import base64
import json
import zlib
from concurrent.futures import ProcessPoolExecutor
from typing import TYPE_CHECKING

import numpy as np
from jbconfig import DER, FLOOR_DB, HEADER, SRC

if TYPE_CHECKING:
    from pathlib import Path


def _first_member(path: Path) -> bytes:
    """Return the decompressed bytes of the file's first gzip member alone.

    A second writer appending its own member leaves a concatenated stream that ``gzip`` would decode as one document
    followed by another; ``wbits=31`` stops at the first member's end, so whatever trails it is ignored.
    """
    dec = zlib.decompressobj(wbits=31)
    out: list[bytes] = []
    with path.open("rb") as fh:
        while not dec.eof:
            chunk = fh.read(1 << 20)
            if not chunk:
                break
            out.append(dec.decompress(chunk))
    return b"".join(out)


def _longest_run(shapes: list[tuple[int, int, float]]) -> tuple[int, int]:
    """Return the start and length of the longest run of one geometry, so a burst carrying a rate change still reads."""
    best_start = best_len = run_start = 0
    for i in range(1, len(shapes) + 1):
        if i == len(shapes) or shapes[i] != shapes[run_start]:
            if i - run_start > best_len:
                best_start, best_len = run_start, i - run_start
            run_start = i
    return best_start, best_len


def unpack_one(path: Path) -> str:
    """Decode one burst into ``derived/<stamp>.npy`` and ``.json``; return a one-line result."""
    stamp = path.name[len("junkburst-") : -len(".json.gz")]
    npy, meta = DER / f"{stamp}.npy", DER / f"{stamp}.json"
    if npy.exists() and meta.exists():
        return f"{stamp} skip"
    doc = json.loads(_first_member(path).decode("utf-8"))
    frames = doc["frames"]
    if not frames:
        return f"{stamp} empty"
    geometry = [HEADER.unpack(base64.b64decode(f["header"]))[1:5] for f in frames]
    shapes = [(int(g[0]), int(g[1]), float(g[3])) for g in geometry]
    best_start, best_len = _longest_run(shapes)
    channels, bins, bandwidth = shapes[best_start]
    kept_frames = frames[best_start : best_start + best_len]
    dropped = len(frames) - best_len
    out = np.empty((best_len, channels, bins), dtype=np.float32)
    for i, frame in enumerate(kept_frames):
        body = np.frombuffer(base64.b64decode(frame["body"]), dtype="<f4")
        stride = 4 + 2 * bins  # 16 bytes of per-channel header, then re[bins] im[bins]
        for ch in range(channels):
            vals = body[ch * stride + 4 : (ch + 1) * stride]
            out[i, ch] = vals[:bins] ** 2 + vals[bins:] ** 2
    db = 10.0 * np.log10(np.maximum(out, 1e-20))
    np.save(npy, np.maximum(db, FLOOR_DB).astype(np.float16))
    meta.write_text(
        json.dumps(
            {
                "stamp": stamp,
                "started": doc.get("started"),
                "samplerate": doc.get("samplerate"),
                "junk_filter": doc.get("junk_filter"),
                "channels": channels,
                "bins": bins,
                "bandwidth": bandwidth,
                "frames": best_len,
                "dropped_frames": dropped,
                "arrived": [float(f["arrived"]) for f in kept_frames],
                "status": doc.get("status", {}),
                "state": doc.get("state", {}),
            }
        ),
        encoding="utf-8",
    )
    return f"{stamp} frames={best_len} dropped={dropped} channels={channels} bins={bins} bandwidth={bandwidth:g}"


def unpack(workers: int) -> None:
    """Unpack every burst that has no derived pair yet."""
    DER.mkdir(parents=True, exist_ok=True)
    paths = sorted(SRC.glob("junkburst-*.json.gz"))
    todo = [
        p for p in paths if not ((DER / f"{p.name[10:-8]}.npy").exists() and (DER / f"{p.name[10:-8]}.json").exists())
    ]
    print(f"bursts={len(paths)} todo={len(todo)} workers={workers}", flush=True)
    done = 0
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for line in pool.map(unpack_one, todo, chunksize=1):
            done += 1
            if done % 25 == 0 or done == len(todo):
                print(f"{done}/{len(todo)} {line}", flush=True)
