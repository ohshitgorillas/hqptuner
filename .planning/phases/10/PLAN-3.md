---
phase: 10
plan: 3
depends_on: [1, 2]
# Phase 10 maps no requirement ID (ROADMAP: "Requirements: None"); this plan closes F-034's job split, F-035, F-036, F-038 and F-041 (CONTEXT AC2, AC3).
requirements: []
files:
  - .github/workflows/docker.yml
  - .github/workflows/check.yml
  - .github/workflows/release.yml
  - hqptuner.spec
  - scripts/package-macos.sh
  - packaging/windows/simplysign-login.ps1
  - packaging/linux/smoke.sh
  - scripts/gates/check_supply_chain.py
  - tests/gates/test_supply_chain.py
  - .pre-commit-config.yaml
  - .filepawl.toml
---

# Phase 10: Release pipeline supply chain - Plan 3: Signing secrets meet only pinned code

## Goal

Findings F-034 to F-042 are each fixed or carry an owner ruling. This plan settles where secrets and write tokens live. The macOS build runs with no secrets, and a separate signing job runs no build code. Both signing jobs sit in `environment: signing` behind a passing check. Write permissions go only where something is pushed. The SimplySign installer is hash-checked and the TOTP seed leaves the environment before anything starts. Frozen bundles stop carrying eqlab's developer tree.

## Must be true when done

- `docker.yml` grants `contents: read` at workflow level and on its `check` call, `packages: write` sits on `build-push` alone, and `check.yml` declares top-level `permissions: contents: read`. The gate refuses `packages: write` anywhere else (D-14, AC2).
- `build-macos` references no secret and uploads the unsigned app. A new job in `environment: signing` downloads it, signs it, builds the dmg, notarizes and staples, and runs no PyInstaller and no venv Python. `smoke-macos` and `publish` depend on it. `hqptuner.spec` no longer signs (D-03, AC2).
- The macOS signing job and `package-windows` both name `environment: signing` and need a check job that runs on dev pushes as well as tags (D-04, AC2).
- `simplysign-login.ps1` compares the MSI's SHA-256 against a value pinned beside `$Version` before `msiexec`, and removes `SIMPLYSIGN_OTPAUTH_URI` from the process environment before its first `Start-Process` (D-16, AC2).
- A bundle frozen from `hqptuner.spec` holds no file under `vendor/eqlab/src`, `vendor/eqlab/tests`, `vendor/eqlab/.claude` or `vendor/eqlab/.git`, and still holds `vendor/eqlab/core`. The Linux smoke job fails a package that carries them (D-15, AC3).
- The gate exits non-zero for each rule this plan adds, pointed at the base-commit export.

## Context

