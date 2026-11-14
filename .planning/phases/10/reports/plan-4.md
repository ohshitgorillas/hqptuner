PLAN COMPLETE

Plan: .planning/phases/10/PLAN-4.md

Tasks: 4 of 4

| Task | Commit | Note |
|---|---|---|
| 1 - SHA-256 checksum file | fb3476eb | See plan-4.1.md. |
| 2 - Linux packaging in its own job | 3db3749d | See plan-4.1.md. |
| 3 - GPG signatures | 91591331 | See plan-4.1.md. |
| 4 - cosign-signed images (option A, owner-approved) | 11327b55 | `sign-image` job (environment `image-signing`, no build step, cosign-installer pinned by SHA, signs both registries by digest); `build-push` keeps `contents: read` + `packages: write`, reads no key. `PACKAGE_WRITERS["docker.yml"]` = `{build-push, sign-image}`. New `cosign_failures` gate rule + tests (red-first: 12 failed with stub, 157 passed after; bite shown on scratch workflow). `packaging/keys/cosign.pub` (1 BEGIN PUBLIC KEY). README copy 3 and changelog bullet verbatim. `.filepawl.toml` allowance for `check_supply_chain.py` raised 413 to 448 (owner-approved, that entry only; file is exactly 448 lines). |

Verification for task 4: `actionlint .github/workflows/docker.yml` clean; `check_supply_chain.py` exit=0 (`[ok] all 3 workflows and the Dockerfile pin their remote code`); `grep -c 'BEGIN PUBLIC KEY' packaging/keys/cosign.pub` = 1; `check_changelog.py` exit=0; `scripts/gate.sh make check` exit=0 (pytest and JS halves included, coverage report printed). The commit's pre-commit run (offline pytest included) passed on the same tree. The suite was run once, as `make check`, on the tree identical to HEAD content (only the commit itself followed it).

Deviations: none new (the earlier one, `packages: write` on `build-push` alone, is resolved by the owner's option A; Task 4 Verify read as "on `build-push` and `sign-image` only").

Open items:

- See plan-4.1.md open items 1 to 5 (checksum step shape, revoked second user id in the GPG key file, copy 2 URLs point at `main`, AC4 human-verify items).
- `sign-image` also holds the two registry logins (GITHUB_TOKEN and `DOCKERHUB_*`), because cosign pushes the signature with them; logins are not build steps and the gate allows them.
- cosign v3.1.4 uploads to the public Rekor log by default, matching `cosign verify --key` in copy 3. Not exercised here.
- AC4 for images (human-verify): after the next `beta`, `main` or `v*` push, copy 3's `cosign verify` for `ohshitgorillas/hqptuner:<tag>` and `ghcr.io/ohshitgorillas/hqptuner:<tag>`; needs the `image-signing` environment and `COSIGN_*` secrets to exist (human setup 2).
- Known actionlint note: `release.yml:394:21: label "xcode-27" is unknown` (pre-existing runner label).
- `bug.png` at repo root left untracked (not mine).
