"""Event-log read surface, built on demand so an install without the log has no endpoint at all."""

from typing import Any

from fastapi import APIRouter

from hqptuner.audit import AuditLog


def audit_router(audit: AuditLog) -> APIRouter:
    """Build the event log's read route, which exists only when the log is on.

    An install without ``HQPTUNER_DEBUG_LOG`` has no such endpoint rather than an endpoint that answers empty. Nothing
    in the UI links here; it is an operator's surface, and the file it reads is equally available to ``jq``.
    """
    audit_api = APIRouter(prefix="/api")

    @audit_api.get("/audit")
    def records(limit: int = 200) -> dict[str, Any]:
        """Return the last ``limit`` audit records, newest last, read straight off the log file."""
        return {"records": audit.tail(limit)}

    return audit_api