- Locked: D-03 (macOS split), D-04 (signing environment admits `dev` and `v*` tags; both signing jobs wait on `make check` on dev pushes), D-05 (moving the `MACOS_*` and `NOTARY_*` secrets into `signing`, and its branch rule, are the owner's GitHub-settings actions), D-14 (permissions), D-15 (spec exclusion; `spa.py` gets no filter), D-16 (MSI hash, seed out of the environment; the offline proof is the gate, since `pwsh` is absent on this host).
- Until the owner moves the Apple secrets into `signing` (D-05), a job in that environment still reads them at repository level, so CI stays green either way.
- `upload-artifact` drops file modes and symlinks, and a frozen `.app` (`Contents/Frameworks`, `Contents/MacOS`) depends on both, so the app crosses jobs inside an archive that keeps them.
- `publish` downloads `pattern: macos-*`. The unsigned app's artifact name must not match it, so that only dmgs reach the release.
- The Windows signing step failed once with cause unknown (release run 42165957447, attempt 1; attempt 2 passed; phases/2/SUMMARY.md, phase 2). A single red `package-windows` is triaged before it is blamed on Task 5.


Red-run rule for every task in this plan: "red against the base-commit export" means the rule's OWN failure lines appear in the gate's output on that export, quoted by the executor. The gate's exit code alone proves nothing after Plan 1 Task 1, because the export's tag-pinned `uses:` refs already make it exit non-zero. A rule whose own lines do not appear against the pre-fix file it targets has not bitten, and the task is not done.

## Tasks

### Task 1: Write permissions go only to the job that pushes

- **Files:** .github/workflows/docker.yml, .github/workflows/check.yml, scripts/gates/check_supply_chain.py, tests/gates/test_supply_chain.py, .filepawl.toml
- **Reads:** .github/workflows/docker.yml#permissions, .github/workflows/docker.yml#check, .github/workflows/docker.yml#build-push, .github/workflows/check.yml
- **Decisions:** D-14, D-10
- **Action:** In `docker.yml`, set the workflow-level `permissions` to `contents: read` alone. Give the `check` call `permissions: contents: read`. Give `build-push` `contents: read` and `packages: write`: a job-level block replaces the workflow's, so `contents: read` has to be repeated there or checkout loses it. In `check.yml`, add top-level `permissions: contents: read`. Add the gate rule, tests first: across the workflows, `packages: write` appears only on `docker.yml`'s `build-push`, and `check.yml` declares top-level `contents: read`. It is red against the base-commit export. `docker.yml` does not run on `dev`, so the gate is this task's proof (D-14).
- **Verify:** Testing scope: the outcomes are "`packages: write` at workflow level fails", "`packages: write` on any job but `build-push` fails", "`check.yml` without top-level `contents: read` fails" and "the real tree passes". These cases and the base-commit red run are sufficient. The gate and its tests print `exit=0` through `scripts/gate.sh`. `actionlint` exits 0. `scripts/gate.sh make check` prints `exit=0`. CI: `check` passes on the pushed commit under its new token scope (ci: check).

### Task 2: macOS signing moves out of the PyInstaller freeze

- **Files:** hqptuner.spec, scripts/package-macos.sh, .github/workflows/release.yml
- **Reads:** hqptuner.spec#codesign_identity, hqptuner.spec#EXE, scripts/package-macos.sh#json_field, scripts/package-macos.sh#MACHINE, scripts/package-windows.sh, packaging/macos/entitlements.plist
- **Decisions:** D-03
- **Action:** Drop `codesign_identity`, `entitlements_file` and the comment above them from `hqptuner.spec`, so the freeze never signs with an identity; PyInstaller's own ad-hoc signing stays. Split `scripts/package-macos.sh` into a freeze stage and a sign stage, chosen by an argument the way `scripts/package-windows.sh` takes `installer`. With no argument it runs both, so a local run still works end to end. The freeze stage runs PyInstaller and leaves `dist/HQPTuner.app`. The sign stage takes that app and runs no PyInstaller and no Python of the venv. It signs the app with the Developer ID identity, the hardened runtime, `packaging/macos/entitlements.plist` and a timestamp, nested code first so that notarization accepts it. Then it builds the dmg, signs it, notarizes and staples as today. So the sign stage gets the architecture from the app's main executable or from an argument instead of `"$PYTHON" -c 'import platform ...'`, and the notary JSON is read with a tool that ships with macOS (`plutil`) or the runner (`jq`), not `json_field`'s `"$PYTHON"`. Keep `retry_on`, `stapler` and the notary poll loop as they are: their comments record why each exists. In `release.yml`, `build-macos` calls both stages in order for now, still with its secrets. Task 3 moves the sign stage to its own job, so each commit here keeps `smoke-macos --notarized` green.
- **Verify:** Testing scope: the outcomes are "the spec has no identity path", "the sign stage starts no Python and no PyInstaller" and "the signed, notarized dmg still passes Gatekeeper". The last is what `packaging/macos/smoke.sh --notarized` already checks (step 1 `spctl`, `stapler validate`; step 2 `codesign --verify --deep --strict`), so no test is added. `grep -nE 'codesign_identity|entitlements_file' hqptuner.spec` prints nothing. `shellcheck scripts/package-macos.sh` exits 0. In the sign stage's code path, `grep -nE 'PYTHON|PyInstaller|\.venv' ` matches nothing (the executor quotes the stage's line range). A local Linux freeze from the edited spec into a scratch directory succeeds and is removed after. Footprint: about one core for one to two minutes and under 1 GB, named before it runs. `scripts/gate.sh make check` prints `exit=0`. CI: `smoke-macos` passes on the pushed commit on all five rows (ci: smoke-macos).

### Task 3: The macOS build holds no secrets, and a separate job signs

