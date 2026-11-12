PLAN CHECKPOINT: blocked

Plan: .planning/phases/8/PLAN-3.md

Tasks: 0 of 3

| Task | Commit | Note |
|---|---|---|
| 1 - A Control API attribute value containing `"` is refused | none | Built and green, not committed. `scripts/gate.sh make check` fails only at `filepawl check`: `hqptuner/engine/control.py: grew past allowance (409 > 404); split it`. |

Working tree (uncommitted, Task 1): `hqptuner/engine/control.py` (+5), `hqptuner/engine/controlerrors.py` (`AttributeValueRefusedError`, code `invalid_input`), `docs/architecture.md` §2.1 sentence, `tests/support/fake_control.py` (`serve_recording`, a daemon that records raw bytes and parses nothing), `tests/engine/http/test_control_attr_quote.py`. Bite run: characterization test green, the three refusal cases red (no error raised, wire not empty) before the change; all green after. Lint, black, mypy, lint-imports, gates all pass except filepawl.

Block: D-16 and the plan say run `filepawl accept` for `control.py` growth. `filepawl accept` never raises an existing allowance entry (its docstring in `filepawl/gates/length.py`: "Never raises an entry ... a file that grew keeps its entry, and the finding survives the run"); run with and without `--reason` it left the entry at 404 and the finding standing (the `--reason` edit to `.filepawl.toml` was reverted). The file is 409 lines, under the 500 cap, past its 404 allowance. CLAUDE.md: "A file under the cap that grew past its allowance goes to the owner as a blocking question, not a split." Hand-editing `.filepawl.toml` ("Do not edit; run `filepawl accept`") is a hook/gate-config edit and was not done.

Deviations: [deviation] the plan asserted `filepawl accept` clears `control.py` growth; it cannot raise an entry, so the allowance stays 404 against 409.
Open items: Tasks 2 and 3 not started (stopped at the checkpoint). Copy: Plan 1 Notes delegate refusal copy (items 8, 9, 14) to the executor and put the phase's one changelog bullet in Plan 1, so no task here adds a CHANGELOG.md line; the refusal sentence in `AttributeValueRefusedError` ("HQPTuner did not send {element}: its {attribute} value contains a double quote.") is new user-facing copy to list when Task 1 commits. Alternative if the owner prefers no allowance change: Task 1 can be held to 404 lines only by moving the check into a helper plus removing existing lines, which was not done as it shapes code around the gate.
