PLAN CHECKPOINT: decision
Plan: .planning/phases/6/PLAN-1.md
Tasks: 1 of 6
| Task | Commit | Note |
|---|---|---|
| 1 - One validator decides whether a string is a daemon host | e3f609bf | `check_host(host) -> str` raises `InvalidHostError(ValueError)`; `url_host(host)` brackets IPv6. 24 cases in tests/engine/http/test_host_address.py green; `scripts/gate.sh make check` exit=0; pre-commit green. Bite: static discharge (new surface). |
| 2 - Save and login refuse an invalid host | none | Not started: the owner-approved invalid-host refusal sentence (D-17) is not in hand. Searched the plan, CONTEXT, PLAN-2..5, docs and hqptuner/ for it; nothing. |
Deviations: [deviation] Task 1 asserted a new module `hqptuner/conf/hostaddr.py`; actually `hqptuner/conf/` already holds 15 files, filepawl's directory cap (`hqptuner/conf: 16 files, cap 15`, pre-commit "filepawl tree gate" failed, and `filepawl accept` takes no directory allowance). Did: put the validator in `hqptuner/conf/httpauth.py` (lower of the two 8088 modules, in lease, 177 -> ~230 lines), no gate exemption. Later tasks (3, 6) import `check_host`/`url_host` from `hqptuner.conf.httpauth`; tests/engine/http/test_host_address.py keeps its name.
Open items: Task 2 blocked on the invalid-host sentence (CHECKPOINT decision). Task 4's note stands: test_a_save_that_changes_only_the_host_logs_nobody_out will no longer exercise a host change, to be reported to the owner. Fuller shape declined: no typed-result return from check_host; returns the host str or raises, which meets Verify.
