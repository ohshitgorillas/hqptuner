"""Event-log read surface, built on demand so an install without the log has no endpoint at all."""

from dataclasses import dataclass

from fastapi import APIRouter

from hqptuner.audit import AuditLog, AuditRecord

# The most records one request answers. Without it the ``limit`` is the caller's, and a huge one has the whole
# current log serialized into one response. At least the default ``limit`` of 200, so the default is never clamped.
MAX_LIMIT = 1000


@dataclass(frozen=True)
class AuditRecords:
    """``GET /api/audit``: the last ``limit`` audit records, newest last."""

    records: list[AuditRecord]


def audit_router(audit: AuditLog) -> APIRouter:
    """Build the event log's read route, which exists only when the log is on.

    An install without ``HQPTUNER_DEBUG_LOG`` has no such endpoint rather than an endpoint that answers empty. Nothing
    in the UI links here; it is an operator's surface, and the file it reads is equally available to ``jq``.
    """
    audit_api = APIRouter(prefix="/api")

    @audit_api.get("/audit")
    def records(limit: int = 200) -> AuditRecords:
        """Return the last ``limit`` audit records, newest last, read straight off the log file."""
        return AuditRecords(records=audit.tail(min(limit, MAX_LIMIT)))

    return audit_api
