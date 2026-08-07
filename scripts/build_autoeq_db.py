"""Compile the vendored AutoEq parametric-EQ library blob.

Build-time only — never runs in the app. Pulls jaakkopasanen/AutoEq (MIT) at a
pinned ref via a blob-filtered sparse checkout (ParametricEQ.txt files only,
~35 MB instead of the full multi-GB repo), and compiles every profile into one
gzipped JSON blob served lazily by `GET /api/autoeq`.

Each profile keeps the upstream ParametricEQ.txt content VERBATIM — the client
feeds it through the same `parseEqText` grammar as the paste/upload import
lane, so a library apply is byte-equivalent to pasting the file by construction.

Regeneration (per AutoEq release / whenever upstream results move):

    .venv/bin/python scripts/build_autoeq_db.py            # clone upstream master
    .venv/bin/python scripts/build_autoeq_db.py --ref <tag-or-sha>
    .venv/bin/python scripts/build_autoeq_db.py --src <existing-checkout>

Writes hqptuner/static/vendor/autoeq.json.gz (+ the upstream MIT license next
to it as autoeq-LICENSE.txt) and prints the pinned sha, profile count, and
raw/gzip sizes. Output is deterministic for a given sha (sorted profiles,
zeroed gzip mtime) so a rebuild from the same ref is byte-identical.
"""

from __future__ import annotations

import argparse
import gzip
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

GIT = shutil.which("git") or "git"
REPO_URL = "https://github.com/jaakkopasanen/AutoEq.git"
SUFFIX = " ParametricEQ.txt"
FORMS = ("over-ear", "in-ear", "earbud")
VENDOR = Path(__file__).resolve().parent.parent / "hqptuner" / "static" / "vendor"


def sparse_clone(ref: str, dest: Path) -> None:
    """Clone AutoEq at a ref into dest, checking out only the ParametricEQ.txt files and the LICENSE."""
    cmd = [GIT, "clone", "--filter=blob:none", "--no-checkout", "--depth", "1"]
    if ref != "master":
        cmd += ["--branch", ref]
    subprocess.run([*cmd, REPO_URL, str(dest)], check=True, capture_output=True)
    subprocess.run([GIT, "sparse-checkout", "init", "--no-cone"], cwd=dest, check=True, capture_output=True)
    (dest / ".git" / "info" / "sparse-checkout").write_text("/results/**/*ParametricEQ.txt\n/LICENSE\n")
    subprocess.run([GIT, "read-tree", "-mu", "HEAD"], cwd=dest, check=True, capture_output=True)


def compile_profiles(src: Path) -> list[dict[str, str]]:
    """Return one sorted record per ParametricEQ.txt in a checkout: model, source, form, and verbatim text."""
    profiles = []
    for f in (src / "results").rglob(f"*{SUFFIX}"):
        rel = f.relative_to(src / "results")
        form = next((p.lower() for p in rel.parts if p.lower() in FORMS), "")
        profiles.append(
            {
                "model": f.name[: -len(SUFFIX)],
                "source": rel.parts[0],
                "form": form,
                "text": f.read_text(encoding="utf-8"),
            }
        )
    profiles.sort(key=lambda p: (p["model"].lower(), p["source"].lower()))
    return profiles


def main() -> int:
    """Clone or reuse an AutoEq checkout, compile the profiles, and write the gzipped blob and license."""
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ref", default="master", help="upstream tag/branch to pin (default master)")
    ap.add_argument("--src", type=Path, help="reuse an existing AutoEq checkout instead of cloning")
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        src = args.src
        if src is None:
            src = Path(tmp) / "autoeq"
            src.mkdir()
            print(f"cloning {REPO_URL} @ {args.ref} (sparse, ParametricEQ.txt only)…", flush=True)
            sparse_clone(args.ref, src)
        sha = subprocess.run(
            [GIT, "rev-parse", "HEAD"], cwd=src, check=True, capture_output=True, text=True
        ).stdout.strip()
        profiles = compile_profiles(src)
        if not profiles:
            print("no profiles found — wrong --src / sparse checkout failed", file=sys.stderr)
            return 1
        blob = {
            "meta": {
                "repo": "jaakkopasanen/AutoEq",
                "sha": sha,
                "ref": args.ref,
                "license": "MIT",
                "profiles": len(profiles),
            },
            "profiles": profiles,
        }
        raw = json.dumps(blob, separators=(",", ":"), ensure_ascii=False).encode()
        VENDOR.mkdir(parents=True, exist_ok=True)
        out = VENDOR / "autoeq.json.gz"
        out.write_bytes(gzip.compress(raw, mtime=0))
        license_src = src / "LICENSE"
        if license_src.exists():
            (VENDOR / "autoeq-LICENSE.txt").write_text(license_src.read_text(encoding="utf-8"))
        print(f"sha       {sha}")
        print(f"profiles  {len(profiles)}")
        print(f"raw       {len(raw):,} bytes")
        print(f"gzip      {out.stat().st_size:,} bytes -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
