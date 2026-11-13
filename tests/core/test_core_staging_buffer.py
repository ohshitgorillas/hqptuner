"""The staging buffer, built and filled by code in the ``core`` layer alone.

The buffer holds two buckets, ``live`` (Control-API edits keyed by live setting)
and ``http`` (persistent config fields keyed by field name), and a stage merges
into them the way ``dict.update`` does. These
cases build the buffer from ``hqptuner.core.pending`` with no app, no client and
no daemon, so nothing above ``core`` takes part in staging. The HTTP routes over
the same buffer are covered in ``tests/api/test_api_write.py``.
"""

from hqptuner.core.pending import PendingStore

#: A live setting and the bucket its first stage carries.
FIRST_LIVE_SETTING = "shaper"
FIRST_LIVE_BUCKET = {"value": "5"}

#: A second live setting, staged after the first.
SECOND_LIVE_SETTING = "filter"
SECOND_LIVE_BUCKET = {"value": "1"}

#: A persistent field staged twice, and the value each stage carries.
HTTP_FIELD = "title"
EARLIER_TITLE = "Opal"
LATER_TITLE = "Renamed"


def test_a_second_stage_in_core_keeps_the_live_edit_the_first_stage_made() -> None:
    store = PendingStore()
    store.stage(live={FIRST_LIVE_SETTING: FIRST_LIVE_BUCKET}, http={})
    store.stage(live={SECOND_LIVE_SETTING: SECOND_LIVE_BUCKET}, http={})
    assert store.live.get(FIRST_LIVE_SETTING) == FIRST_LIVE_BUCKET


def test_restaging_a_field_in_core_leaves_the_later_value_staged() -> None:
    store = PendingStore()
    store.stage(live={}, http={HTTP_FIELD: EARLIER_TITLE})
    store.stage(live={}, http={HTTP_FIELD: LATER_TITLE})
    assert store.http.get(HTTP_FIELD) == LATER_TITLE
