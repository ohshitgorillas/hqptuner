"""The code a persistent write's decline carries once hqplayerd has refused the management credential.

The refusal is earned off the wire: the fake 8088 daemon answers the digest with 403
(`fake_http._auth_refusal`, verified on 6.0.4), and a forms refresh records what it answered
before the write begins. A refusal first met inside the write is a REST case
(`tests/api/test_refused_credential_apply_code.py`): the code reaches it at the route.
"""

from typing import Any

import pytest

from hqptuner.core.manager import ConnectionManager
from hqptuner.errors import HQPTunerError
from hqptuner.lanes.http import forms

#: The code a refused credential carries, distinct from the one an install with no credential carries.
CREDENTIALS_REFUSED = "credentials_refused"


async def test_a_write_declined_for_a_recorded_credential_refusal_carries_code_credentials_refused(
    http_manager: ConnectionManager, http_daemon: dict[str, Any]
) -> None:
    http_daemon["_refuse_auth"] = True
    await forms.refresh(http_manager)
    with pytest.raises(HQPTunerError) as declined:
        await http_manager.applyops.apply_engine({"cuda": "0"})
    assert declined.value.code == CREDENTIALS_REFUSED
