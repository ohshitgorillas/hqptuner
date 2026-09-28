"""Control API (TCP 4321) failure types, each carrying the ``code`` the API reports it under."""

from hqptuner.conf.httpauth import NO_HTTP_CLIENT_MESSAGE
from hqptuner.errors import HQPTunerError


class ControlError(HQPTunerError):
    """Base for every Control API failure: not connected, timed out, socket died, response would not parse."""

    code = "daemon_unavailable"


class CommandError(ControlError):
    """Daemon answered result="Error"."""

    code = "daemon_refused"


class ControlTimeoutError(ControlError):
    """A command got no reply within its timeout — the daemon may have restarted mid-command."""

    def __init__(self, *, what: str, timeout: float) -> None:
        """Render the timeout wording for the command (or phase) named by ``what``."""
        super().__init__(f"{what}: no reply within {timeout:g}s (the daemon may have restarted)")


class ControlConnectionFailedError(ControlError):
    """The transport itself failed — a dead socket, an OS-level error — while ``what`` was in flight."""

    def __init__(self, *, what: str, error: OSError) -> None:
        """Render the connection-failure wording, naming what was happening and the OS error that killed it."""
        super().__init__(f"{what}: connection failed: {error}")


class ControlChainedFailureError(ControlError):
    """A ``ControlError`` raised while receiving one reply, re-raised naming the command that was in flight.

    ``_recv_document``'s own failures ("connection closed by daemon", a frame that will not parse) name no
    command, and which command died is the whole diagnostic.
    """

    def __init__(self, *, what: str, error: ControlError) -> None:
        """Render the chained wording: the command in flight, then the underlying ``ControlError``."""
        super().__init__(f"{what}: {error}")


class UnparseableResponseError(ControlError):
    """A complete response frame that still will not parse, even after root-only recovery."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("unparseable response document")


class NotConnectedError(ControlError):
    """A request was attempted, or a reply awaited, with no live connection."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("not connected")


class HttpCredentialsMissingError(ControlError):
    """The 8088 config client accessor was used with no management credentials configured."""

    def __init__(self) -> None:
        """Render the fixed no-credentials wording; this template carries no interpolated fact."""
        super().__init__(NO_HTTP_CLIENT_MESSAGE)


class ConnectionClosedError(ControlError):
    """The daemon closed the connection mid-read."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("connection closed by daemon")


class ResponseTooLargeError(ControlError):
    """An accumulating response frame exceeded ``MAX_RESPONSE`` without ever completing."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("response exceeds size limit")


class CommandRefusedError(CommandError):
    """The daemon answered ``result="Error"`` to a setter, naming the command, the result and its reason text."""

    def __init__(self, *, element_name: str, result: str, text: str) -> None:
        """Render the refusal wording: which command, what the daemon said, and its reason text."""
        super().__init__(f"{element_name}: {result}: {text}")


class StateMismatchError(CommandError):
    """A post-apply ``State`` readback did not match what was just set."""

    def __init__(self, *, mismatch: dict[str, tuple[str, str | None]]) -> None:
        """Render the mismatch wording carrying the whole (want, got) map."""
        super().__init__(f"State readback mismatch (want, got): {mismatch}")
