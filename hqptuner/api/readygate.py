"""The readiness gate: while either daemon lane is down, no engine write is attempted.

HQPTuner needs the 4321 control lane and the 8088 config lane together. This module holds the two decisions the gate
makes: which requests it holds (`decide`) and the refusal a not-ready app answers (`refusal`).
"""

from hqptuner.api.crosssite import STATE_CHANGING
from hqptuner.api.deps import GetFormFailedError
from hqptuner.api.errors import ApiError, refuse
from hqptuner.api.gate import Access
from hqptuner.conf.httpauth import decline_error
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.controlerrors import ControlTimeoutError

#: The state-changing requests that go through while the app is not ready: the way back to a working install, and the
#: writes to HQPTuner's own stores, which touch no daemon.
OPEN_WRITES = frozenset(
    {
        ("POST", "/api/login"),
        ("POST", "/api/connection"),
        ("POST", "/api/config/stage"),
        ("DELETE", "/api/config/pending"),
        ("PUT", "/api/favorites"),
        ("PUT", "/api/descriptions"),
        ("PUT", "/api/narrowing"),
        ("PUT", "/api/matrixmodes"),
        ("POST", "/api/autosave"),
    }
)

#: A live preset is saved and deleted in HQPTuner's own store; `POST` under the same prefix applies one to the engine.
LIVE_PRESET_PREFIX = "/api/livepresets/"
LIVE_PRESET_METHODS = frozenset({"PUT", "DELETE"})


def refusal(manager: ConnectionManager) -> ApiError:
    """Return the refusal a not-ready app answers, naming the cause the user can act on first.

    The 8088 pair comes first (no client, or credentials the daemon refused), so the fix is named before a symptom. A
    control lane that is not connected, and an 8088 lane not yet stamped answering, both answer the no-answer
    sentence. A recorded failed read of `/config` answers over that error.
    """
    declined = decline_error(manager)
    if declined is not None:
        return refuse(declined)
    error = manager.readings.config_error
    if manager.connected.is_set() and error is not None:
        return refuse(GetFormFailedError(error=error))
    return refuse(ControlTimeoutError(timeout=manager.cfg.request_timeout))


def _is_own_preset_write(method: str, path: str) -> bool:
    """Whether the request saves or deletes a live preset, the only writes under `/api/livepresets/` that stay open."""
    return method in LIVE_PRESET_METHODS and path.startswith(LIVE_PRESET_PREFIX) and path != LIVE_PRESET_PREFIX


def decide(path: str, method: str) -> Access:
    """Decide whether the request to ``path`` by ``method`` is an engine write the gate holds.

    Every `GET` and `HEAD`, and every path outside `/api`, goes through. Every state-changing request to `/api` or
    under it is held unless it is in the open set, so a route added later is held without anyone remembering it. A
    path is matched exactly: `/api/favorites/` is not `/api/favorites`.
    """
    if method not in STATE_CHANGING or (path != "/api" and not path.startswith("/api/")):
        return Access.ALLOW
    open_write = (method, path) in OPEN_WRITES or _is_own_preset_write(method, path)
    return Access.ALLOW if open_write else Access.DENY
