---
phase: 10
plan: 4
depends_on: [1, 2, 3]
# Phase 10 maps no requirement ID (ROADMAP: "Requirements: None"); this plan closes F-040 (CONTEXT AC4) and lands its owner-approved changelog and README copy (D-17).
requirements: []
files:
  - .github/workflows/release.yml
  - .github/workflows/docker.yml
  - scripts/package-linux.sh
  - packaging/linux/nfpm.yaml
  - packaging/keys/hqptuner-release.asc
  - packaging/keys/cosign.pub
  - README.md
  - CHANGELOG.md
  - scripts/gates/check_supply_chain.py
  - tests/gates/test_supply_chain.py
  - .filepawl.toml
---

# Phase 10: Release pipeline supply chain - Plan 4: Release checksums and signatures

## Goal

Findings F-034 to F-042 are each fixed or carry an owner decision. This plan gives users something to check a download against. Each release attaches a SHA-256 checksum file, the deb and rpm carry GPG signatures, and the images are cosign-signed. The README says how to verify each.

## Must be true when done

- A `v*` tag's release carries a SHA-256 checksum file covering every other asset it attaches (D-09, AC4).
- The deb and rpm are GPG-signed through nfpm `signature` blocks. The key is read only in a job that runs no PyInstaller and no Python of a venv, sits in `environment: signing`, and needs the check. The public key is in the repository (D-09, AC4).
- Every image `docker.yml` pushes is cosign-signed by digest on both registries, with the key in secrets and the public key in the repository (D-09, AC4).
- `README.md` carries the owner-approved verification steps, and `CHANGELOG.md` `[Unreleased]` `### Security` carries the owner-approved bullets, each landed verbatim in the commit of the task that makes it true (D-09, D-17).
- AC4 is human-verify at the next `v*` release, pending until then (owner decision, CONTEXT AC4).

## Context

- Locked: D-09 (checksum file attached by `gh release create`, nfpm `signature` blocks for deb and rpm, cosign-signed images; the owner creates the keys and secrets and approves the README steps), D-17 (`### Security` bullets only for the checksum file, the signed packages and images, and the README steps; each approved before implementation), D-03 and D-04 (signing material meets no build code, and signing jobs sit in `signing` behind the check), which Task 2 applies to the GPG key.
- The copy in Notes is owner-approved and lands character for character. A task drafts nothing new. Load the `copy-rules` skill before touching `README.md` or `CHANGELOG.md`. Markdown is edited with `Edit`, soft-wrapped.
- `publish` downloads `pattern: linux-*` and `pattern: macos-*`, so an intermediate artifact must match neither.
- Keyless cosign was rejected (D-09 "Rejected: ... checksums with keyless cosign"), so the cosign key is a key pair the owner makes.


Red-run rule for every task in this plan: "red against the base-commit export" means the rule's OWN failure lines appear in the gate's output on that export, quoted by the executor. The gate's exit code alone proves nothing after Plan 1 Task 1, because the export's tag-pinned `uses:` refs already make it exit non-zero. A rule whose own lines do not appear against the pre-fix file it targets has not bitten, and the task is not done.

## Tasks

### Task 1: Each release attaches a SHA-256 checksum file

- **Files:** .github/workflows/release.yml, README.md, CHANGELOG.md
- **Reads:** .github/workflows/release.yml#publish, README.md#Windows app
- **Decisions:** D-09, D-17
- **Action:** In `publish`, after the downloads and before "Create release", write `dist/SHA256SUMS`, one `sha256sum` line for each file the release attaches (the debs, rpms, dmgs and the setup exe). Generate it from the same globs `gh release create` is given, so the two cannot drift apart. Attach it in the same `gh release create` call. The file lists bare file names, not `dist/` paths, so `sha256sum --check` works in a user's download folder. Add the owner-approved README paragraph (Notes, copy 1) in this task's commit.
- **Verify:** Testing scope: the outcome is "the checksum file names every attached asset and checks clean in a download folder". It is reproducible offline by running the step's shell against dummy files, and the release itself is AC4's human-verify. Locally, the step's commands run under bash against a scratch `dist/` holding one empty file per glob. They produce a `SHA256SUMS` with one line per file, and `sha256sum --check SHA256SUMS` run from that directory prints `OK` for each. Scratch removed. `actionlint` exits 0. `scripts/gate.sh .venv/bin/python scripts/gates/check_changelog.py CHANGELOG.md` prints `exit=0`. The README text matches Notes copy 1 character for character. `scripts/gate.sh make check` prints `exit=0`. human-verify (AC4): at the next `v*` release, the release page lists `SHA256SUMS`, and `sha256sum --check SHA256SUMS` in a folder holding every asset prints `OK` for each.

