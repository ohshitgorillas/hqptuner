---
status: testing
phase: 10
fields_version: 1
started: 2026-11-15
updated: 2026-11-15
ci: f494fab5b9da75cac0bcde19d652fec1506474ed
---

## Items

### 1. Clean-start: a fresh install boots and serves
expected: The smoke job installs the deb and rpm in fresh distro containers, the service starts from clean state and /api/health answers (ci: smoke)
origin: smoke
status: pass
job: smoke
commit: f494fab5b9da75cac0bcde19d652fec1506474ed
first_pass: fail
source: model
evidence: smoke concluded success at f494fab5b9da75cac0bcde19d652fec1506474ed
cause: smoke concluded skipped at 804cf3b31b31360b331589315bd6a572e1aa07e7: package-linux (arm64) failed: nfpm "Signing error: armored detach sign: decoding armored PGP keyring: openpgp: invalid argument: no armored data found"; amd64 cancelled

### 2. Supply-chain gate bites and is wired in
expected: scripts/gates/check_supply_chain.py exits non-zero on the pre-fix tree and 0 on the last dev commit, runs in make check and pre-commit, and confirms 40-hex SHA pins on every remote uses:, lock-only Python installs in check.yml and every release build job (triviajudge excepted), @sha256: digests on the Dockerfile base and almalinux:8 build container, and no curl | sh or irm | iex
criterion: AC1
status: pass
first_pass: pass
source: verifier
evidence: Gate exit 0 at HEAD (`[ok] all 3 workflows and the Dockerfile pin their remote code`). The same checks run in memory over the base commit 1025d19c exports give 64 problems (36 unpinned actions, 7 unlocked installs, 3 pipe-to-shell, 2 undigested images, and more). Wired at Makefile:23 and .pre-commit-config.yaml:315-320; check_gates_wired `[ok]`; tests/gates/test_supply_chain.py 157 passed. Lock-only installs (uv sync --locked) in check.yml and the build, build-macos and build-windows jobs, with triviajudge the one exception; `uv lock --check --offline` exit 0.

### 3. Signing jobs, permissions and SimplySign hardening hold
expected: On the same gate run: build-macos has no secret reference; the macOS signing job and package-windows both name environment: signing and need a passing check on dev pushes; packages: write appears only on docker.yml's push jobs; check.yml declares contents: read; simplysign-login.ps1 compares the MSI SHA-256 before msiexec and removes SIMPLYSIGN_OTPAUTH_URI before its first Start-Process
criterion: AC2
status: pass
first_pass: pass
source: verifier
evidence: Same gate run at exit 0, with each rule flagged at the base commit. build-macos has no secrets; sign-macos and package-windows are in environment: signing and need `tag-check`, which has no `if:`. packages: write appears only on build-push and sign-image (owner-approved option A). check.yml has `contents: read` at the top. In simplysign-login.ps1, Get-FileHash plus `-ne $InstallerSha256` come before msiexec, and `Remove-Item Env:SIMPLYSIGN_OTPAUTH_URI` comes before the first Start-Process.

### 4. Frozen bundle carries no eqlab developer tree
expected: A bundle frozen from hqptuner.spec contains no file under vendor/eqlab/src, vendor/eqlab/tests, vendor/eqlab/.claude or vendor/eqlab/.git (ci: smoke)
criterion: AC3
status: pass
first_pass: pass
source: verifier
evidence: hqptuner.spec:25-30,67-69 filter a.datas by the four paths. With PyInstaller 6.22.2, expanding `("hqptuner/static", "static")` and applying that filter takes 70 eqlab entries to 15, all under core/ or package.json. packaging/linux/smoke.sh:31-37 guards the installed tree in the CI smoke job.

