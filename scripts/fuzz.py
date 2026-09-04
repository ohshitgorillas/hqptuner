#!/usr/bin/env python3
"""Throw hostile input at every route in the OpenAPI spec and record what came back.

  .venv/bin/python scripts/fuzz.py http://127.0.0.1:8090 OUTDIR [--cap 12] [--dry-run]

The attacks come from ``scripts/fuzzgen.py``, built off ``docs/openapi.json``
before the first request. Records go to ``OUTDIR/attacks.jsonl``, one object per
attack: the request, the status, the body, and one ordinary ``GET /api/health``
after it, which is the instrument that says whether the app survived.

Each attack carries a class, and the class decides how carefully it is sent,
because the caller's bracket (``scripts/abuse.sh``) restores the daemon and
discards the staged buffer but puts nothing back in HQPTuner's own store:

  read    every GET — sent freely.
  stage   the staging routes — sent freely; the bracket discards the buffer.
  apply   reloads or restarts the daemon; ``GET /api/state`` is read first and
          the attack skipped unless ``data.state`` is "0". At most 3.
  live    reaches the daemon at once; captured first, written back after, and
          the write-back confirmed by readback. At most 3.
  store   writes HQPTuner's own store; captured before the run and restored
          after, and name-taking routes get only names this script invented.
  never   backup, restore and autosave are not sent at all.

Rails: at most 8 requests in flight, every loop over a list built before the
first request, a timeout on every one. The daemon's own port is never addressed.
Refuses to run at all unless a bracket is open.
"""

import argparse
import json
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import httpx
from fuzzgen import RACE_CATEGORY, Attack, generate

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "docs" / "openapi.json"
CURRENT = ROOT / "state" / "abuse" / "current"

DEFAULT_CAP = 12
IN_FLIGHT = 8
MAX_APPLIES = 3
MAX_LIVE = 3
TIMEOUT = 10.0
BODY_LIMIT = 2000

HEALTH = "/api/health"
LIVE_PATHS = ["/api/config", "/api/volume"]
STORE_PATHS = ["/api/favorites", "/api/narrowing", "/api/autopilot", "/api/descriptions", "/api/matrixmodes"]
NO_BRACKET = (
    f"{CURRENT.relative_to(ROOT)} is not there: no abuse bracket is open.\n"
    "The caller opens one with `scripts/abuse.sh open` and closes it after."
)


@dataclass
class Outcome:
    """What one attack produced: the response, and the ordinary request sent after it."""

    status: int | None = None
    response: str = ""
    truncated: bool = False
    error: str | None = None
    after: dict[str, Any] = field(default_factory=dict)


def probe(client: httpx.Client) -> dict[str, Any]:
    """Send one ordinary GET after an attack, recording only whether the app answered and is well."""
    try:
        response = client.get(HEALTH)
        body = response.json()
        return {"status": response.status_code, "reachable": body.get("reachable"), "alarm": body.get("alarm")}
    except (httpx.HTTPError, OSError, json.JSONDecodeError) as exc:
        return {"status": None, "error": str(exc)}


def state_of(client: httpx.Client) -> str:
    """Return the daemon's State value, or "?" when it could not be read."""
    try:
        body: dict[str, Any] = client.get("/api/state").json()
        return str(body.get("data", {}).get("state", "?"))
    except (httpx.HTTPError, OSError, json.JSONDecodeError):
        return "?"


def send(client: httpx.Client, attack: Attack) -> Outcome:
    """Send one attack and return its outcome, including the ordinary request that follows it."""
    kwargs: dict[str, Any] = {"params": attack.params, "headers": attack.headers}
    if attack.raw is not None:
        kwargs["content"] = attack.raw
    elif attack.body is not None:
        kwargs["json"] = attack.body
    try:
        response = client.request(attack.method, attack.path, **kwargs)
    except (httpx.HTTPError, OSError) as exc:
        return Outcome(error=str(exc), after=probe(client))
    text = response.text
    truncated = len(text) > BODY_LIMIT
    return Outcome(response.status_code, text[:BODY_LIMIT], truncated=truncated, after=probe(client))


