---
phase: 10
plan: 1
# Phase 10 maps no requirement ID (ROADMAP: "Requirements: None"); this plan closes F-039 and the remote-code pins of F-034, F-037 and F-042 (CONTEXT AC1).
requirements: []
files:
  - scripts/gates/check_supply_chain.py
  - tests/gates/test_supply_chain.py
  - Makefile
  - .pre-commit-config.yaml
  - pyproject.toml
  - .filepawl.toml
  - .github/workflows/release.yml
  - .github/workflows/docker.yml
  - .github/workflows/check.yml
  - scripts/ci/install-uv.sh
---

# Phase 10: Release pipeline supply chain - Plan 1: The offline gate and the remote-code pins

## Goal

Findings F-034 to F-042 are each fixed or carry an owner decision. This plan lands the phase's one offline gate and the pins on remote code that CI fetches by name: every action by commit SHA, uv by version and checksum, filepawl by commit.

## Must be true when done

- `make check` and pre-commit both run a new gate, `scripts/gates/check_supply_chain.py`, and `scripts/gates/check_gates_wired.py` reports it wired (D-10).
- Every remote `uses:` in `release.yml`, `docker.yml` and `check.yml` names a full 40-hex commit SHA with its tag as a trailing comment; the two local `./.github/workflows/check.yml` calls stay as they are; the gate refuses a workflow that names a remote action by tag (D-07, AC1).
- No workflow pipes a download into a shell (`curl | sh`, `irm | iex`); every release build job gets uv at a pinned version whose archive was checked against its published SHA-256 before it ran, and the gate refuses a pipe-to-shell install (D-12, AC1).
- `pyproject.toml` names filepawl by commit `53d93f0807646d4a39a6e05378927ae0787817a8`, confirmed against GitHub first (D-13).
- Pointed at an export of the phase's base commit (the last commit before this plan's Task 1 lands), the gate exits non-zero for each rule this plan adds.

## Context

- Locked: D-07 (SHA pins, tag comment, local calls stay), D-10 (proof vehicle, YAML deps if YAML is parsed), D-12 (pinned, checksum-verified uv following the nfpm `checksums.txt` pattern at `release.yml` "Install nfpm"), D-13 (filepawl commit).
- Pattern to follow: `scripts/gates/check_container_env.py` (pure seams over source text, `main(argv)` taking paths with repo defaults) and `tests/gates/test_container_env.py` (cases drive the seams on literal strings, gate loaded by file path). Wiring pattern: the `container-env` hook in `.pre-commit-config.yaml` and the `lint` target in `Makefile`.
- Out of scope here: the lock (Plan 2), job topology and secrets (Plan 3), signing (Plan 4), triviajudge (declined, D-06), dependabot (Plan 2, after the lock exists).
- Comments and docstrings in the gate say what each rule protects, never a finding id or the history behind it: `triviajudge-archaeology` runs over `scripts/` in `make check`.


Red-run rule for every task in this plan: "red against the base-commit export" means the rule's OWN failure lines appear in the gate's output on that export, quoted by the executor. The gate's exit code alone proves nothing after Plan 1 Task 1, because the export's tag-pinned `uses:` refs already make it exit non-zero. A rule whose own lines do not appear against the pre-fix file it targets has not bitten, and the task is not done.

## Tasks

### Task 1: Every remote action is pinned by commit, and a gate keeps it so

- **Files:** scripts/gates/check_supply_chain.py, tests/gates/test_supply_chain.py, Makefile, .pre-commit-config.yaml, pyproject.toml, .filepawl.toml, .github/workflows/release.yml, .github/workflows/docker.yml, .github/workflows/check.yml
- **Reads:** scripts/gates/check_container_env.py#main, tests/gates/test_container_env.py#_load_gate_module, scripts/gates/check_gates_wired.py#check, .pre-commit-config.yaml#container-env, Makefile#lint
- **Decisions:** D-07, D-10
- **Pins:** tests/gates/test_gates_wired.py
- **Action:** Create the phase's one offline gate as `scripts/gates/check_supply_chain.py`, shaped like `check_container_env.py`: pure functions over source text that return the failure lines, and a `main(argv)` whose default inputs are this repo's files and which can be pointed at another checkout's root, so the red run can aim it at an export of the base commit. Its first rule: every `uses:` in every workflow under `.github/workflows/` that names a remote action carries a full 40-hex commit SHA; a local `./` reference passes. Write its tests first in `tests/gates/test_supply_chain.py` (driving the seams on literal workflow strings, per D-10). The module is new, so the bite is the null stub per `docs/testing.md` rule 8: name it in the hand-back. If the gate parses YAML, add `pyyaml` and `types-PyYAML` to the `dev` extras (D-10); a text scan needs neither. Wire it into the `Makefile` `lint` target and add a pre-commit hook like `container-env`, its `files:` pattern covering the workflow directory and every input later tasks add. Then pin all 36 remote refs to the commit SHA (D-07 counts 11 actions; `grep -ho 'uses: [^.][^@]*' .github/workflows/*.yml | sort -u` lists 10 distinct ones today, and every one of the 36 refs is pinned whichever count holds) their current tag resolves to, with the tag as a trailing comment (D-07). Resolve each through `git ls-remote` or `gh api`, and take the peeled commit (`^{}`) of an annotated tag, never the tag object's own SHA, which GitHub refuses to run. Where the major tag in use (`v5`) points at the same commit as a full release tag (`v5.0.0`), write the full release tag in the comment: that is the form Dependabot rewrites. Run `filepawl accept` whenever filepawl prints it.
- **Verify:** Testing scope: the outcomes are "a remote ref by tag or short SHA fails, naming the file and the ref", "a 40-hex ref passes", "a local `./` call passes" and "the real tree passes"; nothing existing covers any of them, so these few literal-string cases plus the real-tree run are sufficient, and testing stops there. `scripts/gate.sh .venv/bin/pytest tests/gates/test_supply_chain.py -q` prints `exit=0`. `scripts/gate.sh .venv/bin/python scripts/gates/check_supply_chain.py` prints `exit=0`. The same gate pointed at `git archive <base> | tar -x -C <scratch>` exits non-zero and names the unpinned refs. `grep -c 'uses: [^.]' .github/workflows/*.yml` totals 36 and every one of those lines matches `@[0-9a-f]{40} # `. `actionlint` exits 0. `scripts/gate.sh .venv/bin/python scripts/gates/check_gates_wired.py` prints `exit=0`. `scripts/gate.sh make check` prints `exit=0`. CI: `check` passes on the pushed commit (ci: check).

