---
description: Full gate + rebuild the hqptuner:dev container so the user can view/test changes at :8090
---

Run the project's task-complete check:

```
bash .claude/task-check.sh
```

It runs `make check` (the full gate) and, **only if the gate is green**, rebuilds the `hqptuner:dev` Docker container from the working tree (`docker-compose.yaml`, not the prod `compose.yaml`) and health-checks `:8090`. A root-owned systemd path unit performs the rebuild on request; the script waits up to 600 s for its result and fails on a timeout.

Report **PASS/FAIL per stage**:

- On PASS — tell the user the dev container is rebuilt from the current working tree and is theirs to view/test, quoting the LAN URL the script prints on its last line. Do not claim visual/behavioral work is "done" until this has run and passed — the user inspects every change themselves.
- On FAIL — quote the single decisive failing line, stop, and fix it. Never rebuild past a red gate, never report done.
