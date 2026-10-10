"""Control API (TCP 4321) failure types, each carrying the ``code`` the API reports it under."""

from hqptuner.conf.httpauth import NO_HTTP_CLIENT_MESSAGE
from hqptuner.conf.noanswer import no_answer_message
from hqptuner.errors import HQPTunerError


class ControlError(HQPTunerError):
    """Base for every Control API failure: not connected, timed out, socket died, response would not parse."""

    code = "daemon_unavailable"


class CommandError(ControlError):
    """Daemon answered result="Error"."""

    code = "daemon_refused"


class ControlTimeoutError(ControlError):
    """A command got no reply within its timeout — the daemon may have restarted mid-command."""

    def __init__(self, *, timeout: float) -> None:
        """Render the no-answer sentence for ``timeout``, shared with the 8088 lane."""
        super().__init__(no_answer_message(timeout))


class ControlConnectionFailedError(ControlError):
    """HQPlayer could not be reached at ``host:port``: the connection was refused or reset, or there was none."""

    def __init__(self, *, host: str, port: int) -> None:
        """Render the not-reachable sentence for the address the client dials."""
        super().__init__(f"HQPlayer is not reachable at {host}:{port}.")


class UnparseableResponseError(ControlError):
    """A complete response frame that still will not parse, even after root-only recovery."""

    def __init__(self, *, command: str, parser_error: str) -> None:
        """Render the not-readable sentence naming the command answered and the XML parser's own error text."""
        super().__init__(f"HQPlayer's answer to {command} is not readable XML: {parser_error}.")


class HttpCredentialsMissingError(ControlError):
    """The 8088 config client accessor was used with no management credentials configured."""

    def __init__(self) -> None:
        """Render the fixed no-credentials wording; this template carries no interpolated fact."""
        super().__init__(NO_HTTP_CLIENT_MESSAGE)


class ConnectionClosedError(ControlError):
    """The daemon closed the connection mid-read."""

    def __init__(self) -> None:
        """Render the fixed wording; this template carries no interpolated fact."""
        super().__init__("HQPlayer closed the connection before answering.")


class ResponseTooLargeError(ControlError):
    """An accumulating response frame exceeded ``MAX_RESPONSE`` without ever completing."""

    def __init__(self, *, command: str, limit: int) -> None:
        """Render the never-ended sentence naming the command answered and ``limit``, given in bytes, in MiB."""
        super().__init__(f"HQPlayer's answer to {command} passed {limit / 2**20:g} MB without ending.")


class CommandRefusedError(CommandError):
    """The daemon answered ``result="Error"`` to a setter, naming the command, the result and its reason text."""

    def __init__(self, *, element_name: str, result: str, text: str) -> None:
        """Render the refusal wording: which command, what the daemon said, and its reason text."""
        super().__init__(f"{element_name}: {result}: {text}")


def readback_mismatch(setting: str, want: str, got: str | None) -> str:
    """Render the sentence for one setting whose readback ``got`` is not the ``want`` that was set."""
    return f"After HQPTuner set {setting} to {want}, HQPlayer reported {got}."


class StateMismatchError(CommandError):
    """A post-apply ``State`` readback did not match what was just set."""

    def __init__(self, *, mismatch: dict[str, tuple[str, str | None]]) -> None:
        """Render one ``readback_mismatch`` sentence per State attribute in ``mismatch``, a space between each."""
        super().__init__(" ".join(readback_mismatch(setting, want, got) for setting, (want, got) in mismatch.items()))
