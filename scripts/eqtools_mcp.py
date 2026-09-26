#!/usr/bin/env python3
"""Stdlib-only stdio MCP server that runs the EQ session's two tools, eqlab and eqstage.

The EQ session has no shell. These two tools are its whole reach beyond reading
files and writing its ledger: eqlab designs and measures, eqstage stages into the
pending buffer. Neither script has a path to apply (`scripts/eqstage/README.md`).

Each tool takes one job, as `job_path` (a job file under
`docs/eq-assistant/sessions/`, the only tree the session writes) or as an inline
`job` object, and pipes it to `node <script>` on stdin with no shell in between.

Newline-delimited JSON-RPC 2.0 on stdin/stdout, the same framing as
`hqpdoc_mcp.py`.
"""

import json
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PROTOCOL_VERSION_FALLBACK = "2024-11-05"
SERVER_NAME = "eqtools"
SERVER_VERSION = "0.1.0"

ROOT = Path(__file__).resolve().parents[1]
TOOL_NAMES = ("eqlab", "eqstage")
SESSIONS = Path("docs", "eq-assistant", "sessions")
TIMEOUT_S = 600

_JOB_SCHEMA = {
    "type": "object",
    "properties": {
        "job_path": {
            "type": "string",
            "description": "Job file under docs/eq-assistant/sessions/, absolute or relative to the repo root.",
        },
        "job": {"type": "object", "description": "The job document inline, for a job not worth a file."},
    },
}

TOOLS: list[dict[str, Any]] = [
    {
        "name": "eqlab",
        "description": "Run one eqlab job (design, measure, vocab lookup). Manual: scripts/eqlab/README.md.",
        "inputSchema": _JOB_SCHEMA,
    },
    {
        "name": "eqstage",
        "description": "Run one eqstage job, staging into the pending buffer. Manual: scripts/eqstage/README.md.",
        "inputSchema": _JOB_SCHEMA,
    },
]


class JobRefusedError(Exception):
    """A job this server will not run; `code` says why."""

    def __init__(self, code: str, message: str) -> None:
        """Carry the refusal's `code` beside its message."""
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class JobResult:
    """What the tool printed, and how it exited."""

    stdout: str
    stderr: str
    returncode: int


def _job_bytes(job: object, root: Path) -> bytes:
    """Return the bytes to pipe to the tool: a sessions file's contents, or an inline job as JSON."""
    if isinstance(job, dict):
        return json.dumps(job).encode()
    if not isinstance(job, str) or not job:
        raise JobRefusedError("bad_job", "job must be a job file path or a job object.")
    sessions = (root / SESSIONS).resolve()
    path = (root / job).resolve()
    if not path.is_relative_to(sessions):
        raise JobRefusedError("job_outside_sessions", f"job files live under {SESSIONS}/, not {job}.")
    return path.read_bytes()


def _spawn(tool: str, stdin: bytes, root: Path, env: dict[str, str] | None) -> subprocess.CompletedProcess[bytes]:
    """Start the tool's script under `node`, one literal argv per tool."""
    if tool == "eqlab":
        return subprocess.run(
            ["node", "scripts/eqlab/eqlab.js"],
            input=stdin,
            capture_output=True,
            cwd=root,
            env=env,
            timeout=TIMEOUT_S,
            check=False,
        )
    return subprocess.run(
        ["node", "scripts/eqstage/eqstage.js"],
        input=stdin,
        capture_output=True,
        cwd=root,
        env=env,
        timeout=TIMEOUT_S,
        check=False,
    )


def run_job(tool: str, job: object, root: Path = ROOT, env: dict[str, str] | None = None) -> JobResult:
    """Run one job through eqlab or eqstage, with the job on stdin and no shell."""
    if tool not in TOOL_NAMES:
        raise JobRefusedError("unknown_tool", f"no tool {tool!r}; the tools are eqlab and eqstage.")
    proc = _spawn(tool, _job_bytes(job, root), root, env)
    return JobResult(proc.stdout.decode(errors="replace"), proc.stderr.decode(errors="replace"), proc.returncode)


def _text(text: str, *, is_error: bool) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": text}], "isError": is_error}


def call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Run one `tools/call`, turning a refusal, a timeout or a failed exit into an isError result."""
    job = arguments.get("job", arguments.get("job_path"))
    try:
        result = run_job(name, job)
    except JobRefusedError as exc:
        return _text(f"{exc.code}: {exc}", is_error=True)
    except subprocess.TimeoutExpired:
        return _text(f"{name} ran past {TIMEOUT_S} s and was stopped.", is_error=True)
    except OSError as exc:
        return _text(f"{name} could not run: {exc}", is_error=True)
    body = result.stdout if not result.stderr else f"{result.stdout}\n--- stderr ---\n{result.stderr}"
    return _text(body, is_error=result.returncode != 0)


def _error(msg_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}


def _tools_call(msg_id: Any, params: dict[str, Any]) -> dict[str, Any]:
    name = params.get("name")
    if not isinstance(name, str) or name not in TOOL_NAMES:
        return _error(msg_id, -32602, f"unknown tool {name!r}.")
    arguments = params.get("arguments")
    if arguments is None:
        arguments = {}
    if not isinstance(arguments, dict):
        return _error(msg_id, -32602, f"arguments for {name} must be an object.")
    return {"jsonrpc": "2.0", "id": msg_id, "result": call_tool(name, arguments)}


def _initialize(msg_id: Any, params: dict[str, Any]) -> dict[str, Any]:
    result = {
        "protocolVersion": params.get("protocolVersion", PROTOCOL_VERSION_FALLBACK),
        "capabilities": {"tools": {}},
        "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
    }
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


METHODS: dict[str, Callable[[Any, dict[str, Any]], dict[str, Any]]] = {
    "initialize": _initialize,
    "tools/list": lambda msg_id, _params: {"jsonrpc": "2.0", "id": msg_id, "result": {"tools": TOOLS}},
    "tools/call": _tools_call,
    "ping": lambda msg_id, _params: {"jsonrpc": "2.0", "id": msg_id, "result": {}},
}


def handle_request(msg: Any) -> dict[str, Any] | None:
    """Route one parsed JSON-RPC message to its handler, or None for a notification (no `id`)."""
    if not isinstance(msg, dict):
        return _error(None, -32600, "invalid request: expected a JSON object.")
    if "id" not in msg:
        return None
    msg_id = msg["id"]
    method = msg.get("method")
    params = msg.get("params")
    if params is None:
        params = {}
    if not isinstance(params, dict):
        return _error(msg_id, -32602, "invalid params: expected a JSON object.")
    handler = METHODS.get(method) if isinstance(method, str) else None
    if handler is None:
        return _error(msg_id, -32601, f"method not found: {method}")
    return handler(msg_id, params)


def main() -> int:
    """Read newline-delimited JSON-RPC requests from stdin, write one response line per request."""
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            sys.stdout.write(json.dumps(_error(None, -32700, str(exc))) + "\n")
            sys.stdout.flush()
            continue
        response = handle_request(msg)
        if response is not None:
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
