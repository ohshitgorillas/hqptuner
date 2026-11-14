---
phase: 10
plan: 2
depends_on: [1]
# Phase 10 maps no requirement ID (ROADMAP: "Requirements: None"); this plan closes F-037, F-042's lock half and F-034's install half (CONTEXT AC1).
requirements: []
files:
  - pyproject.toml
  - uv.lock
  - CONTRIBUTING.md
  - .github/workflows/check.yml
  - .github/workflows/release.yml
  - Dockerfile
  - .github/dependabot.yml
  - scripts/gates/check_supply_chain.py
  - tests/gates/test_supply_chain.py
  - .pre-commit-config.yaml
  - .filepawl.toml
---

# Phase 10: Release pipeline supply chain - Plan 2: One hashed lock for CI, the release builds and the image

## Goal

Findings F-034 to F-042 are each fixed or carry an owner decision. This plan makes what ships the same set of packages CI tested: one hash-pinned uv lock that `check.yml`, every release build job and the image install from, on Python 3.14, from base images pinned by digest, with Dependabot keeping the pins current.

## Must be true when done

- `uv.lock` is committed, hash-pinned, current with `pyproject.toml` (`uv lock --check` exits 0), and resolves for all six build targets: AlmaLinux 8 amd64 and arm64, macOS arm64 and x86_64, Windows x64 and arm64, with `pystray` and `pillow` present only on macOS and Windows (D-01).
- `check.yml`'s `check` and `e2e` jobs install Python packages only from the lock, plus triviajudge in its own unpinned step; the gate refuses any other Python install there (D-01, D-06, AC1).
- `build`, `build-macos` and `build-windows` install the runtime dependencies and PyInstaller only from the lock, and the project's build backend comes from the lock or the project is not built; the gate refuses any other Python install in those jobs (D-01, AC1).
- The image builds on a digest-pinned Python 3.14 slim base and installs from the lock (D-02).
- The `Dockerfile` base and the `container:` that freezes the deb and rpm carry `@sha256:` digests; the smoke and lifecycle distro images stay on tags; the gate refuses an undigested shipped base (D-11, AC1).
- `.github/dependabot.yml` updates the action SHAs and the Python lock (D-07).

## Context

- Locked: D-01 (one uv lock, six targets, `check.yml` off `pip install -e ".[dev]"`), D-02 (all on 3.14; image on a digest-pinned 3.14 slim base), D-06 (triviajudge unpinned and outside the lock, owner decision "it's my app I update it when I fucking want"), D-07 (dependabot), D-08 (the dev venv keeps its editable installs; the lock binds CI and the release builds only), D-11 (which images get digests).
- The `check.yml` coverage steps (`python coverage report`, `python coverage thresholds`, `js coverage thresholds`) are the accepted policy's text, matched by `test-policy check`: no task edits those three commands.
- `requires-python` stays `>=3.12`, and mypy's `python_version` stays `3.12`. D-02 locks what the image, CI and the builds run, and a uv lock is universal across the range it is given. See the return marker.
- Commit `24fb2153` renamed release.yml's check job to `tag-check` to keep it apart from the required `check` job; no task here renames a job.


Red-run rule for every task in this plan: "red against the base-commit export" means the rule's OWN failure lines appear in the gate's output on that export, quoted by the executor. The gate's exit code alone proves nothing after Plan 1 Task 1, because the export's tag-pinned `uses:` refs already make it exit non-zero. A rule whose own lines do not appear against the pre-fix file it targets has not bitten, and the task is not done.

## Tasks

### Task 1: triviajudge installs outside the dev extras

- **Files:** pyproject.toml, .github/workflows/check.yml, CONTRIBUTING.md
- **Reads:** pyproject.toml#project.optional-dependencies, .github/workflows/check.yml#install, CONTRIBUTING.md#Setup
- **Decisions:** D-06, D-08
- **Action:** Remove `triviajudge` from the `dev` extras, together with its three-line comment, so the lock Task 2 generates never pins or hashes it (D-06). `[tool.triviajudge]` stays. In both `check.yml` jobs, install triviajudge by name in a step of its own after the dev install, unversioned and unhashed. That is the D-06 exception, so keep it visibly separate from the locked install that replaces `pip install -e ".[dev]"` in Task 2. In `CONTRIBUTING.md` "Setup", add one command line installing `triviajudge` into `.venv` after the `.[dev]` line, so a fresh dev venv still has the console scripts that `make check` and pre-commit call. Leave this host's `.venv` alone (D-08). The triviajudge install pulls its own dependencies the same unpinned way. That is the reach of D-06's exception, and Plan 5 records it in F-042's entry.
- **Verify:** Testing scope: one outcome, "a fresh dev setup and CI still have the triviajudge console scripts". It is proved by the setup itself, and no test is added. `grep -n triviajudge pyproject.toml` shows only the `[tool.triviajudge]` table and its comments. In a scratch venv under `${CLAUDE_SCRATCH:-/tmp}`, following CONTRIBUTING's new lines (the pip half only, no npm) leaves `triviajudge-archaeology` on the venv's `bin/`. The scratch venv is removed after. Footprint: about one core for under two minutes and well under 1 GB of disk, named before it runs. `.venv/bin/python .claude/hooks/md-softwrap.py --check CONTRIBUTING.md` exits 0. `scripts/gate.sh make check` prints `exit=0`. CI: `check` and `e2e` pass (ci: check, e2e).

