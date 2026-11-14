PLAN COMPLETE

Plan: .planning/phases/10/PLAN-1.md

Tasks: 3 of 3

| Task | Commit | Note |
|---|---|---|
| 1 - every remote action pinned, gate | d28a449b | gate `scripts/gates/check_supply_chain.py` + tests, wired in Makefile lint and pre-commit `supply-chain`; 36 refs pinned. Bite: null stub (module present, `action_failures`/`main` return zero values): 6 of 10 tests failed on assertion. Red on base export 1025d19c: 36 lines `file:N: owner/repo@vN is not pinned to a full 40-hex commit SHA`, exit 1. |
| 2 - uv pinned and checksum-checked | fe2e7edb | `scripts/ci/install-uv.sh` (uv 0.13.5, per-archive `.sha256` from the release); 3 astral.sh installs replaced; script added to `release.yml` push.paths; gate rule `pipe_failures`. Bite: null stub, 7 assertion failures. Red on base export: 3 own lines (`release.yml:49`, `:225`, `:330` "a downloaded script is piped into a shell"). Local run installed uv 0.13.5; corrupted-checksum run exited 1 ("FAILED", "did NOT match") with the install dir empty. Scratch removed. |
| 3 - filepawl pinned by commit | 13d92b35 | `ls-remote`: `afc25f98... refs/tags/v0.11.0`, `53d93f0807646d4a39a6e05378927ae0787817a8 refs/tags/v0.11.0^{}`. Dry resolution: `filepawl==0.11.0 (from git+...@53d93f08...)`. No test (install is the proof). |

Suite: `make test` (the offline suite, `not live and not e2e`) green, 55.1s; `make check` green on the same tree. A first suite attempt with `pytest -m "not live"` also collected `tests/e2e`, which errored on a missing Playwright chromium binary on this host (environmental, not this plan); `make test` was the run that counted.

Deviations:

- [deviation] Task 1/2 Verify says `actionlint` exits 0; it exits 1 on the base commit too, with one finding unrelated to this plan: `release.yml:285:21: label "xcode-27" is unknown` (smoke-macos matrix runner). Same single finding after this plan's edits, at line 283. Not fixed: the label is an owner choice and an `actionlint.yaml` config is outside the lease.

Open items:

- declined a YAML parse in the gate (no pyyaml/types-PyYAML added): a line scan meets every Verify and D-10 adds those deps only if YAML is parsed.
- declined a "tag as trailing comment" rule in the gate: the Verify checks the pin, the comments are written, and the gate is not asked to police them.
- pipe-to-shell rule scans one line at a time; a `curl ... \` continuation onto a `| sh` line is not seen.
- install-uv.sh extracts the Windows zip with `unzip`, falling back to `7z`; unverified on a Windows runner until CI runs `smoke-windows`.
- CI checks (check, smoke, smoke-macos, smoke-windows) not run: nothing pushed.
- `.pre-commit-config.yaml` and `.filepawl.toml` listed for Task 2 needed no edit (the gate reads no new input; filepawl printed no `accept`).
- base-commit export left at /tmp/sc-base.fEro96 (its path is in /tmp/sc-base-path): `rm -rf` is blocked for agents, so removal is the owner's.
