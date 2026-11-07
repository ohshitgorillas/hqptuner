## Todos

- None.
- [ ] (phase 4) v2 suite is red at HEAD: commit 38b7e28e deleted hqptuner/lanes/__init__.py, which held LaneManager, while hqptuner/presets/__init__.py:7 still imports it, so every test errors at conftest load ("cannot import name 'LaneManager' from 'hqptuner.lanes' (unknown location)"); it must be green for phase 4 criterion 3.
- [x] (phase 4) The read-volume hook removal is staged and uncommitted on v2 (.claude/settings.json entry, .claude/hooks/read-volume.py, .claude/hooks/read_volume_selftest.py), blocked by the red pre-commit suite; commit it once v2 is green. The same removal landed on dev as 7f773b94.

## Seeds

- None.

## Notes

- None.

## Debt markers

- None.
