PLAN COMPLETE

Plan: .planning/phases/6/PLAN-5.md

Tasks: 5 of 5

| Task | Commit | Note |
|---|---|---|
| 1 - defusedxml parse | 1342e893 | `parse_reply` uses `defusedxml.ElementTree.fromstring`, S314 noqa dropped; `ParseError`, `DefusedXmlException` and `LookupError` (unknown encoding, same cause, named in the commit) become `NotXmlError`, whose accepted type was widened. Bite: entity and bogus-encoding cases red against the pre-change source. |
| 2 - capped sweep | eb260c54 | `MAX_REPLIES = 32` (one daemon per machine, a handful per LAN), `MAX_BYTES = 64 KiB` (real reply about 110 bytes), values and basis beside them and in the commit. `_collect` awaits `sleep(0)` after every datagram, then checks the caps. Bite: removing the sleep and cap lines reds all three new tests (reply cap and dials, one sleep per read, byte cap). The silent-HQPlayer deadline test is unchanged and green. |
| 3 - owner-only file | 23dcb192 | `ConnectionStore.write` removes any leftover temp file, then creates it with `os.open(O_EXCL, 0o600)`; comment states the Windows limit. Both tests red against the pre-change source under umask 022. |
| 4 - dispositions | 7d019ced | Eight entries in `.planning/security/DISPOSITIONS.md`. Every hash resolves with `git cat-file -e`; 37 Python proof node ids collect (95 tests); JS proofs run under `node --test`; headings match REPORT.md; soft-wrap check passes. Python proofs were re-run in a temporary worktree at each fix commit's parent with the fix commit's test files: all red (assertion failures, except those listed in the F-017 note and the F-022 note, which fail at collection or as TypeError). |
| Fix pass (risk_surface, high) - discovery.py:142 | a87efb10 | `parse_reply` now converts `ValueError` (covers pyexpat's multi-byte refusal, `UnicodeError` for idna, and `DefusedXmlException`) as well as `ParseError` and `LookupError` into `NotXmlError`; unused `DefusedXmlException` import dropped. Two new cases (shift_jis, idna) red before the fix, green after; `make check` exit=0. |

Deviations: none

Open items:

- F-021's "Owner ruling" quote is the sentence recorded in PLAN-2 Task 1 and CONTEXT D-07, not text I saw the owner type; replace it if the owner wants other words.
- F-022's second "Owner ruling" quote is CONTEXT D-04's overrule text ("inside the image an answering alias is still adopted at startup as today; no offer").
- The F-017 proofs of `52689703`, `0f6745f2`, `f3a4d5f3` and `8e352b34` are red against the pre-fix code as collection ImportErrors; the assertion bite by mutation is in plan-4.md. `5b73a1e3` is a performance change with no failing test.
- Which commit answers which finding was decided here from the plans' goals and the REPORT remediations: `e9bc93e8` and `48bb275c` sit under F-023; `1282d44f` under both F-005 and F-015; `31a88dcc` under both F-015 and F-022.
- Full suite: `scripts/gate.sh make check` (workflow.test_command is null; the Makefile gate) printed exit=0 after the last code commit.
- Phase CI checkpoint (human-verify, AC7 CI half) is the owner's: push `dev`, read `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows`. Not run; the executor never pushes.
- Unstaged owner edits and untracked files under `.planning/` (plus `bug.png`, `.idle-last.*.json`) were left uncommitted.
- Declined fuller shapes: none.
- Fix pass left the medium finding (discovery.py:237, cap counts unparsed datagrams) unfixed per instruction.
