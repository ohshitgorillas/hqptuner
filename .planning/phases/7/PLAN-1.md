---
phase: 7
plan: 1
# Phase 7 maps no requirement ID (ROADMAP: "Requirements: None"); it plans against the five Success Criteria and CONTEXT AC1-AC7.
requirements: []
files:
  - tests/support/fake_http.py
  - tests/support/fake_control.py
  - tests/engine/http/test_fake_config_page.py
  - tests/engine/test_httpconf_form_types.py
  - tests/api/test_api_health.py
  - tests/
  - .filepawl.toml
---

# Phase 7: Remove the 4321-only mode - Plan 1: The fakes speak the real 6.0.4 page

## Goal

HQPTuner requires both the 4321 control lane and the 8088 config lane. This plan lays the ground the two-lane fixtures stand on: the fake 8088 `/config` page is the captured 6.0.4 page, every setting a `select` with its options where the real page has one, and the fake 4321 enumerates the same filter, oversampling, dither and modulator IDs, so a test's choices come from the page (ROADMAP SC3, AC5).

## Must be true when done

- `formparse` reading the fake 8088 `/config` page and reading `tests/support/fixtures/config-form-6.0.4.html` gives the same select fields, each with the same option values (AC5).
- `filter`, `samplerate` and `bitrate` on the fake page are `select` fields with the real page's options, and `channels` is the real page's `number` input, not the `text` inputs the fake rendered before (D-13).
- The fake 4321's PCM filter, SDM filter (oversampling), PCM shaper (dither) and SDM shaper (modulator) lists carry exactly the IDs of the page's `filter`, `oversampling`, `dither` and `modulator` selects (AC5).
- A test that set a field on the fake 8088 state reads that value back as the selected option, input value or checked box of the fake page.
- `scripts/gate.sh make check` exits 0 after each task.

## Context

- Locked: D-12 (copy the real page whole; only the current value moves to the fake's state; fake 4321 lists change to the page's IDs), D-13 (tests reading the old field types are rewritten on the new shape, with no special case in the fake), D-14 (new test files in subdirectories; `tests/api` and `tests/engine` are at the filepawl cap).
- Out: the fake `/matrix` and `/speakers` pages stay as they are; no probe against the production daemon; no change under `hqptuner/`.
- Option labels are HQPlayer's published enumeration names off the captured page, not filter specifications (D-12), so carrying them into the fake is inside the probing rule.
- `docs/testing.md` binds: rule 13 (a fake answers from tables, never from logic, so the fake 4321 lists are tables, never derived through `hqptuner` code), rule 9 (assert wire identifiers and option values, never copy), rule 2 (one assertion per test), rule 18 (in-process fakes only). Tests are never edited to pass: a test whose values came from the fake's old lists or old field shapes is rebuilt on the page's values with the same behavior asserted, and a test whose behavior cannot be stated on the page's values goes to the owner as a blocking question.
- Every gate run through `scripts/gate.sh`; `filepawl accept` whenever filepawl prints it.

## Tasks

### Task 1: The fake 8088 `/config` page is the captured 6.0.4 page