### 5. Release checksums, package signatures and image signatures verify
expected: A v* tag release publishes a SHA-256 checksum file covering every asset; its deb and rpm verify against the published GPG key; its images pass cosign verify (human-verify: needs a v* tag release; owner decision: verified at the next release, pending until then)
criterion: AC4
status: pending
first_pass: fail
source: model
evidence: release.yml `publish` (SHA256SUMS), packaging/linux/nfpm.yaml:35-36,43-44 (signature blocks), docker.yml `sign-image` (cosign sign) exist. scripts/gates/check_supply_chain.py checks only where COSIGN_/RELEASE_GPG_ secrets sit (cosign_failures, secret_failures), not that the signing steps exist. tests/ and scripts/gates/ have no assertion on SHA256SUMS, nfpm `signature:` or `cosign sign` beyond the placement fixture at test_supply_chain.py:544. No CI job verifies a signature after it is made.
reported: behavior unexercised: no automated check covers the checksum file, the deb/rpm GPG signatures or the cosign signatures. Deleting any of them leaves every gate and test green. The end-to-end proof waits on a v* release by owner decision.
severity: major
cause: scripts/gates/check_supply_chain.py checks only where COSIGN_ and RELEASE_GPG_ secrets sit, never that release.yml publish writes SHA256SUMS, that packaging/linux/nfpm.yaml carries rpm and deb signature blocks, or that docker.yml sign-image runs cosign sign; no CI job verifies a signature after it is made. Removing any of the three leaves every gate green.
fix: 06990f15, retest

### 6. Dispositions recorded for F-034 to F-042
expected: .planning/security/DISPOSITIONS.md has one entry each for F-034 to F-042; each fixed part names its commit and a proof that fails against the pre-fix code; the triviajudge decline quotes the owner's decision; each GitHub-settings half names the owner's action in a Note
criterion: AC5
status: pass
first_pass: fail
source: model
evidence: At 804cf3b3: .planning/security/DISPOSITIONS.md holds 9 entries F-034 to F-042 (grep -c 9). F-042 names the gate rule holding the filepawl pin with its base-export line `pyproject.toml: git+https://github.com/ohshitgorillas/filepawl.git@v0.11.0 is not pinned to a full 40-hex commit`; F-040 names 06990f15, its tests and 7 base-export gate lines, and quotes the owner decision on the setup clauses; F-035 quotes the owner approval; the triviajudge decline quotes D-06; settings halves carry Notes. scripts/gate.sh pytest tests/gates/test_release_signatures.py: 43 passed; gate `[ok]`.
reported: behavior wrong. Two fixed parts carry no proof that fails against the pre-fix code, and some remediation clauses carry neither a fix nor a quoted owner decision (ROADMAP criteria 1 and 3, AC5).
severity: major
cause: DISPOSITIONS.md F-042's filepawl pin has no proof (the gate never reads pyproject.toml); F-040's fixed parts have no proof that fails against 1025d19c (same gap as item 5); F-040's signed-checksum clause and its compose.yaml, :latest, Watchtower and root-maintainer-script clauses carry neither a fix nor an owner decision; F-035's widening to package-linux and sign-image quotes no owner words.
fix: 06990f15 804cf3b3, retest

### 7. make check and the required CI jobs are green
expected: make check is green, and check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos and smoke-windows pass on the phase's last dev commit (ci: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows)
criterion: AC6
status: pass
job: check
commit: 804cf3b31b31360b331589315bd6a572e1aa07e7
first_pass: pass
source: model
evidence: check concluded success at 804cf3b31b31360b331589315bd6a572e1aa07e7 (run 43671984003); local scripts/gate.sh make check exit=0 log=/tmp/gate-make-131cdmAO.log

### 8. The release commit leaves uv.lock stale, so every `uv sync --locked` fails on the next release
expected: behavior wrong. scripts/bump.sh bumps the pyproject.toml version but never re-locks, and uv.lock records the project's version, so CI, the release builds and the image go red on the first release commit after this phase.
origin: verifier
status: pass
first_pass: fail
source: model
evidence: At a53735b5: scripts/gate.sh .venv/bin/pytest tests/gates/test_release_preflight.py -> exit=0, 4 passed, including test_the_release_commit_carries_a_lock_that_matches_its_version, which failed by assertion without the fix (`assert '1.2.3' == '1.2.4'`).
reported: behavior wrong. scripts/bump.sh bumps the pyproject.toml version but never re-locks, and uv.lock records the project's version, so CI, the release builds and the image go red on the first release commit after this phase.
severity: major
cause: The release bump script (scripts/bump.sh lines 104-106) rewrites the version in pyproject.toml, hqptuner/__init__.py and CHANGELOG.md and commits at line 120 without running uv lock, while uv.lock:665-667 records hqptuner version 1.20.1; the release commit's uv sync --locked steps (check.yml check and e2e, release.yml build jobs, Dockerfile:18,21) then fail.
fix: a53735b5, retest