- **Files:** .github/workflows/release.yml, scripts/gates/check_supply_chain.py, tests/gates/test_supply_chain.py, .filepawl.toml
- **Reads:** .github/workflows/release.yml#build-macos, .github/workflows/release.yml#smoke-macos, .github/workflows/release.yml#publish, .github/workflows/release.yml#package-windows
- **Decisions:** D-03, D-05, D-10
- **Action:** `build-macos` keeps its matrix, checks out with submodules, installs from the lock, runs the freeze stage, archives `dist/HQPTuner.app` in a form that keeps symlinks and modes (`ditto -c -k --keepParent`, or `tar`), and uploads it under a name `publish`'s `macos-*` pattern does not match. It loses every `secrets.` reference and both keychain steps. Add one new job per architecture, `environment: signing`, on a macOS runner. It checks out the scripts without submodules and installs no Python packages. It downloads and unpacks the app, then runs the certificate and notary-key import step moved from `build-macos` unchanged. It runs the sign stage with the notary env and the removal step (`if: always()`) moved the same way, and uploads the dmg as `macos-<arch>`, the name `smoke-macos` and `publish` already read. Point `smoke-macos`'s `needs` at the new job, and replace `build-macos` with it in `publish`'s `needs` (D-03). The new job's `needs` is `build-macos` here; Task 4 adds the check. Add the gate rules, tests first: `build-macos` holds no `secrets.` reference, and a job that imports the Apple signing secrets names `environment: signing`. Both are red against the base-commit export. The owner's half, moving `MACOS_CERT_P12_BASE64`, `MACOS_CERT_PASSWORD`, `NOTARY_KEY_P8_BASE64`, `NOTARY_KEY_ID` and `NOTARY_ISSUER_ID` into the `signing` environment, goes in Plan 5's F-034 and F-035 entries as a Note (D-05).
- **Verify:** Testing scope: the outcomes are "a secret in `build-macos` fails", "an Apple-secret job without `environment: signing` fails", "no macOS signing job at all fails" and "the real tree passes". These cases and the base-commit red run are sufficient, and the CI run proves the topology works. The gate and its tests print `exit=0` through `scripts/gate.sh`. `actionlint` exits 0. `grep -n 'secrets\.' ` over the `build-macos` job's lines prints nothing. `scripts/gate.sh make check` prints `exit=0`. CI: `smoke-macos` passes on all five rows on the pushed commit, so the dmgs the new job signed pass `--notarized` (ci: smoke-macos).

### Task 4: Both signing jobs wait on a passing check on dev pushes too

- **Files:** .github/workflows/release.yml, scripts/gates/check_supply_chain.py, tests/gates/test_supply_chain.py, .filepawl.toml
- **Reads:** .github/workflows/release.yml#tag-check, .github/workflows/release.yml#package-windows, .github/workflows/check.yml
- **Decisions:** D-04, D-05, D-10
- **Action:** D-04 leaves two ways open. This task drops `tag-check`'s tag-only `if`, so the call to `check.yml` runs on every trigger of `release.yml`: dev pushes on the listed paths, tags and dispatch. It accepts D-04's cost that `check` runs twice on a dev push touching those paths. The other way, a second dev-push-only call, adds a job for the same result. Rewrite the comment above the job to say what it now gates. Keep a job name distinct from `check`: commit `24fb2153` renamed it away from `check` to keep it apart from the required job. Add it to the `needs` of `package-windows` and of Task 3's macOS signing job. `publish` already needs it. Add the gate rule, tests first: every job naming `environment: signing` needs a job that calls `./.github/workflows/check.yml` with no `if` restricting it to tags. Add a second rule beside it: every job that reads a signing secret (`SIMPLYSIGN_*`, `MACOS_*`, `NOTARY_*`, and the GPG secrets Plan 4 adds) names `environment: signing`, and `package-windows` and the macOS signing job are named explicitly, so deleting the environment line from either fails the gate. Its test case is `package-windows` with `environment: signing` removed. It is red against the base-commit export. A `workflow_dispatch` on a branch other than `dev` now stops at the environment's branch rule once the owner sets it; D-04 accepted that.
- **Verify:** Testing scope: the outcomes are "a signing job without the check in `needs` fails", "a check limited to tags fails" and "the real tree passes". These cases and the base-commit red run are sufficient. The gate and its tests print `exit=0` through `scripts/gate.sh`. `actionlint` exits 0. `scripts/gate.sh make check` prints `exit=0`. CI: on the pushed dev commit, the release run shows `tag-check` (or its kept name) completing before `package-windows` and the macOS signing job start, and `smoke-macos` and `smoke-windows` pass (ci: smoke-macos, smoke-windows).

### Task 5: The SimplySign installer is hash-checked, and the seed leaves the environment first

