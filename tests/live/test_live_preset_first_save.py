"""A live snapshot saves where its store's directory, and that directory's parent, do not exist yet.

Characterization of behavior that already exists.

A fresh install, or one whose state directory a user moved, has nothing on disk
under the path ``Config`` names for the live-snapshot store. The case runs the
app with every store two missing levels deep and saves through the route, so a
save that cannot make the missing directories answers with a refusal instead of
the saved snapshot.
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from apps import live_app
from fastapi.testclient import TestClient


@pytest.fixture
def fresh_install(threaded_daemon_port: int, tmp_path: Path) -> Iterator[TestClient]:
    """The control-only app with every store under a directory whose parent does not exist either."""
    yield from live_app(threaded_daemon_port, tmp_path / "missing-parent" / "missing-dir")


def test_a_first_live_snapshot_saves_where_neither_its_directory_nor_its_parent_exists(
    fresh_install: TestClient,
) -> None:
    assert fresh_install.put("/api/livepresets/Warm").status_code == 200
