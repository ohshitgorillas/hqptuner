---
phase: 11
plan: 3
# Phase 11 maps no requirement ID (ROADMAP: "Requirements: None"); this plan fixes F-047 (CONTEXT AC3).
requirements: []
files:
  - scripts/hqpdoc_tools.py
  - scripts/hqpdoc_errors.py
  - scripts/authority.py
  - tests/test_hqpdoc_section.py
  - tests/test_authority_sections.py
---

# Phase 11: Agent tooling and repo guards - Plan 3: The manual tools read only the manual directory

## Goal

Findings F-043, F-044, F-045, F-046, F-047 and F-048 are each fixed or carry an owner decision. This plan fixes F-047: no INDEX.md row can make the hqpdoc tools read a file outside `docs/official/manual/`.

## Must be true when done

- `hqp_section` returns a tool error and no file content when the INDEX.md row for the requested section names `../...`, an absolute path, or any name that resolves outside the manual directory (D-17, AC3).
- `authority.manual_sections()` hands no caller a filename that resolves outside the manual directory, so `hqp_find` with `context` never prints lines from such a file (D-17, `~/dev/CLAUDE.md` rule 10.2).
- A section whose row names a real file inside the directory reads as before.
- Both behaviors have tests that fail by assertion against the pre-fix scripts (AC3, D-10).

## Context

- Locked: D-17 (`tool_hqp_section` refuses through the existing `hqpdoc_errors` shape; `manual_sections()` gets the same check when a caller opens the names it returns).
- The second site is live. `_ManualLocator.locate` in `hqpdoc_tools.py` opens `authority.MANUAL / filename`, and the filename comes from `manual_sections()` by reversing the label in `_manual_label_to_file`. So a hostile row that repeats a real row's label is opened for `hqp_find`'s context lines. This settles CONTEXT's flagged assumption: `manual_sections()` itself opens nothing, but its caller does.
- Tests load `scripts/` modules by bare name (`pytest` `pythonpath` carries `scripts`), as `tests/test_build_manual.py` and `tests/test_eqtools_mcp.py` do. `docs/testing.md` rules 2, 3 and 8 bind them.
- Out of scope: `scripts/build_manual.py`, which already slugs the names it writes.

## Tasks

### Task 1: `hqp_section` refuses a section file outside the manual directory

- **Files:** scripts/hqpdoc_tools.py, scripts/hqpdoc_errors.py, tests/test_hqpdoc_section.py
- **Reads:** scripts/hqpdoc_tools.py#tool_hqp_section, scripts/hqpdoc_errors.py#SectionFileMissingError, scripts/authority.py#INDEX_ROW, scripts/hqpdoc_mcp.py
- **Decisions:** D-17
- **Action:** Write the tests first and run them red against the current code. Then make `tool_hqp_section` resolve `MANUAL / filename` and, when the resolved path is not inside the resolved `MANUAL`, raise a new `ToolError` subclass in `hqpdoc_errors.py`. Shape it like `SectionFileMissingError`, with keyword-only arguments and a docstring on the class and on `__init__`, naming the section number and the filename and reading nothing. Run that check before the `is_file` test, so an outside file that exists is never opened. A symlink inside the directory that resolves outside it is refused the same way. Keep the tool's MCP-visible signature (`number`) unchanged. If the tests need to point the tools at a temporary manual, use the public module constants or add a seam at the entry point; never reach into `_private` names (`docs/testing.md` rule 3).
- **Verify:** Testing scope: the outcomes are refusal with no content for an escaping name and a normal read for an inside name. Nothing covers `hqp_section` today. Add the smallest set: a `../` name, an absolute path, and a name inside the directory that still reads its file. Each escaping case is set up so the outside file exists and holds a sentinel line. Stop there. The refusal tests fail by assertion against the pre-fix code, which returns the outside file's text; record that red run in the commit message. `scripts/gate.sh .venv/bin/pytest tests/test_hqpdoc_section.py -q` passes, and `scripts/gate.sh make check` exits 0.

### Task 2: `manual_sections()` leaves out any row naming a file outside the manual directory

- **Files:** scripts/authority.py, scripts/hqpdoc_tools.py, tests/test_authority_sections.py
- **Reads:** scripts/authority.py#manual_sections, scripts/authority.py#search_manual, scripts/hqpdoc_tools.py#_manual_label_to_file, scripts/hqpdoc_tools.py#_ManualLocator, scripts/hqpdoc_tools.py#tool_hqp_find
- **Decisions:** D-17
- **Action:** Write the tests first and run them red against the current code. Then make `manual_sections()` leave out any INDEX.md row whose filename, joined to `MANUAL` and resolved, falls outside the resolved `MANUAL`; rows naming files inside it map as before. Leaving the row out is this plan's choice for this site, since `authority.py` is also a CLI and does not raise `hqpdoc_errors` types. `search_manual` then labels such a file by its bare name, as it already does for a file INDEX.md does not list. A `*.txt` symlink inside the directory that resolves outside it is the same escape by another route: `search_manual` (`authority.py`) and the `MANUAL.glob("*.txt")` loop in `hqpdoc_tools.py` skip any globbed path whose resolved path falls outside the resolved `MANUAL`, and `_manual_label_to_file` returns `None` for such a name. With those closed, `_ManualLocator` opens only names inside the directory and needs no change.
- **Verify:** Testing scope: the outcome is that no caller is handed a name outside the directory. The plausible defect is an INDEX row that repeats a real section's label and points outside, whose file's lines then come back through `hqp_find` with context. Nothing covers it today. Add the smallest set: such a row is absent from the map, a normal row is present, and a symlinked `*.txt` in the directory pointing at an outside file contributes no hit. Observing it through `hqp_find` with `context` greater than 0 (no sentinel line from the outside file in the output) is an equally good lane; pick the lowest that sees it (rule 15). Stop there. The exclusion and symlink tests fail by assertion against the pre-fix code; record that red run in the commit message. `scripts/gate.sh .venv/bin/pytest tests/test_authority_sections.py -q` passes, and `scripts/gate.sh make check` exits 0.

## Notes

- Plan shape: CONTEXT's example groups "the scripts and probes" as one slice. This plan and Plan 4 share no file and no ordering, so they are two plans that can run in parallel.