### 9. Required CI job e2e passes
expected: The e2e job passes on the phase's last dev commit (ci: e2e)
criterion: AC6
status: pass
job: e2e
commit: 804cf3b31b31360b331589315bd6a572e1aa07e7
first_pass: pass
source: model
evidence: e2e concluded success at 804cf3b31b31360b331589315bd6a572e1aa07e7 (release run 43671984140, tag-check / e2e)

### 10. Required CI job smoke passes
expected: The smoke job passes on the phase's last dev commit (ci: smoke)
criterion: AC6
status: pass
job: smoke
commit: f494fab5b9da75cac0bcde19d652fec1506474ed
first_pass: fail
source: model
evidence: smoke concluded success at f494fab5b9da75cac0bcde19d652fec1506474ed
cause: smoke concluded skipped at 804cf3b31b31360b331589315bd6a572e1aa07e7: package-linux (arm64) failed: nfpm "Signing error: armored detach sign: decoding armored PGP keyring: openpgp: invalid argument: no armored data found"; amd64 cancelled

### 11. Required CI job lifecycle-deb passes
expected: The lifecycle-deb job passes on the phase's last dev commit (ci: lifecycle-deb)
criterion: AC6
status: pass
job: lifecycle-deb
commit: f494fab5b9da75cac0bcde19d652fec1506474ed
first_pass: fail
source: model
evidence: lifecycle-deb concluded success at f494fab5b9da75cac0bcde19d652fec1506474ed
cause: lifecycle-deb concluded skipped at 804cf3b31b31360b331589315bd6a572e1aa07e7: package-linux (arm64) failed: nfpm "Signing error: armored detach sign: decoding armored PGP keyring: openpgp: invalid argument: no armored data found"; amd64 cancelled

### 12. Required CI job lifecycle-rpm passes
expected: The lifecycle-rpm job passes on the phase's last dev commit (ci: lifecycle-rpm)
criterion: AC6
status: pass
job: lifecycle-rpm
commit: f494fab5b9da75cac0bcde19d652fec1506474ed
first_pass: fail
source: model
evidence: lifecycle-rpm concluded success at f494fab5b9da75cac0bcde19d652fec1506474ed
cause: lifecycle-rpm concluded skipped at 804cf3b31b31360b331589315bd6a572e1aa07e7: package-linux (arm64) failed: nfpm "Signing error: armored detach sign: decoding armored PGP keyring: openpgp: invalid argument: no armored data found"; amd64 cancelled

### 13. Required CI job smoke-macos passes
expected: The smoke-macos job passes on the phase's last dev commit (ci: smoke-macos)
criterion: AC6
status: pass
job: smoke-macos
commit: f494fab5b9da75cac0bcde19d652fec1506474ed
first_pass: fail
source: model
evidence: smoke-macos concluded success at f494fab5b9da75cac0bcde19d652fec1506474ed (5 rows), after f494fab5
cause: smoke-macos concluded skipped at 804cf3b31b31360b331589315bd6a572e1aa07e7: both build-macos jobs failed in scripts/package-macos.sh freeze with 'scripts/package-macos.sh: line 116: syntax error near unexpected token echo'. macOS /bin/bash 3.2 misparses the case pattern *Mach-O*) inside the <( ) substitution added by 59a838d7; bash 5 accepts it (bash -n exit 0).

### 14. Required CI job smoke-windows passes
expected: The smoke-windows job passes on the phase's last dev commit (ci: smoke-windows)
criterion: AC6
status: pass
job: smoke-windows
commit: f494fab5b9da75cac0bcde19d652fec1506474ed
first_pass: pass
source: model
evidence: smoke-windows concluded success at f494fab5b9da75cac0bcde19d652fec1506474ed (3 rows)

## Summary

total: 14
passed: 13
failed: 0
pending: 1
skipped: 0
blocked: 0
reworked: 8