### Task 2: Linux packaging runs in its own job, apart from the freeze

- **Files:** .github/workflows/release.yml, scripts/package-linux.sh
- **Reads:** scripts/package-linux.sh, .github/workflows/release.yml#build, .github/workflows/release.yml#smoke, .github/workflows/release.yml#lifecycle-deb, .github/workflows/release.yml#lifecycle-rpm, .github/workflows/release.yml#publish, scripts/package-macos.sh
- **Decisions:** D-09, D-03, D-04
- **Action:** Task 3 puts a GPG private key into the job that runs nfpm. D-03 and D-04 keep signing material away from build code and behind `environment: signing` and the check, so this task first moves nfpm out of the job that runs PyInstaller. It does this before any key exists. Split `scripts/package-linux.sh` into a freeze stage and a package stage, the way Plan 3 Task 2 split `package-macos.sh`, with no argument running both. Only the package stage requires `nfpm`. In `release.yml`, `build` (AlmaLinux 8 container, the lock) runs the freeze stage, archives `dist/HQPTuner` in a form that keeps file modes, and uploads it under a name `linux-*` does not match. A new per-architecture job, on the same `ubuntu-24.04` and `ubuntu-24.04-arm` runners, takes over. It has `environment: signing` and `needs` on `build` and the check job (Plan 3 Task 4's gate rule requires the check). It installs nfpm with the existing checksum-verified "Install nfpm" step, moved from `build`, and installs no Python packages. It unpacks the bundle, runs the package stage, and uploads `linux-<arch>` exactly as `build` did. Point `smoke`, `lifecycle-deb` and `lifecycle-rpm` at the new job, and add it to `publish`'s `needs`. No key is read yet.
- **Verify:** Testing scope: the outcomes are "the packages built from a bundle that crossed jobs still install, run and remove". The existing smoke and lifecycle jobs check exactly that, so nothing is added. `shellcheck scripts/package-linux.sh` exits 0. `scripts/gate.sh .venv/bin/python scripts/gates/check_supply_chain.py` prints `exit=0`: the new job satisfies the signing-environment rule, and `build` still installs only from the lock. `actionlint` exits 0. `scripts/gate.sh make check` prints `exit=0`. CI: `smoke`, `lifecycle-deb` and `lifecycle-rpm` pass on the pushed commit on both architectures (ci: smoke, lifecycle-deb, lifecycle-rpm).

### Task 3: The deb and rpm carry GPG signatures

- **Files:** packaging/linux/nfpm.yaml, .github/workflows/release.yml, scripts/package-linux.sh, packaging/keys/hqptuner-release.asc, README.md, CHANGELOG.md
- **Reads:** packaging/linux/nfpm.yaml, .github/workflows/release.yml#package-windows, .github/workflows/release.yml#Remove the signing certificate and the notary key
- **Decisions:** D-09, D-17
- **Action:** Add nfpm `signature` blocks for the deb and the rpm in `packaging/linux/nfpm.yaml`, the key file and passphrase taken from the environment the way the file already takes `${ARCH}` and `${VERSION}`. Check nfpm 2.47.0's docs for the deb signature type it writes and for the passphrase variable names, and quote what was used in the commit message. In Task 2's packaging job, a step reads the owner's armored private key and passphrase from the secrets named in Notes (human setup 1), writes the key under `$RUNNER_TEMP`, and passes both to the package stage only. An `if: always()` step removes the key file, as the macOS job's removal step does. A missing key fails the job, so no unsigned package leaves CI. A local `scripts/package-linux.sh` with no key builds unsigned. Commit the owner's public key, ASCII-armored, as `packaging/keys/hqptuner-release.asc`. Add the owner-approved README steps (Notes, copy 2) in this task's commit. If nfpm's deb signature type differs from what copy 2's commands verify, stop and bring the difference to the owner before landing the copy.
- **Verify:** Testing scope: the outcomes are "both packages verify against the published key" and "a missing key fails the job". The first needs nfpm and the owner's key, neither on this host, so it is CI and human-verify. The second is read from the job's shell. Before the copy 2 README text is written, confirm that nfpm's deb signature writes a `_gpgorigin` member: quote the nfpm documentation for the version the job pins, or the `ar t` listing of a signed deb from a CI run. If neither confirms it, stop and take copy 2 back to the owner. `actionlint` exits 0. `gpg --show-keys packaging/keys/hqptuner-release.asc` prints one public key, with no secret part. `scripts/gate.sh .venv/bin/python scripts/gates/check_changelog.py CHANGELOG.md` prints `exit=0`. The README text matches Notes copy 2 character for character. `scripts/gate.sh make check` prints `exit=0`. CI: `smoke`, `lifecycle-deb` and `lifecycle-rpm` pass on the pushed commit with signed packages (ci: smoke, lifecycle-deb, lifecycle-rpm). human-verify (AC4): on a deb and an rpm from that run's `linux-amd64` artifact, the copy 2 commands report a good signature from the key in `packaging/keys/hqptuner-release.asc`.

### Task 4: The images are cosign-signed

- **Files:** .github/workflows/docker.yml, packaging/keys/cosign.pub, README.md, CHANGELOG.md, scripts/gates/check_supply_chain.py, tests/gates/test_supply_chain.py, .filepawl.toml
- **Reads:** .github/workflows/docker.yml#build-push
- **Decisions:** D-09, D-17, D-07
- **Action:** In `build-push`, give the build-and-push step an `id` so its `digest` output can be read. Install cosign with `sigstore/cosign-installer`, pinned by commit SHA with its tag as a comment: Plan 1's gate rule refuses it otherwise. Then sign `docker.io/<repo>@<digest>` and `ghcr.io/<repo>@<digest>` with the owner's key from the secrets named in Notes (human setup 2). Sign by digest, never by tag, so a moved tag cannot carry the signature to another image. Signing uploads the signature to both registries with the logins the job already holds. `build-push` keeps exactly `contents: read` and `packages: write` (Plan 3 Task 1's rule). Key-based signing needs no `id-token`. Commit the owner's public key as `packaging/keys/cosign.pub`. Add the owner-approved README step (Notes, copy 3) and the approved changelog bullet (Notes) in this task's commit: the bullet names packages and images, so it lands with the last of them.
- **Verify:** Testing scope: the outcome is "the pushed image verifies against the committed key on both registries". `docker.yml` runs only on `main`, `beta` and tags, which only the owner pushes, so the proof is human-verify, and the local checks are the workflow's shape. `actionlint` exits 0. `scripts/gate.sh .venv/bin/python scripts/gates/check_supply_chain.py` prints `exit=0`, the new action pinned and `packages: write` still on `build-push` alone. `grep -c 'BEGIN PUBLIC KEY' packaging/keys/cosign.pub` prints 1. `scripts/gate.sh .venv/bin/python scripts/gates/check_changelog.py CHANGELOG.md` prints `exit=0`. The README text matches Notes copy 3, and the changelog line matches the approved bullet, character for character. `scripts/gate.sh make check` prints `exit=0`. human-verify (AC4): after the next `beta`, `main` or `v*` push, copy 3's `cosign verify` command passes for `ohshitgorillas/hqptuner:<tag>` and for `ghcr.io/ohshitgorillas/hqptuner:<tag>`.

## Notes

Task 4 signs the image in a separate `sign-image` job that needs `build-push`, names the cosign environment from human setup 2, runs only the pinned cosign installer and `cosign sign`, and checks out no code. A gate rule, tests first, requires every job reading a `COSIGN_*` secret to name that environment and run no build step; its test case is a `build-push` that reads `COSIGN_PRIVATE_KEY`. The executor applies this shape in place of signing inside `build-push`.

Task 2 puts Linux packaging in its own job in `environment: signing`, on D-03 and D-04's reasoning: a signing key never sits in a job that runs PyInstaller.

Human setup, owner actions outside the tree (D-09: "The owner creates the keys and secrets"):

1. A GPG signing key for the packages. Secrets `RELEASE_GPG_PRIVATE_KEY` (ASCII-armored private key) and `RELEASE_GPG_PASSPHRASE`, in the `signing` environment, and the public half handed over for `packaging/keys/hqptuner-release.asc`. Blocks Task 3.
2. A cosign key pair (`cosign generate-key-pair`). Secrets `COSIGN_PRIVATE_KEY` and `COSIGN_PASSWORD`, in a new environment `image-signing` whose deployment branch rule admits `main`, `beta` and `v*` tags, the refs `docker.yml` runs on. Not at repository level: per F-035, a workflow edit pushed to any branch could read a repository secret and sign an arbitrary image. Not in `signing` either, whose branch rule admits `dev` and `v*` only (D-04). `cosign.pub` handed over. Blocks Task 4.

Copy approved by the owner (D-17). Every line below lands verbatim.

Changelog bullet, `### Security`, Task 4. Approved by the owner, verbatim:

- **Downloads and Docker images can be checked as genuine** before installing.

Copy 1, `README.md`, a new `### Checking a download` section after `### Windows app`, Task 1:

~~~~markdown
Each [release](https://github.com/ohshitgorillas/hqptuner/releases) also carries `SHA256SUMS`, the SHA-256 checksum of every package and installer in it. Download it into the same folder as your download, then run:

```sh
sha256sum --check --ignore-missing SHA256SUMS
```

On a Mac, `shasum -a 256 <file>` prints a file's checksum to compare against its line in `SHA256SUMS`.
~~~~

Copy 2, `README.md`, appended to `### Checking a download`, Task 3:

~~~~markdown
The deb and rpm packages are also signed with HQPTuner's release key, [`packaging/keys/hqptuner-release.asc`](packaging/keys/hqptuner-release.asc). To check a package before installing it:

```sh
# Fedora, RHEL, AlmaLinux
sudo rpm --import https://raw.githubusercontent.com/ohshitgorillas/hqptuner/main/packaging/keys/hqptuner-release.asc
rpm --checksig hqptuner-X.Y.Z-1.x86_64.rpm

# Debian, Ubuntu (ar comes with binutils)
curl -fsSL https://raw.githubusercontent.com/ohshitgorillas/hqptuner/main/packaging/keys/hqptuner-release.asc | gpg --import
ar x hqptuner_X.Y.Z_amd64.deb
cat debian-binary control.tar.* data.tar.* > combined
gpg --verify _gpgorigin combined
```
~~~~

Copy 3, `README.md`, after the paragraph on the GHCR mirror in `### Docker (recommended)`, Task 4:

~~~~markdown
The images are signed with [cosign](https://docs.sigstore.dev/cosign/). To check one against HQPTuner's public key, [`packaging/keys/cosign.pub`](packaging/keys/cosign.pub):

```sh
cosign verify --key https://raw.githubusercontent.com/ohshitgorillas/hqptuner/main/packaging/keys/cosign.pub ohshitgorillas/hqptuner:latest
```
~~~~

Copy 2's deb commands assume nfpm writes a `_gpgorigin` member, as its docs describe for the default deb signature type. Task 3 confirms that before landing the copy. The key URLs point at `main`, so they resolve once the owner promotes this work.