- **Files:** packaging/windows/simplysign-login.ps1, scripts/gates/check_supply_chain.py, tests/gates/test_supply_chain.py, .pre-commit-config.yaml, .filepawl.toml
- **Reads:** packaging/windows/simplysign-login.ps1#Get-SeedField, packaging/windows/simplysign-login.ps1#$Version, .github/workflows/release.yml#package-windows
- **Decisions:** D-16, D-10
- **Action:** Pin the MSI's SHA-256 in a variable beside `$Version` and `$Installer`, using the value the owner supplies (Notes, human setup 1). Never compute it here: D-16 says it comes from a download the owner or a CI run makes. After `Invoke-WebRequest` and before `msiexec`, compare `Get-FileHash -Algorithm SHA256` of the file against it, and `Fail` with both values on a mismatch. Read `SIMPLYSIGN_OTPAUTH_URI` into a script variable once. `Get-SeedField` and the `-notlike 'otpauth://totp/*'` check then read that variable instead of `$env:`. Remove the variable from the process environment (`Remove-Item Env:SIMPLYSIGN_OTPAUTH_URI`) before `Say '[1/4] install SimplySign Desktop'`, so neither `msiexec` nor the app inherits it. `SIMPLYSIGN_EMAIL` stays as it is: D-16 names the seed only. Keep the RFC vector self-check and the "refused / no certificate" wording. Add the gate rules, tests first: in the script, a SHA-256 comparison precedes the line that runs `msiexec`, and removal of `SIMPLYSIGN_OTPAUTH_URI` precedes the first `Start-Process`. Both are red against the base-commit export. Add the script to the gate's pre-commit `files:`.
- **Verify:** Testing scope: the outcomes are "no hash check before `msiexec` fails", "a hash check after it fails", "removal after the first `Start-Process` fails", "no removal fails" and "the real script passes". `pwsh` is absent here (`command -v pwsh` prints nothing), so these literal-script cases are the offline proof D-16 names. The gate and its tests print `exit=0` through `scripts/gate.sh`. `grep -in 'env:SIMPLYSIGN_OTPAUTH_URI' packaging/windows/simplysign-login.ps1` shows only the one read and the removal. `scripts/gate.sh make check` prints `exit=0`. CI: `package-windows` and `smoke-windows` pass on the pushed commit (ci: smoke-windows). If the runner already carries SimplySign Desktop, the download branch does not run, and the hand-back says so from the step log's `[1/4]` output.

### Task 6: Frozen bundles leave out eqlab's developer tree

- **Files:** hqptuner.spec, packaging/linux/smoke.sh, scripts/gates/check_supply_chain.py, tests/gates/test_supply_chain.py, .pre-commit-config.yaml, .filepawl.toml
- **Reads:** hqptuner.spec#Analysis, pyproject.toml#tool.setuptools.exclude-package-data, .dockerignore, packaging/linux/smoke.sh
- **Decisions:** D-15, D-10
- **Action:** Make the spec's `static` data leave out `vendor/eqlab/src`, `vendor/eqlab/tests`, `vendor/eqlab/.claude` and `vendor/eqlab/.git`, the four paths `pyproject.toml`'s `exclude-package-data` already names. Keep `vendor/eqlab/core` and everything else under `hqptuner/static`. Filtering the collected data after `Analysis`, or building the `datas` list with those directories skipped, are both fine: one place names the four paths. `hqptuner/api/spa.py` gets no filter (D-15). In `packaging/linux/smoke.sh` step 2 "installed files", fail when the installed tree under `/opt/hqptuner` holds any of the four, wherever PyInstaller put `static` in the bundle, and keep the existing two checks. That is AC3's CI proof. Add the gate rule, tests first: the spec names all four exclusions. It is red against the base-commit export. Add `hqptuner.spec` to the gate's pre-commit `files:` if Plan 3 Task 2 did not.
- **Verify:** Testing scope: the outcomes are "a bundle without the four paths", "a bundle that still serves `core`" and "a smoke run that fails on a package with them". The gate cases cover the spec text. One local freeze proves the bundle. The smoke assertion is proved by its CI run and by one local run of the new check against a scratch tree. `scripts/gate.sh` runs of the gate and its tests print `exit=0`. Footprint, named before it runs: a local freeze from the spec into a scratch directory takes about one core for one to two minutes and under 1 GB. Then `find <scratch>/dist/HQPTuner -path '*vendor/eqlab/*' \( -path '*/src/*' -o -path '*/tests/*' -o -path '*/.claude/*' -o -path '*/.git*' \)` prints nothing, `find <scratch>/dist/HQPTuner -path '*vendor/eqlab/core/*' -type f | head -1` prints a file, and the scratch directory is removed. The same freeze from the base commit's spec shows `src/` files, which is the bite. `shellcheck packaging/linux/smoke.sh` exits 0. `scripts/gate.sh make check` prints `exit=0`. CI: all eight `smoke` rows pass on the pushed commit (ci: smoke).

## Notes

- Human setup 1 (blocks Task 5): the SHA-256 of `SimplySignDesktop-9.4.4.92-64-bit-en.msi` from the URL in `simplysign-login.ps1`. The owner downloads the file and runs `sha256sum` on it, or reads it from a CI run that prints it. CONTEXT flags this hash as unknown. Without it, Task 5 stops at its first step with a blocking question.
- The settings halves are the owner's, in GitHub settings (D-05): the five Apple secrets move into the `signing` environment, and `signing`'s deployment branch rule admits `dev` and `v*` tags only. Plan 5 records each as a Note in its finding's entry.
