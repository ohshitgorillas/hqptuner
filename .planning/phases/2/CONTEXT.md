# Phase 2: Windows network access - Context

Gathered: 2026-11-05

Feeds: /cad-plan 2

## Scope boundary

In: the installer-started (finish-page) launch binding the wildcard address on a fresh Windows install, the same address after a stop and relaunch, smoke-windows exercising the installer-started launch and failing on loopback-only, README firewall guidance, and the `CHANGELOG.md` and `README.md` wording for the fix.

Out: changing the code default listen host (`hqptuner/config.py:127` stays `127.0.0.1`), changing the single-instance probe in `hqptuner/desktop.py`, adding a Windows Defender Firewall rule from the installer, and the upgrade-install `FileNotFoundError` of phase 3.

Deferred: None

Plan shape: one plan (the smoke step lands and runs red on an owner push before the installer fix lands)

## Durable decisions

- D-01 (Fix home): the installer sets `HQPTUNER_LISTEN_HOST=0.0.0.0` in Setup's own process environment from `[Code]` before the `[Run]` entries, so the finish-page child inherits it; the HKCU\Environment write stays for later launches, and the code default stays `127.0.0.1`, keeping PROJECT.md's "code stays `127.0.0.1`; packaging supplies `0.0.0.0`". Rejected: a frozen-win32 in-code default of `0.0.0.0`. Evidence: `packaging/windows/hqptuner.iss:28,42-44,49-50`, `hqptuner/config.py:127`, `.planning/PROJECT.md:71`.
- D-02 (smoke-windows): the shipped installer gains an opt-in command-line switch (a `/LAUNCH`-style parameter) that runs the same postinstall launch during a silent install; a silent install without it still starts nothing. Rejected: dropping `skipifsilent` (every winget or enterprise silent install would start the app) and UI-automating the wizard. Evidence: `packaging/windows/hqptuner.iss:49-50`, `packaging/windows/smoke.sh:75-79`.

## Decisions

- D-03 (Root cause): the finish-page launch is a child of the installer process, which started before the HKCU\Environment write, so it has no `HQPTUNER_LISTEN_HOST` and binds `127.0.0.1`; `ChangesEnvironment=yes` refreshes other programs (Explorer), so a Start menu launch gets `0.0.0.0`. Evidence: `packaging/windows/hqptuner.iss:28,42-44,49-50`, `hqptuner/config.py:127`, commit `75704b15`.
- D-04 (Single instance): `launch`'s single-instance probe is unchanged; a running loopback-only instance is not repaired by a relaunch, and criterion 2 holds after Quit. Evidence: `hqptuner/desktop.py:143-149,290-316`, `.planning/ROADMAP.md:41`.
- D-05 (smoke-windows): today's smoke masks the bug, because `/VERYSILENT` with `skipifsilent` skips the `[Run]` entry and the smoke starts `$BIN` itself after exporting the registry value. Evidence: `packaging/windows/smoke.sh:75-79,90-98`, `packaging/windows/hqptuner.iss:50`.
- D-06 (smoke-windows): the new step finds the installer-started app by lookup, records its PID and kills it by PID, passes `LOCALAPPDATA` and `BROWSER` on the installer invocation, and checks `/api/health` at `lan_address`, failing on loopback-only; the existing step 3 stays for criterion 2, and the bundle-only `windows-bundle-x64` row keeps skipping the address check. Evidence: `packaging/windows/smoke.sh:26-45,91-98,115-123`, `hqptuner/desktop.py:239`, `.github/workflows/release.yml:354-387`.
- D-07 (Bite proof): the red run is smoke-windows with the new step against the current `hqptuner.iss`, on an owner push to `dev`, since `release.yml` runs only on path-filtered pushes and has no `workflow_dispatch`. Evidence: `.github/workflows/release.yml:1-14`, `docs/testing.md:29` (rule 8).
- D-08 (Firewall): Windows Defender Firewall is outside acceptance; the per-user, no-admin install adds no rule, and the README tells users to allow HQPTuner on Private networks in owner-approved wording. Evidence: `packaging/windows/hqptuner.iss:7-8,22`, `README.md:200`.
- D-09 (User-facing text): the fix ships with an owner-approved `CHANGELOG.md` `[Unreleased]` Fixed entry, and `README.md:200`'s "reachable from that PC only" is replaced with owner-approved wording, since it contradicts `README.md:238`. Evidence: `CHANGELOG.md:5-11`, `README.md:198-204,238`, `CLAUDE.md` copy rule.

## Acceptance criteria

- [ ] AC1: in smoke-windows, the app started by the installer's own postinstall launch, through the opt-in switch, answers `/api/health` at the runner's non-loopback address (ci: smoke-windows)
- [ ] AC2: after the smoke stops that app by PID and starts the installed exe as a Start menu launch would, the new process answers `/api/health` at the same address (ci: smoke-windows)
- [ ] AC3: a smoke-windows run with the new installer-launch step against the pre-fix `hqptuner.iss` fails at that step's address check (ci: smoke-windows)
- [ ] AC4: a `/VERYSILENT` install without the launch switch leaves no `HQPTuner.exe` process running (ci: smoke-windows)
- [ ] AC5: `CHANGELOG.md` `[Unreleased]` has a Fixed entry and `README.md` no longer contains "reachable from that PC only", both texts matching the owner-approved wording
- [ ] AC6: `check`, `e2e`, `smoke`, `lifecycle-deb`, `lifecycle-rpm`, `smoke-macos` and `smoke-windows` all report success on the phase's last `dev` commit once the owner pushes it (ci: check, e2e, smoke, lifecycle-deb, lifecycle-rpm, smoke-macos, smoke-windows)

## Flagged assumptions

- An Inno Setup 6 postinstall `[Run]` child inherits Setup's start-time environment, and neither `ChangesEnvironment=yes` nor any 6.x version refreshes Setup's own environment before the finish page - Likely; if wrong: D-01 fixes a non-cause, and AC3's red run will not fail at the address check.
- Windows Defender Firewall does not filter same-host traffic to the host's own LAN address, so the smoke's same-host check stands in for "another device" for the bind address only - Unclear; if wrong: the phase passes while other devices are still blocked by a firewall rule (a dismissed prompt leaves path-keyed block rules across reinstalls).
- A process the installer starts inherits `LOCALAPPDATA` and `BROWSER` set on the installer invocation from Git Bash on `windows-latest` and `windows-11-arm` - Likely; if wrong: a real browser opens on the runner, or the install lands outside the smoke's isolated directory.
- The runner's preinstalled Inno Setup version supports the chosen opt-in mechanism (`{param:}`, `Check:` or `WizardSilent`); it is not pinned in `scripts/package-windows.sh:23` - Likely; if wrong: the switch fails to compile or is ignored on one architecture.