- **Files:** tests/support/fake_http.py (`_http_render`, `state`), tests/engine/http/test_fake_config_page.py, tests/engine/test_httpconf_form_types.py, tests/api/test_api_health.py, tests/ (fallout: tests that read the fake page's old fields or option lists), .filepawl.toml
- **Action:** Make `_http_render` serve `tests/support/fixtures/config-form-6.0.4.html` whole: every section, label, field and option of the captured page, with each field's current value set from the fake's state, so a select's `selected` option, an input's `value` and a checkbox's `checked` follow the state keys of the same name and every other byte of the page is the capture's. Fields the fake state carries no key for keep the capture's own value. Two existing modelled behaviors must survive and are the only places the option list itself follows state: the `net_device` select lists the fake's `_net_endpoints` (a `/config/refresh` rescan adds `_hidden_endpoints` to it, and `_form_net_device` is the lag window the selected device reads from), and the default `_net_endpoints` become the page's own `net_device` option values so the default render equals the capture's list. Every default in `state()` that a page select renders must be one of that select's options; where a default is not (check `samplerate`, `bitrate`, `defaults_samplerate`, `defaults_bitrate`, `backend`, `net_device`), change the default to a page option rather than adding an option or a special case to the fake (D-13). Write the AC5 test first in the new file: the fake page and the capture, both parsed by `hqptuner.conf.formparse.parse_config_form`, give the same select field names and, per select, the same option values; run it red against the current fake before changing `_http_render`. Rewrite the tests that read the old shapes on the new one (D-13): `tests/engine/test_httpconf_form_types.py` and `tests/api/test_api_health.py` assert the page's `select` and `number` types where they asserted `text`. Run the offline suite and the e2e suite and rebuild each test the new page moves (a field it counted, an option it picked, a value it typed) on the page's values, keeping the behavior it asserts; list each rebuilt test in the hand-back. Do not touch `_matrix_render` or `_speakers_render`.
- **Verify:** `scripts/gate.sh .venv/bin/pytest -m "not live" -q tests/engine/http/test_fake_config_page.py` fails before the `_http_render` change and passes after it (bite proof, `docs/testing.md` rule 8). Testing scope: the outcomes are AC5's select-for-select match and the D-13 field types; the existing form-type and health tests cover the types once rewritten, so the one added check is the parsed-page comparison, sufficient when it passes against the capture and fails against the old render; stop there. `scripts/gate.sh make check` prints `exit=0`. The browser suite reads the fake's state too, so `scripts/gate.sh make test-e2e` prints `exit=0` (disclose before it runs: Playwright and the app subprocess hold a core for well over 10 s, `~/dev/CLAUDE.md` 3.1).

### Task 2: The fake 4321 enumerates the page's filter, oversampling, dither and modulator IDs

- **Files:** tests/support/fake_control.py (`_PCM_FILTERS`, `_SDM_FILTERS`, `_PCM_SHAPERS`, `_SDM_SHAPERS`, the enumeration comment above `_MODES`, `DEFAULTS`), tests/engine/http/test_fake_config_page.py, tests/apply/test_manager_apply.py, tests/ (fallout: tests pinning the old short chains' indices, IDs or names), .filepawl.toml
- **Action:** Replace the four tables so each lists the page's options in the page's order: `_PCM_FILTERS` the `filter` select (the page's `filter1x` list is identical), `_SDM_FILTERS` the `oversampling` select (identical to `oversampling1x`), `_PCM_SHAPERS` the `dither` select and `_SDM_SHAPERS` the `modulator` select, each entry the list index, the page's option label as the name and the option value as the enum ID. Keep them literal tables (rule 13): the fake must not import or call `hqptuner` code to build them. Keep the two properties the comment above `_MODES` says the fake exists to model, now on the page's own facts: the lists are mode-scoped, and IDs shared between the PCM and SDM lists name different filters (the page has many such IDs, so pick the cited examples from it); rewrite that comment so it cites the page's IDs and names instead of the old short-chain examples. Every index `DEFAULTS` carries (`filter1x`, `filterNx`, `shaper`) and every ID a case hands the `_cfg_dither` / `_cfg_modulator` knobs must exist in the new tables. Add the AC5 second half to the Task 1 test file, test first and red against the old tables: the fake 4321's IDs for each of the four lists equal the IDs of the page select it mirrors. Rebuild the tests that pinned the old chains on the new tables' values, keeping the behavior each asserts, starting with `tests/apply/test_manager_apply.py` (enum 40 at PCM index 1, CONTEXT flagged assumption 3); `_JUNK_FILTERS`, `_MODES` and the rate lists stay as they are. List each rebuilt test in the hand-back.
- **Verify:** the new four-list test fails against the old tables and passes after (bite proof). Testing scope: the outcome is AC5's ID match on four lists; existing chain-gate and live-routing tests already cover mode scoping and the shared-ID case once rebuilt, so the one added check is the ID comparison, parametrized per list; stop there. `scripts/gate.sh make check` prints `exit=0` and `scripts/gate.sh make test-e2e` prints `exit=0` (disclosed as in Task 1).

## Notes

- Interpretation for the owner to confirm: D-12 says "only the `selected` option moved to its state". This plan reads that as each field's current value (selected option, input value, checked box) following the state, with the page's structure and options otherwise unchanged, and with one list that follows state: `net_device`, because the fake models a rescan adding endpoints and a preset-load lag (`_hidden_endpoints`, `_form_net_device`). Text and number inputs such as `title` and `defaults_volume` have to follow state or every restore readback test loses its subject.
- The real page carries many fields the old fake never rendered (`profile`, `pipelines`, `log_enabled`, `fft_size` and others). If the app mishandles one of them once the fake serves it, that is a production defect outside this phase; the executor reports it and does not work around it in the fake.
- Recalled memory (phase 5 UAT): `tests/presets/test_switch_drops_profile.py`, the file that kept dead TCP fixtures, no longer exists in this tree.
