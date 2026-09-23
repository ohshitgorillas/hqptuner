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

DISPATCH: dict[str, Callable[[dict[str, Any]], str]] = {
    "hqp_find": lambda args: tools.tool_hqp_find(args["term"], int(args.get("cap", 8)), int(args.get("context", 0))),
    "hqp_toc": lambda _args: tools.tool_hqp_toc(),
    "hqp_section": lambda args: tools.tool_hqp_section(str(args["number"])),
    "hqp_page": lambda args: tools.tool_hqp_page(int(args["page"])),
    "hqp_readme": lambda args: tools.tool_hqp_readme(str(args["key"])),
}


def call_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Dispatch one `tools/call`, turning a `ToolError` or bad arguments into an isError result."""
    handler = DISPATCH.get(name)
    if handler is None:
        return {"content": [{"type": "text", "text": f"unknown tool {name!r}."}], "isError": True}
    try:
        text = handler(arguments or {})
    except tools.ToolError as exc:
        return {"content": [{"type": "text", "text": str(exc)}], "isError": True}
    except (KeyError, ValueError, TypeError) as exc:
        return {"content": [{"type": "text", "text": f"bad arguments for {name}: {exc}"}], "isError": True}
    return {"content": [{"type": "text", "text": tools.with_warning(text)}], "isError": False}


def handle_request(msg: dict[str, Any]) -> dict[str, Any] | None:
    """Route one parsed JSON-RPC message to its handler, or None for a notification (no `id`)."""
    msg_id = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}

    if "id" not in msg:
        # Notification: read and drop, per the JSON-RPC/MCP contract.
        return None

    if method == "initialize":
        client_version = params.get("protocolVersion", PROTOCOL_VERSION_FALLBACK)
        result = {
            "protocolVersion": client_version,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        }
        return {"jsonrpc": "2.0", "id": msg_id, "result": result}

    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {"tools": TOOLS}}

    if method == "tools/call":
        name = params.get("name", "")
        arguments = params.get("arguments") or {}
        return {"jsonrpc": "2.0", "id": msg_id, "result": call_tool(name, arguments)}

    if method == "ping":
        return {"jsonrpc": "2.0", "id": msg_id, "result": {}}

    return {
        "jsonrpc": "2.0",
        "id": msg_id,
        "error": {"code": -32601, "message": f"method not found: {method}"},
    }


def main() -> int:
    """Read newline-delimited JSON-RPC requests from stdin, write one response line per request."""
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            parse_error = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": str(exc)},
            }
            sys.stdout.write(json.dumps(parse_error) + "\n")
            sys.stdout.flush()
            continue
        response = handle_request(msg)
        if response is not None:
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
