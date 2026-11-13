---
status: testing
phase: 1
fields_version: 1
started: 2026-11-10
updated: 2026-11-10
---

## Items

### 1. Unticked stations keep their snapshots
expected: After a snapshot saved on station A is opened in the Snapshot builder, A is unticked, B is ticked and Save is pressed, A still holds that snapshot as it was, and every snapshot any unticked station held before the save is still there
status: pass
first_pass: pass
source: verifier
evidence: shell.js:132 gone requires to.includes(from.st); tests test_saving_to_another_station_leaves_the_record_on_its_own and test_a_save_leaves_a_station_it_was_not_ticked_for_as_it_was pass (/tmp/gate-node-oUxo54TN.log, 163/163); backend per-station pins pass (/tmp/gate-pytest-A0nlnIRs.log, 12 passed).

### 2. Saved snapshot lands on every ticked station
expected: After a snapshot save, the saved snapshot is on every station that was ticked for the save
status: pass
first_pass: pass
source: verifier
evidence: SnapshotBuilder.js:50 to: e.stations -> shell.js:134 -> api.js PUT body stations -> live.py:345-346 writes each target; test_the_put_names_every_ticked_station and test_saving_to_another_station_puts_the_record_on_it pass; spot-check save to [Night, Spare] re-read shows Warm on both, Day unchanged, 0 DELETEs.

### 3. Rename to another station leaves the old name in place
expected: Saving a snapshot from A under a new name with A unticked and B ticked leaves A holding it under the old name and B holding it under the new name
status: pass
first_pass: pass
source: verifier
evidence: test_renaming_while_saving_to_another_station_keeps_the_old_name_on_its_own (Day [Warm, Bright]) and test_renaming_while_saving_to_another_station_puts_the_new_name_on_it (Night [Quiet, Cosy]) pass.

### 4. Rename on its own ticked station replaces the old name
expected: Renaming a snapshot on its own station with that station still ticked removes the old name from that station and leaves the new one
status: pass
first_pass: pass
source: verifier
evidence: test_renaming_a_saved_record_deletes_the_old_name_in_its_station passes unedited; spot-check rename Warm->Cosy on ticked Day re-reads Day [Bright, Cosy].

## Summary

total: 4
passed: 4
failed: 0
pending: 0
skipped: 0
blocked: 0
reworked: 0
