#!/usr/bin/env python3
"""Stdlib-only stdio MCP server over the HQPlayer authority sources.

Newline-delimited JSON-RPC 2.0 on stdin/stdout. Handles `initialize`
(echoing the client's protocolVersion), `tools/list`, `tools/call` and
`ping`; notifications (no `id`) are read and dropped. The five tools
(hqp_find, hqp_toc, hqp_section, hqp_page, hqp_readme) are implemented in
`hqpdoc_tools.py`, imported below; see that module's docstring for what
each one does.
"""

import json
import re
import sys
from collections.abc import Callable
from typing import Any

import hqpdoc_tools as tools

PROTOCOL_VERSION_FALLBACK = "2024-11-05"
SERVER_NAME = "hqpdoc"
SERVER_VERSION = "0.1.0"

TOOLS: list[dict[str, Any]] = [
    {
        "name": "hqp_find",
        "description": "Search manual-facts.txt, the split manual and hqplayerd-readme.txt for a term.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "term": {"type": "string", "description": "Case-insensitive substring to search for."},
                "cap": {"type": "integer", "description": "Hits per source group (default 8)."},
                "context": {"type": "integer", "description": "Lines of context either side of each hit (default 0)."},
            },
            "required": ["term"],
        },
    },
    {
        "name": "hqp_toc",
        "description": "Print the manual's section table plus the hqplayerd-readme.txt heading list.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "hqp_section",
        "description": 'Print one docs/vendor/manual/ section file by its INDEX.md number, e.g. "4.6".',
        "inputSchema": {
            "type": "object",
            "properties": {"number": {"type": "string", "description": 'Section number, e.g. "4.6".'}},
            "required": ["number"],
        },
    },
    {
        "name": "hqp_page",
        "description": "Print the manual text between [page N] and the next marker, across section files.",
        "inputSchema": {
            "type": "object",
            "properties": {"page": {"type": "integer", "description": "Manual page number."}},
            "required": ["page"],
        },
    },
    {
        "name": "hqp_readme",
        "description": 'One hqplayerd-readme.txt heading block by number ("1.12") or name ("matrix_profile").',
        "inputSchema": {
            "type": "object",
            "properties": {"key": {"type": "string", "description": "Heading number or case-insensitive name."}},
            "required": ["key"],
        },
    },
]

_MISSING = object()


def _str_arg(args: dict[str, Any], key: str) -> str:
    """Return the required string argument `key`, or raise a `ToolError` naming what is wrong."""
    value = args.get(key, _MISSING)
    if value is _MISSING:
        raise tools.ToolError(f"missing required argument {key!r}.")
    if isinstance(value, bool) or not isinstance(value, str | int | float):
        raise tools.ToolError(f"argument {key!r} must be a string, not {type(value).__name__}.")
    return str(value)


def _int_arg(args: dict[str, Any], key: str, default: int | None = None) -> int:
    """Return the integer argument `key` (or its default), or raise a `ToolError` naming what is wrong."""
    value = args.get(key, _MISSING)
    if value is _MISSING and default is not None:
        return default
    if value is _MISSING:
        raise tools.ToolError(f"missing required argument {key!r}.")
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    if isinstance(value, str) and re.fullmatch(r"\s*-?\d+\s*", value):
        return int(value)
    raise tools.ToolError(f"argument {key!r} must be an integer, not {value!r}.")


DISPATCH: dict[str, Callable[[dict[str, Any]], str]] = {
    "hqp_find": lambda args: tools.tool_hqp_find(
        _str_arg(args, "term"), _int_arg(args, "cap", 8), _int_arg(args, "context", 0)
    ),
    "hqp_toc": lambda _args: tools.tool_hqp_toc(),
    "hqp_section": lambda args: tools.tool_hqp_section(_str_arg(args, "number")),
    "hqp_page": lambda args: tools.tool_hqp_page(_int_arg(args, "page")),
    "hqp_readme": lambda args: tools.tool_hqp_readme(_str_arg(args, "key")),
}


def _error(msg_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}


def call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Dispatch one `tools/call` to a known tool, turning a `ToolError` or unreadable file into an isError result."""
    try:
        text = DISPATCH[name](arguments)
    except tools.ToolError as exc:
        return {"content": [{"type": "text", "text": str(exc)}], "isError": True}
    except OSError as exc:
        return {"content": [{"type": "text", "text": f"{name} could not read its source: {exc}"}], "isError": True}
    return {"content": [{"type": "text", "text": tools.with_warning(text)}], "isError": False}


def _tools_call(msg_id: Any, params: dict[str, Any]) -> dict[str, Any]:
    """Validate a `tools/call` request's name and arguments, then run it."""
    name = params.get("name")
    if not isinstance(name, str) or name not in DISPATCH:
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
        # Notification: read and drop, per the JSON-RPC/MCP contract.
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
