# Requirements: HQPTuner v1

**Defined:** 2026-11-05

**Core Value:** A user on any supported platform installs HQPTuner, reaches it from their browser, and configures HQPlayer Embedded without endangering the running engine.

## Active

Committed scope. Each maps to exactly one roadmap phase.

### Windows app

- [ ] **WIN-01**: A Windows user can open HQPTuner from another device on their network right after a fresh install, including the launch the installer starts itself.
- [ ] **WIN-02**: A Windows user can install a new version over an existing one, and the app then starts with its tray icon and no error dialog.

## Shipped

Delivered and verified. Kept as rows for shipped-scope trace; git history
holds the full requirement text. Archived out of `## Traceability` so a new
milestone's audit starts clean (the audit seam parses only the Traceability
table).

| Requirement | Phase | Status | Milestone |
|-------------|-------|--------|-----------|
| WIN-01 | 2 | Complete | v1.20.2 |
| WIN-02 | 3 | Complete | v1.20.2 |

## v2 Requirements

Deferred. Tracked, not in the current roadmap.

(None: new capability goes to HQPTuner v2.)

## Out of Scope

| Feature | Reason |
|---------|--------|
| New features | v1 is patch-only; they go to v2 |
| v2 work | It happens in `~/dev/hqptuner2/` on branch `v2` |
| Measuring HQPlayer's filter design | Proprietary unless published |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|

---

*Last updated: 2026-11-05 after /cad-adopt*