### Task 2: One hashed lock exists, and check.yml installs from it

- **Files:** uv.lock, pyproject.toml, .github/workflows/check.yml, scripts/gates/check_supply_chain.py, tests/gates/test_supply_chain.py, .pre-commit-config.yaml, .filepawl.toml
- **Reads:** pyproject.toml#build-system, pyproject.toml#project.optional-dependencies, .github/workflows/check.yml#install, .github/workflows/release.yml#build-windows
- **Decisions:** D-01, D-06, D-08, D-10
- **Action:** Generate `uv.lock` with the host's uv. It must resolve the runtime dependencies, the `dev` extras, and the build set Task 3 freezes, for all six targets. Define that build set here, not in Task 3: PyInstaller in a dependency group or extra of its own, reachable without the `dev` extras (which carry `uvloop`, `scipy` and `playwright`), with the `dev` extras still providing it on a dev host. That keeps this commit's lock complete for what Task 3 installs. If uv's setting that requires a wheel for each named environment is available at the pinned uv version, use it, so `uv lock` itself fails when a target lacks a CPython 3.14 wheel. A target that needs a source build is reported as a blocking question, never built (CONTEXT flags Windows arm64 numpy and pillow, and AlmaLinux 8 aarch64). F-034 names the build backend, so it is part of what must be pinned. Either the backend (`setuptools`, per `[build-system]`) comes from the lock with build isolation off for the project, or the jobs install the dependencies without building the project. A backend fetched unhashed into an isolated build environment is the failure to avoid. The same holds for filepawl: it installs from git and builds from source with `setuptools>=68` (its `[build-system]`), so the `dev` sync must take that backend from the lock too, with build isolation off for filepawl or an equivalent that hashes the backend. Record which one, for both packages, in the commit message. The six-target `--no-build` dry resolution in Verify covers the runtime and build sets; the `dev` set is checked separately by a locked sync of `--extra dev` that shows no unhashed download of a build requirement, quoted by the executor. In `check.yml`'s `check` and `e2e` jobs, install uv with `scripts/ci/install-uv.sh` (Plan 1 Task 2) and replace the `python -m venv` and `pip install -e ".[dev]"` lines with a locked sync of the `dev` extras into `.venv`, which the `Makefile` hardcodes. The sync must fail on a stale lock (`--locked`), never re-resolve. Keep Task 1's triviajudge step after it, since a sync removes packages the lock does not hold, and keep `npm ci`. Add a gate rule, tests first: in `check.yml`, every Python package install is a locked sync, and the one unlocked install allowed names triviajudge alone. It is red against the base-commit export. Run `filepawl accept` whenever filepawl prints it.
- **Verify:** Testing scope: the outcomes are "a `pip install` or name-based `uv pip install` in check.yml fails, naming the job", "an unlocked install of anything but triviajudge fails", "the locked sync passes" and "the real tree passes". The test file already holds the gate's other rules. These cases, plus the base-commit red run, are sufficient. `uv lock --check` exits 0. For each of the six targets, a dry resolution of the locked set with source builds refused succeeds, naming the target and Python 3.14 (`uv pip compile` or `uv export` piped to a `uv pip install --dry-run --python-platform <target> --no-build`, or equivalent). The executor quotes one line per target. `grep -c 'hash = "sha256:' uv.lock` is non-zero, and `grep -n triviajudge uv.lock` prints nothing. The gate and its tests print `exit=0` through `scripts/gate.sh`. `actionlint` exits 0. `scripts/gate.sh make check` prints `exit=0`. CI: `check` and `e2e` pass on the pushed commit, and the coverage steps' text is byte-identical to the base commit's (`git diff <base> -- .github/workflows/check.yml` touches no line of those three steps) (ci: check, e2e).