def snapshot(client: httpx.Client, paths: list[str]) -> dict[str, Any]:
    """Read the given routes into one dict, so a write can be compared against what stood before it."""
    out: dict[str, Any] = {}
    for path in paths:
        try:
            out[path] = client.get(path).json()
        except (httpx.HTTPError, OSError, json.JSONDecodeError) as exc:
            out[path] = {"error": str(exc)}
    return out


def form_of(body: dict[str, Any]) -> dict[str, str]:
    """Return the config form as field/value pairs, the shape a live write-back takes."""
    fields = body.get("data", {}).get("fields", [])
    return {str(entry.get("name")): str(entry.get("value")) for entry in fields}


def live_restore(client: httpx.Client, before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    """Write back whatever a live attack moved and confirm the write-back by readback."""
    was, now = form_of(before["/api/config"]), form_of(after["/api/config"])
    changed = {name: value for name, value in was.items() if now.get(name) != value}
    if changed:
        client.post("/api/config/live", json={"fields": changed})
    level = str(before["/api/volume"].get("volume", ""))
    if level and str(after["/api/volume"].get("volume", "")) != level:
        client.post("/api/volume", json={"level": level})
    back = snapshot(client, LIVE_PATHS)
    problems = [
        f"{name} did not read back at {value!r}"
        for name, value in changed.items()
        if form_of(back["/api/config"]).get(name) != value
    ]
    if level and str(back["/api/volume"].get("volume", "")) != level:
        problems.append(f"volume did not read back at {level}")
    return problems


def store_restore(client: httpx.Client, before: dict[str, Any]) -> list[str]:
    """Put the whole-set store surfaces back, and report the ones with no route that can undo a write."""
    client.put("/api/favorites", json=before["/api/favorites"])
    client.put("/api/narrowing", json={"facets": before["/api/narrowing"].get("facets", {})})
    client.post("/api/autopilot", json={"enabled": bool(before["/api/autopilot"].get("enabled"))})
    after = snapshot(client, STORE_PATHS)
    problems = [
        f"{path} did not read back as captured"
        for path in ("/api/favorites", "/api/narrowing", "/api/autopilot")
        if after[path] != before[path]
    ]
    return problems + [
        f"{path} changed and has no route that removes an entry; residue left"
        for path in ("/api/descriptions", "/api/matrixmodes")
        if after[path] != before[path]
    ]


class Run:
    """One fuzzing run: the caps it spends, the records it writes, and the counts it reports."""

    def __init__(self, client: httpx.Client, handle: Any) -> None:
        """Hold the client and the open record file, and start every cap at zero."""
        self.client = client
        self.handle = handle
        self.applies = 0
        self.lives = 0
        self.skips: list[str] = []
        self.problems: list[str] = []
        self.sampled: set[str] = set()
        self.sent = 0

    def record(self, number: int, attack: Attack, outcome: Outcome) -> None:
        """Write one JSON line: the attack as generated, and what it produced."""
        self.handle.write(json.dumps({"n": number, **asdict(attack), **asdict(outcome)}, default=str) + "\n")

    def skip(self, number: int, attack: Attack, why: str) -> None:
        """Record an attack that was not sent, and why, which is a coverage fact rather than a gap."""
        self.skips.append(f"{attack.method} {attack.path}: {why}")
        self.record(number, attack, Outcome(error=f"not sent: {why}"))

    def gated(self, attack: Attack) -> str | None:
        """Return the reason this attack must not be sent, or None when the rails allow it.

        The three applies and the three live writes are spent one per route rather than three deep into the first
        route the spec happens to declare, which would leave the other write paths untouched every run.
        """
        klass = attack.klass
        if klass == "never":
            return "never class"
        if klass in {"apply", "live"} and attack.path in self.sampled:
            return f"{klass} route already sampled"
        if klass == "apply":
            if self.applies >= MAX_APPLIES:
                return f"apply cap of {MAX_APPLIES} spent"
            state = state_of(self.client)
            return None if state == "0" else f"daemon not idle (state={state})"
        if klass == "live" and self.lives >= MAX_LIVE:
            return f"live-write cap of {MAX_LIVE} spent"
        return None

    def one(self, number: int, attack: Attack) -> None:
        """Send one attack under its class's rails, restoring a live write before moving on."""
        why = self.gated(attack)
        if why:
            self.skip(number, attack, why)
            return
        before = snapshot(self.client, LIVE_PATHS) if attack.klass == "live" else {}
        outcome = send(self.client, attack)
        self.sent += 1
        self.sampled.add(attack.path)
        if attack.klass == "apply":
            self.applies += 1
        if attack.klass == "live":
            self.lives += 1
            self.problems += live_restore(self.client, before, snapshot(self.client, LIVE_PATHS))
        self.record(number, attack, outcome)

    def parallel(self, numbered: list[tuple[int, Attack]]) -> None:
        """Send the race attacks together, never more than the in-flight rail, and record them afterwards."""
        allowed: list[tuple[int, Attack]] = []
        for number, attack in numbered:
            why = self.gated(attack)
            if why:
                self.skip(number, attack, why)
            else:
                allowed.append((number, attack))
        with ThreadPoolExecutor(max_workers=IN_FLIGHT) as pool:
            outcomes = list(pool.map(lambda row: send(self.client, row[1]), allowed))
        for (number, attack), outcome in zip(allowed, outcomes, strict=True):
            self.sent += 1
            self.record(number, attack, outcome)


def report(run: Run, attacks: list[Attack], out: Path) -> None:
    """Print the one coverage summary: what was sent, what was spent, what was skipped, where the records are."""
    print(
        f"attacks generated: {len(attacks)}\n"
        f"attacks sent:      {run.sent}\n"
        f"applies:           {run.applies} of {MAX_APPLIES}\n"
        f"live writes:       {run.lives} of {MAX_LIVE}\n"
        f"skipped:           {len(run.skips)}"
    )
    for why in sorted(set(run.skips)):
        print(f"  {why}")
    for problem in run.problems:
        print(f"RESTORE: {problem}")
    print(f"records:           {out}")


def execute(url: str, attacks: list[Attack], out: Path) -> int:
    """Run every attack against the live app, restoring the store around the whole run."""
    with httpx.Client(base_url=url, timeout=TIMEOUT) as client, out.open("w", encoding="utf-8") as handle:
        before = snapshot(client, STORE_PATHS)
        run = Run(client, handle)
        try:
            for number, attack in enumerate(attacks, start=1):
                if attack.category != RACE_CATEGORY:
                    run.one(number, attack)
            run.parallel([(n, a) for n, a in enumerate(attacks, start=1) if a.category == RACE_CATEGORY])
        finally:
            run.problems += store_restore(client, before)
        report(run, attacks, out)
    return 1 if run.problems else 0


def dry(attacks: list[Attack], out: Path) -> int:
    """Write the generated attacks as records without sending any of them."""
    with out.open("w", encoding="utf-8") as handle:
        for number, attack in enumerate(attacks, start=1):
            row = {"n": number, **asdict(attack), **asdict(Outcome(error="dry run"))}
            handle.write(json.dumps(row, default=str) + "\n")
    print(f"attacks generated: {len(attacks)}\nrecords:           {out}")
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    """Parse the CLI arguments for one run."""
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("url")
    ap.add_argument("outdir")
    cap_help = f"attacks per operation (default {DEFAULT_CAP})"
    ap.add_argument("--cap", type=int, default=DEFAULT_CAP, metavar="N", help=cap_help)
    ap.add_argument("--dry-run", action="store_true", help="generate and record the attacks without sending any")
    return ap.parse_args(argv)


def main(argv: list[str]) -> int:
    """Refuse without an open bracket, generate the attacks, then either record them or send them."""
    args = parse_args(argv)
    if not args.dry_run and not CURRENT.is_file():
        print(NO_BRACKET, file=sys.stderr)
        return 1
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    attacks = generate(spec, args.cap, f"fuzz-{uuid.uuid4().hex[:8]}")
    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    out = outdir / "attacks.jsonl"
    return dry(attacks, out) if args.dry_run else execute(args.url, attacks, out)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
