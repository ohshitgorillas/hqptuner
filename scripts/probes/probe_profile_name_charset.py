#!/usr/bin/env python3
"""Probe which characters survive a round trip through an hqplayerd profile name.

Idle-gate, record, act, restore, verify-restore-by-readback (the shape of
capture_pcm_enums.py). For each candidate name the only write is
``POST /config/profile/save``, which snapshots current settings into
``data/cfgs/<name>.xml`` and nothing else; cleanup is
``POST /config/profile/delete`` in a per-name ``finally``, verified gone from
both ``ConfigurationList`` and ``/backup/settings.zip``. A name that cannot be
deleted stops the loop. No ``/restore``, no named ``profile/load`` — both have
side effects on the daemon.
"""

import asyncio
import io
import sys
import unicodedata
import zipfile
from dataclasses import dataclass, field

from hqptuner.conf.httpconf import HttpConfigClient
from hqptuner.config import Config
from hqptuner.engine.control import ControlClient

CFG_PREFIX = "data/cfgs/"
_NAME_COL = 42  # printed name column; anything longer is elided to fit the summary table
NAMES = [
    "ZZprobe — Ori 3.0",
    "ZZprobe café Ünïcode",
    "ZZprobe 日本語 test",
    "ZZprobe \U0001f3a7 emoji",
    "ZZprobe A & B",
    "ZZprobe <tag> \"quoted\" 'apos'",
    "ZZprobe 100% + a?b#c=d",
    "ZZprobe: star*pipe|",
    "ZZprobe é combining",
    "ZZprobe " + "ä" * ((300 - len("ZZprobe ")) // 2),
]


async def _raw_control(cfg: Config, doc: bytes) -> bytes:
    """One-shot raw Control API exchange on a fresh connection.

    The fresh connection is what keeps a document the daemon mangles from
    desyncing a long-lived reader.
    """
    reader, writer = await asyncio.open_connection(cfg.hqp_host, cfg.hqp_control_port)
    writer.write(doc)
    await writer.drain()
    chunks = []
    while True:
        try:
            chunk = await asyncio.wait_for(reader.read(65536), 1.0)
        except TimeoutError:
            break
        if not chunk:
            break
        chunks.append(chunk)
        if b"</ConfigurationList>" in b"".join(chunks):
            break
    writer.close()
    return b"".join(chunks)


@dataclass
class ConfigListing:
    """One ``ConfigurationList`` read: the active profile, its names, the raw reply, and any parse error."""

    active: str
    names: list[str]
    raw: bytes
    error: str | None = None


async def _config_list(cfg: Config) -> ConfigListing:
    """Read ``ConfigurationList`` via a fresh ``ControlClient``."""
    raw = await _raw_control(cfg, b"<ConfigurationList/>")
    client = ControlClient(host=cfg.hqp_host, port=cfg.hqp_control_port)
    await client.connect()
    active = ""
    names: list[str] = []
    errors: list[str] = []
    try:
        root = await client.request("<ConfigurationList/>")
        active = root.attrib.get("active", "")
        names = [i.attrib.get("name", "") for i in root]
    # A profile name the daemon emits unescaped can break the reply in any number of ways; whatever the parse throws
    # is the observation, recorded alongside the raw bytes rather than raised.
    except Exception as exc:  # noqa: BLE001
        errors.append(f"{type(exc).__name__}: {exc}")
    finally:
        await client.close()
    return ConfigListing(active, names, raw, errors[0] if errors else None)


def _members(blob: bytes) -> list[zipfile.ZipInfo]:
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        return [i for i in zf.infolist() if i.filename.startswith(CFG_PREFIX)]


def _raw_name_bytes(info: zipfile.ZipInfo) -> bytes:
    enc = "utf-8" if info.flag_bits & 0x800 else "cp437"
    return info.orig_filename.encode(enc)


def _describe(name: str, got: str) -> str:
    if got == name:
        return "byte-identical"
    for form in ("NFC", "NFD", "NFKC", "NFKD"):
        if got == unicodedata.normalize(form, name):
            return f"normalized to {form}"
    return "MANGLED"


@dataclass
class ProbeResult:
    """One candidate name's round trip: verdict, zip encoding note, deletion verdict, any exception, and its log."""

    verdict: str = "n/a"
    zipnote: str = "n/a"
    deleted: str = "not created"
    error: str | None = None
    log: list[str] = field(default_factory=list)


async def _probe_one(cfg: Config, http: HttpConfigClient, name: str, base_zip: set[str]) -> ProbeResult:
    """Return one candidate name's round trip, its zip note, deletion verdict and diagnostic log; prints nothing."""
    log = [f"\n{'=' * 72}\nNAME {name!r}\n  utf-8 bytes ({len(name.encode())}): {name.encode()!r}"]
    verdict = zipnote = "n/a"
    error = None
    saved = False
    save_errors: list[str] = []
    try:
        await http.post_profile("save", profile_name=name)
        saved = True
        log.append("  POST /config/profile/save -> HTTP 2xx")
    # Rejecting a candidate name is a legitimate result for this probe, and the daemon may signal it as an HTTP error,
    # a transport failure or a mangled reply — all of them recorded as "save rejected" rather than aborting the sweep.
    except Exception as exc:  # noqa: BLE001
        log.append(f"  POST /config/profile/save FAILED: {type(exc).__name__}: {exc}")
        save_errors.append(f"{type(exc).__name__}: {exc}")
    if save_errors:
        verdict = "save rejected"
        error = save_errors[0]

    if saved:
        listing = await _config_list(cfg)
        new = [n for n in listing.names if n.startswith("ZZprobe")]
        log.append(f"  ConfigurationList parse: {listing.error or 'ok'}")
        log.append(f"    active={listing.active!r} ZZprobe entries={new!r}")
        if new:
            log.append(f"    returned bytes: {new[0].encode()!r}")
        log.append(f"    RAW document: {listing.raw!r}")
        verdict = _describe(name, new[0]) if new else ("XML PARSE FAILURE" if listing.error else "ABSENT from list")
        error = listing.error

        blob = await http.backup()
        cands = [i for i in _members(blob) if i.filename not in base_zip]
        log.append(f"  settings.zip new members: {[i.filename for i in cands]!r}")
        for info in cands:
            log.append(f"    member repr : {info.filename!r}")
            log.append(f"    raw bytes   : {_raw_name_bytes(info)!r}")
            log.append(f"    flag_bits   : 0x{info.flag_bits:04x} (UTF-8 0x800 = {bool(info.flag_bits & 0x800)})")
            with zipfile.ZipFile(io.BytesIO(blob)) as zf:
                data = zf.read(info)
            log.append(f"    size        : {len(data)} bytes")
            first = data.split(b"\n", 1)[0][:120].decode("utf-8", "replace")
            log.append(f"    first line  : {first}")
        if cands:
            want = f"{CFG_PREFIX}{name}.xml"
            zipnote = ("utf8-flag" if cands[0].flag_bits & 0x800 else "cp437") + (
                "" if cands[0].filename == want else " NAME-DIFFERS"
            )
        else:
            zipnote = "no member"

    # cleanup + readback proof
    deleted = "not created"
    if saved:
        try:
            await http.post_profile("delete", profile=name)
            log.append("  POST /config/profile/delete -> HTTP 2xx")
        # Cleanup delete; whether the profile actually went away is adjudicated below by readback of ConfigurationList
        # and settings.zip, which sets deleted = "NO" on any stray — not by this handler, so the error is only logged.
        except Exception as exc:  # noqa: BLE001
            log.append(f"  DELETE POST FAILED: {type(exc).__name__}: {exc}")
        readback = await _config_list(cfg)
        zip2 = {i.filename for i in _members(await http.backup())}
        stray_list = [n for n in readback.names if n.startswith("ZZprobe")]
        stray_zip = sorted(zip2 - base_zip)
        log.append(f"  readback ConfigurationList ({readback.error or 'ok'}): ZZprobe entries={stray_list!r}")
        log.append(f"  readback settings.zip new members: {stray_zip!r}")
        if stray_list or stray_zip:
            log.append(f"  *** CLEANUP FAILED *** stray list={stray_list!r} stray zip={stray_zip!r}")
            log.append(f"  *** RAW list document: {readback.raw!r}")
            deleted = "NO"
        else:
            deleted = "yes"
    return ProbeResult(verdict, zipnote, deleted, error, log)


async def main() -> int:
    """Establish which characters survive a round trip through a profile name, deleting each test profile after."""
    cfg = Config()
    control = ControlClient(host=cfg.hqp_host, port=cfg.hqp_control_port)
    await control.connect()
    state = await control.get_state()
    if state.get("state") != "0":
        print(f"engine not idle (state={state.get('state')}) — aborting, nothing changed")
        await control.close()
        return 1

    http = HttpConfigClient(cfg.hqp_host, cfg.hqp_http_port, cfg.hqp_username, cfg.hqp_password)
    rows: list[tuple[str, str, str, str]] = []
    rc = 0
    try:
        before_active = await control.get_active_config()
        baseline = await _config_list(cfg)
        base_zip = {i.filename for i in _members(await http.backup())}
        print(f"BASELINE ConfigurationGet active={before_active!r}")
        print(f"BASELINE ConfigurationList names={baseline.names!r}")
        print(f"BASELINE settings.zip data/cfgs members={sorted(base_zip)!r}")

        wanted = [NAMES[int(a) - 1] for a in sys.argv[1:]] or NAMES
        for name in wanted:
            try:
                result = await _probe_one(cfg, http, name, base_zip)
            # Outermost per-name guard: any unexpected failure inside a single candidate is recorded as its row with
            # deleted="UNKNOWN", which stops the loop below so the summary table still prints from the finally block.
            except Exception as exc:  # noqa: BLE001
                result = ProbeResult(
                    f"ERROR {type(exc).__name__}",
                    "n/a",
                    "UNKNOWN",
                    f"{type(exc).__name__}: {exc}",
                    [f"  PROBE ERROR: {type(exc).__name__}: {exc}"],
                )
            for line in result.log:
                print(line)
            rows.append((name, result.verdict, result.zipnote, result.deleted))
            if result.deleted in ("NO", "UNKNOWN"):
                print("\n*** STOPPING LOOP — a test profile could not be proven deleted ***")
                rc = 1
                break
    finally:
        print("\n" + "=" * 72)
        print(f"{'name':<44} {'round trip':<22} {'zip':<20} deleted")
        for name, verdict, zipnote, deleted in rows:
            short = name if len(name) <= _NAME_COL else name[: _NAME_COL - 3] + "..."
            print(f"{short!r:<44} {verdict:<22} {zipnote:<20} {deleted}")
        final_active = await control.get_active_config()
        print(f"\nactive config now {final_active!r}")
        final = await _config_list(cfg)
        final_zip = sorted(i.filename for i in _members(await http.backup()))
        print(f"final ConfigurationList names={final.names!r}")
        print(f"final settings.zip data/cfgs members={final_zip!r}")
        await http.aclose()
        await control.close()
    return rc


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