### Task 3: The release build jobs install from the lock

- **Files:** .github/workflows/release.yml, pyproject.toml, uv.lock, scripts/gates/check_supply_chain.py, tests/gates/test_supply_chain.py, .filepawl.toml
- **Reads:** .github/workflows/release.yml#build, .github/workflows/release.yml#build-macos, .github/workflows/release.yml#build-windows, scripts/package-linux.sh, scripts/package-windows.sh
- **Decisions:** D-01, D-10
- **Action:** In `build`, `build-macos` and `build-windows`, replace `uv venv --python ...` and `uv pip install . pyinstaller` with a locked sync of the runtime dependencies plus PyInstaller into `.venv`, which `scripts/package-*.sh` call as `.venv/bin/python`. Use Task 2's backend choice. Keep the Windows jobs' explicit interpreter names (`cpython-3.14-windows-x86_64-none`, `cpython-3.14-windows-aarch64-none`): the comment above `build-windows` says why. The build jobs must not install the `dev` extras: they carry `uvloop`, which has no Windows build, plus `scipy` and `playwright`. Install the build set Task 2 defined. If `pyproject.toml` changes anyway, regenerate `uv.lock` and re-run Task 2's six-target dry resolution, quoting one line per target. Add `uv.lock` to `release.yml`'s `push.paths`, so a lock bump triggers a dev run. Extend the gate's lock rule, tests first, to these three jobs: red against the gate as Task 2 left it, and red against the base-commit export.
- **Verify:** Testing scope: the outcomes are "a name-based install in any of the three build jobs fails, naming the job" and "the real tree passes". Task 2's cases already cover the install shapes, so one case per job kind and the real tree are sufficient. The gate and its tests print `exit=0` through `scripts/gate.sh`. `uv lock --check` exits 0. `actionlint` exits 0. Locally, a locked sync of the build set into a scratch venv, followed by that venv's `python -m PyInstaller --noconfirm --distpath <scratch>/dist --workpath <scratch>/build hqptuner.spec`, freezes a bundle. That is the command `scripts/package-linux.sh` runs; the script itself stops early here because `nfpm` is not on the host. The scratch venv and its output are removed after. Footprint: about one core for one to two minutes and under 1 GB of disk, named before it runs. `scripts/gate.sh make check` prints `exit=0`. CI: `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows` pass on the pushed commit, and no build job's log shows a source build of any package but hqptuner (ci: smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows).

### Task 4: The image installs from the lock on Python 3.14

- **Files:** Dockerfile
- **Reads:** Dockerfile, .dockerignore, scripts/gates/check_container_env.py#pinned
- **Decisions:** D-02, D-01, D-11
- **Pins:** tests/gates/test_container_env.py
- **Action:** Move the image from `python:3.12-slim` to a Python 3.14 slim base, and replace `pip install --no-cache-dir .` with an install of the runtime dependencies from `uv.lock`, the build backend following Task 2's choice. Add `uv.lock` to what the build copies. `.dockerignore` excludes nothing that matches it. Getting uv into the build is the executor's choice, within one constraint: anything the Dockerfile pulls, an image or a binary, is pinned by digest or verified by hash, and uv does not need to stay in the runtime image. Task 5 pins the base's digest, so this task may leave it on the `python:3.14-slim` tag. Keep the non-root user, the `/state` `ENV` block (`scripts/gates/check_container_env.py` reads it), the `HEALTHCHECK` and the `CMD` working. If the install goes into a venv, the `python` that the `HEALTHCHECK` and `CMD` call must be that venv's. Avoid naming the local test image `hqptuner:dev` or anything under that repository: that tag is the production container built from `/home/atom/dev/hqptuner2`.
- **Verify:** Testing scope: the outcomes are "the image builds", "its interpreter is 3.14", "its packages are the lock's versions" and "the app imports and the health route answers". None has a test today, and the build plus the checks below are sufficient. `scripts/gate.sh .venv/bin/python scripts/gates/check_container_env.py` prints `exit=0`. Footprint, named before it runs: `docker build -t hqptuner-lockcheck:scratch .` takes several cores for one to three minutes and about 300 MB of disk. Then `docker run --rm --network none hqptuner-lockcheck:scratch python --version` prints 3.14. A listing of the installed distributions inside the image matches the lock's versions for the runtime set (`uv export --frozen --no-dev` against the listing; the executor quotes any difference). `docker run --rm --network none hqptuner-lockcheck:scratch python -c "import hqptuner.api"` exits 0. Then `docker rmi hqptuner-lockcheck:scratch` is run, and `docker images hqptuner-lockcheck` lists nothing. No container is left running (`docker ps -a --filter ancestor=hqptuner-lockcheck:scratch` is empty). `scripts/gate.sh make check` prints `exit=0`.

