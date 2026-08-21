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


async def _config_list(cfg: Config) -> tuple[str, list[str], bytes, str | None]:
    """(active, names, raw bytes, parse error) via a fresh ControlClient."""
    raw = await _raw_control(cfg, b"<ConfigurationList/>")
    client = ControlClient(host=cfg.hqp_host, port=cfg.hqp_control_port)
    await client.connect()
    try:
        root = await client.request("<ConfigurationList/>")
        return root.attrib.get("active", ""), [i.attrib.get("name", "") for i in root], raw, None
    # A profile name the daemon emits unescaped can break the reply in any number of ways; whatever the parse throws
    # is the observation, returned alongside the raw bytes rather than raised.
    except Exception as exc:  # noqa: BLE001
        return "", [], raw, f"{type(exc).__name__}: {exc}"
    finally:
        await client.close()


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


async def _probe_one(cfg: Config, http: HttpConfigClient, name: str, base_zip: set[str]) -> tuple[str, str, str]:
    """Return (round-trip verdict, zip encoding note, deleted verdict)."""
    print(f"\n{'=' * 72}\nNAME {name!r}\n  utf-8 bytes ({len(name.encode())}): {name.encode()!r}")
    verdict = zipnote = "n/a"
    saved = False
    try:
        await http.post_profile("save", profile_name=name)
        saved = True
        print("  POST /config/profile/save -> HTTP 2xx")
    # Rejecting a candidate name is a legitimate result for this probe, and the daemon may signal it as an HTTP error,
    # a transport failure or a mangled reply — all of them recorded as "save rejected" rather than aborting the sweep.
    except Exception as exc:  # noqa: BLE001
        print(f"  POST /config/profile/save FAILED: {type(exc).__name__}: {exc}")
        verdict = "save rejected"

    if saved:
        active, names, raw, err = await _config_list(cfg)
        new = [n for n in names if n.startswith("ZZprobe")]
        print(f"  ConfigurationList parse: {err or 'ok'}")
        print(f"    active={active!r} ZZprobe entries={new!r}")
        if new:
            print(f"    returned bytes: {new[0].encode()!r}")
        print(f"    RAW document: {raw!r}")
        verdict = _describe(name, new[0]) if new else ("XML PARSE FAILURE" if err else "ABSENT from list")

        blob = await http.backup()
        cands = [i for i in _members(blob) if i.filename not in base_zip]
        print(f"  settings.zip new members: {[i.filename for i in cands]!r}")
        for info in cands:
            print(f"    member repr : {info.filename!r}")
            print(f"    raw bytes   : {_raw_name_bytes(info)!r}")
            print(f"    flag_bits   : 0x{info.flag_bits:04x} (UTF-8 0x800 = {bool(info.flag_bits & 0x800)})")
            with zipfile.ZipFile(io.BytesIO(blob)) as zf:
                data = zf.read(info)
            print(f"    size        : {len(data)} bytes")
            first = data.split(b"\n", 1)[0][:120].decode("utf-8", "replace")
            print(f"    first line  : {first}")
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
            print("  POST /config/profile/delete -> HTTP 2xx")
        # Cleanup delete; whether the profile actually went away is adjudicated below by readback of ConfigurationList
        # and settings.zip, which sets deleted = "NO" on any stray — not by this handler, so the error is only logged.
        except Exception as exc:  # noqa: BLE001
            print(f"  DELETE POST FAILED: {type(exc).__name__}: {exc}")
        _, names2, raw2, err2 = await _config_list(cfg)
        zip2 = {i.filename for i in _members(await http.backup())}
        stray_list = [n for n in names2 if n.startswith("ZZprobe")]
        stray_zip = sorted(zip2 - base_zip)
        print(f"  readback ConfigurationList ({err2 or 'ok'}): ZZprobe entries={stray_list!r}")
        print(f"  readback settings.zip new members: {stray_zip!r}")
        if stray_list or stray_zip:
            print(f"  *** CLEANUP FAILED *** stray list={stray_list!r} stray zip={stray_zip!r}")
            print(f"  *** RAW list document: {raw2!r}")
            deleted = "NO"
        else:
            deleted = "yes"
    return verdict, zipnote, deleted


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
        _, before_names, _, _ = await _config_list(cfg)
        base_zip = {i.filename for i in _members(await http.backup())}
        print(f"BASELINE ConfigurationGet active={before_active!r}")
        print(f"BASELINE ConfigurationList names={before_names!r}")
        print(f"BASELINE settings.zip data/cfgs members={sorted(base_zip)!r}")

        wanted = [NAMES[int(a) - 1] for a in sys.argv[1:]] or NAMES
        for name in wanted:
            try:
                verdict, zipnote, deleted = await _probe_one(cfg, http, name, base_zip)
            # Outermost per-name guard: any unexpected failure inside a single candidate is recorded as its row with
            # deleted="UNKNOWN", which stops the loop below so the summary table still prints from the finally block.
            except Exception as exc:  # noqa: BLE001
                print(f"  PROBE ERROR: {type(exc).__name__}: {exc}")
                verdict, zipnote, deleted = f"ERROR {type(exc).__name__}", "n/a", "UNKNOWN"
            rows.append((name, verdict, zipnote, deleted))
            if deleted in ("NO", "UNKNOWN"):
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
        _, final_names, _, _ = await _config_list(cfg)
        final_zip = sorted(i.filename for i in _members(await http.backup()))
        print(f"final ConfigurationList names={final_names!r}")
        print(f"final settings.zip data/cfgs members={final_zip!r}")
        await http.aclose()
        await control.close()
    return rc


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
