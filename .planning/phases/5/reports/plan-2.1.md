PLAN CHECKPOINT: structural

Plan: /home/atom/dev/hqptuner2/.planning/phases/5/PLAN-2.md

Tasks: 0 of 1

| Task | Commit | Note |
|---|---|---|
| 1 - Pin the close's baseline upload on each landed-write trigger | none | stopped before any commit; probe edits reverted, worktree clean at c6d42b4f on cadence/phase-5-plan-2 |

Deviations:

- [deviation] The plan asserts that dropping the `"$applied" -gt 0` arm, or the `"$lived" -gt 0` arm, of the close condition in scripts/abuse.sh turns its own case red, i.e. that an apply that landed and a live write that landed each make `close` upload. Actually true: at HEAD neither can. `GET /api/audit` serves each record as `{"seq","ts","event","fields":{...}}`, with `ok`, `http` and `live` nested under `fields` (hqptuner/audit.py `AuditRecord`). abuse.sh close reads them at the top level: `select(.event == "apply" and .ok == true)` (the `applied=` and `lived=` lines) and `{seq, event, http, live, ok}`. So `.ok` is always null, `applied` and `lived` are always 0, and the `$keys` read-back list is always empty. Evidence from a probe run (open, POST /api/config/apply with switch_to "", POST /api/config/live junk_filter=1, close): audit listed apply seq 5 and live.write seq 6, close printed `applies landed: 0` and `live writes landed: 0`, and no upload happened (`_restore_attempts` 0). Only the preset arm, which counts by event name alone, can fire. A positive apply case and a positive live-write case fail against the unmodified script, and the break-proofs for those two arms cannot turn red. Fixing it means editing scripts/abuse.sh (read `.fields.ok`, `.fields.http`, `.fields.live`), which the plan marks out of scope and which is outside the lease (`tests/e2e/test_abuse_bracket.py` only). Not done: no test written, nothing committed.

Open items:

- Owner decision needed: allow a fix to scripts/abuse.sh close (read ok, http and live from `.fields`) in this plan, or write the apply and live-write cases red and report the script defect separately. The same bug blinds the read-back (`keys` always empty), so a close after an apply never verifies the applied field at baseline.
- Design findings that hold once unblocked: an apply with body `{"switch_to": ""}` audits `apply` and sends no restore upload; `POST /api/config/live` with `{"fields":{"junk_filter":"1"}}` audits `live.write` and moves `control_state["filter_junk"]` to "1", so it must be put back and observed by the app before close or close's live readback loops; the preset trigger is reachable without an apply by exporting a state archive that carries a preset (seed one pre-open via apply with save) and importing it after open, which writes `preset.write` with trigger import.
- The worktree has no .venv, so gates need a symlink to /home/atom/dev/hqptuner2/.venv (used for the probe, removed again).