### Task 5: The shipped base images are pinned by digest

- **Files:** Dockerfile, .github/workflows/release.yml, scripts/gates/check_supply_chain.py, tests/gates/test_supply_chain.py, .pre-commit-config.yaml, .filepawl.toml
- **Reads:** Dockerfile, .github/workflows/release.yml#build, .github/workflows/release.yml#smoke, .github/workflows/release.yml#lifecycle-rpm
- **Decisions:** D-11, D-10
- **Action:** Pin the `Dockerfile` base (`python:3.14-slim`, after Task 4) and the `build` job's `container: almalinux:8` to their current multi-arch index digests, keeping the tag in the reference (`name:tag@sha256:<64 hex>`). Both are built on amd64 and arm64, so the digest must be the index's, never one platform's manifest. Read it with `docker buildx imagetools inspect <name:tag>`, which prints the index digest. Any other image Task 4 added to the Dockerfile is pinned the same way. The smoke matrix's `debian:12`, `ubuntu:22.04`, `almalinux:8` and `fedora:latest`, and `lifecycle-rpm`'s `almalinux/8-init`, stay on tags (D-11), so the gate rule has to tell the build container apart from those. Add the rule, tests first: every `FROM` in the `Dockerfile` and the `build` job's `container:` carry an `@sha256:` digest of 64 hex characters. It is red against the base-commit export. Add the `Dockerfile` to the gate's pre-commit `files:` if it is not there.
- **Verify:** Testing scope: the outcomes are "an undigested `FROM` fails", "an undigested build `container:` fails", "the smoke and lifecycle images on tags pass" and "the real tree passes". These cases and the base-commit red run are sufficient. The gate and its tests print `exit=0` through `scripts/gate.sh`. For each pinned reference, `docker buildx imagetools inspect <name:tag>` prints the same digest as the file, and its manifest list names both `linux/amd64` and `linux/arm64`. The executor quotes both. `actionlint` exits 0. `scripts/gate.sh make check` prints `exit=0`. CI: `smoke`, `lifecycle-deb` and `lifecycle-rpm` pass on the pushed commit, so the pinned AlmaLinux container froze both architectures (ci: smoke, lifecycle-deb, lifecycle-rpm).

### Task 6: Dependabot keeps the action SHAs and the Python lock current

- **Files:** .github/dependabot.yml
- **Reads:** .github/workflows/check.yml
- **Decisions:** D-07
- **Action:** Create `.github/dependabot.yml` (version 2) with two update entries at the repo root. One is `github-actions`, which rewrites the SHA pins and their tag comments. The other is the Python dependencies D-07 names, under Dependabot's `uv` ecosystem: the lock is `uv.lock`, and a `pip` entry would update nothing here, since the project has no requirements file and no version bounds. Plan 5 notes in F-039's entry that `uv` is the ecosystem that carries out D-07 for this lock. Set each entry's `target-branch` to `dev`, where work lands, so update PRs open against it. Choose a weekly schedule, recorded in the commit message.
- **Verify:** Testing scope: Dependabot's own parse is the only check that means anything, and it runs only on GitHub, so the local check is the schema and the rest is human-verify. `.venv/bin/python -c "import yaml,sys; d=yaml.safe_load(open('.github/dependabot.yml')); print(d['version'], [u['package-ecosystem'] for u in d['updates']])"` prints `2` and the two ecosystems. human-verify: after the owner pushes and the file reaches the default branch, the repository's Insights, Dependency graph, Dependabot page lists both ecosystems with no parse error (CONTEXT flags that the file may take effect only from `main`).

## Notes

- `requires-python` and mypy's `python_version` stay at 3.12. D-02 sets what the image, CI and the builds run (3.14), not the oldest Python the package supports, and D-01's lock is universal. README and CONTRIBUTING copy is unchanged.
- Dependabot uses the `uv` ecosystem for D-07's Python entry (Task 6).
- Task 4 goes beyond D-01's evidence lines, which name `check.yml` and `release.yml` only. D-02's rejected options ("a 3.12 CI leg with its own lock, and one lock per interpreter") and F-037's remediation ("install from it in CI and every build job") both read as the image sharing the lock. Without it, F-037's image half stays open, so Task 4 does it.