### Task 2: Release build jobs install uv at a pinned version, checked against its SHA-256

- **Files:** scripts/ci/install-uv.sh, .github/workflows/release.yml, scripts/gates/check_supply_chain.py, tests/gates/test_supply_chain.py, .pre-commit-config.yaml, .filepawl.toml
- **Reads:** .github/workflows/release.yml#Install nfpm, .github/workflows/release.yml#build-macos, .github/workflows/release.yml#build-windows
- **Decisions:** D-12, D-10
- **Action:** Replace the three astral.sh installs in `release.yml` (`curl | sh` in `build` and `build-macos`, `irm | iex` in `build-windows`) with one bash script, `scripts/ci/install-uv.sh`, that every job calls. It downloads the uv release archive for the runner's platform at one pinned version from astral-sh/uv's GitHub release, fetches the SHA-256 that release publishes for that archive, checks it before extracting (`sha256sum -c`, or `shasum -a 256 -c` where there is no `sha256sum`), and puts uv on the job's path. This follows the nfpm step's pattern. A mismatch, a missing checksum line or an unknown platform fails the step. Pin a uv version no older than the host's (`uv --version` reads 0.13.5), so Plan 2's lock reads the same on both sides. The `build-windows` job's default shell is already bash. Add the script's path to `release.yml`'s `push.paths`, so an edit to it triggers a dev run. Add a gate rule, tests first: no workflow pipes a fetched script into a shell interpreter (`curl ... | sh`, `| bash`, `irm ... | iex`, `Invoke-RestMethod ... | Invoke-Expression`), and the rule is red against the gate as Task 1 left it. Avoid a pinned checksum that disagrees with the published one: the source of truth is the release's own checksum file, as D-12 says.
- **Verify:** Testing scope: the outcomes are "each pipe-to-shell spelling fails" and "the real tree passes"; the existing nfpm step is the passing shape. A case per spelling, plus the real tree and the base-commit red run, is sufficient. `shellcheck scripts/ci/install-uv.sh` exits 0. Running `bash scripts/ci/install-uv.sh` on this Linux host, into a scratch directory under `${CLAUDE_SCRATCH:-/tmp}`, leaves a uv whose `--version` is the pinned one. Running it again with the archive's checksum line corrupted, through whatever seam the script exposes or by editing a scratch copy, exits non-zero before extracting. The scratch directory is removed after. `grep -nE 'astral.sh|\| *(sh|bash|iex)\b' .github/workflows/*.yml` prints nothing. The gate and its tests print `exit=0` through `scripts/gate.sh`, and the gate exits non-zero against the base-commit export. `actionlint` exits 0. `scripts/gate.sh make check` prints `exit=0`. CI: `smoke`, `smoke-macos` and `smoke-windows` pass on the pushed commit, so all three platforms took uv this way (ci: smoke, smoke-macos, smoke-windows).

### Task 3: filepawl is pinned by commit

- **Files:** pyproject.toml
- **Reads:** pyproject.toml#project.optional-dependencies
- **Decisions:** D-13, D-08
- **Action:** Confirm with `git ls-remote https://github.com/ohshitgorillas/filepawl.git 'refs/tags/v0.11.0*'` that the tag's peeled commit is `53d93f0807646d4a39a6e05378927ae0787817a8`, then change the filepawl requirement in the `dev` extras from `@v0.11.0` to `@53d93f0807646d4a39a6e05378927ae0787817a8`. Keep the `[mv]` extra and the comment above it. If `ls-remote` disagrees with D-13's SHA, stop and raise it as a blocking question quoting both SHAs: the pin is the owner's decision, and the local clone may have drifted. Leave the dev host's editable filepawl in `.venv` as it is (D-08): no reinstall.
- **Verify:** Testing scope: one outcome, "the pinned requirement resolves to that commit", which the install itself proves; no test is added. The `ls-remote` output is quoted in the hand-back. `uv pip install --dry-run --python 3.14 --target "${CLAUDE_SCRATCH:-/tmp}/fp-check" "filepawl[mv] @ git+https://github.com/ohshitgorillas/filepawl.git@53d93f0807646d4a39a6e05378927ae0787817a8"` resolves (or an equivalent dry resolution) and names that commit, after which the scratch path is removed. `grep -n 'filepawl' pyproject.toml` shows the 40-hex SHA and no `@v0.11.0`. `scripts/gate.sh make check` prints `exit=0`. CI: `check` passes (ci: check).

## Notes

- Every plan in this phase shares the workflows and the gate, so the plans run in order: 1, 2, 3, 4, 5.
- The two `./.github/workflows/check.yml` calls are the "2 local calls" D-07 keeps. Plan 4 adds one remote action (`sigstore/cosign-installer`), and Task 1's rule covers it when it lands.
