"""The readiness gate: while either daemon lane is down, no engine write is attempted.

HQPTuner needs the 4321 control lane and the 8088 config lane together. This module holds the refusal a not-ready app
answers (`refusal`).
"""

from hqptuner.api.deps import GetFormFailedError
from hqptuner.api.errors import ApiError, refuse
from hqptuner.conf.httpauth import decline_error
from hqptuner.core.manager import ConnectionManager
from hqptuner.engine.controlerrors import ControlTimeoutError


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
