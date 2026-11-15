PLAN COMPLETE
Plan: /home/atom/dev/hqptuner/.planning/phases/11/PLAN-3.md
Tasks: 2 of 2
| Task | Commit | Note |
|---|---|---|
| 1 hqp_section refuses a section file outside the manual directory | 858c5359 | tests/test_hqpdoc_section.py; new SectionFileOutsideManualError; `root` keyword seam on tool_hqp_section and require_manual (filepawl bans monkeypatch.setattr, so the brief's "public module constants" route was closed). Red run: containment check disabled, 3 failed 1 passed, DID NOT RAISE ToolError. |
| 2 manual_sections() leaves out any row naming a file outside the manual directory | 28b39655 | tests/test_authority_sections.py plus a hqp_page symlink test in tests/test_hqpdoc_section.py; authority.is_inside and authority.manual_dir; manual_sections, search_manual, tool_hqp_page take keyword `root`; _manual_label_to_file and the tool_hqp_page glob loop skip names resolving outside. Red run: checks disabled, 4 failed 5 passed, by assertion. |
Suite: `make lint` green; `make test` (offline pytest, coverage floor, suite time, idle, clock gates) green. workflow.test_command is null, ran the Makefile's Python half.
Deviations: none
Open items:
- JS half of `make check` (lint-js, test-js) not run: worktree has no node_modules and npx would reach the network; no JS file touched.
- Worktree has no .venv, and pre-commit's `env PYTHONPATH=scripts:...` drops the worktree from the path, so the coverage floor read every hqptuner file at 0%. Worked around with an untracked, gitignored .venv/bin of wrapper scripts that prepend the worktree to PYTHONPATH and exec the main venv's tools. No hook edited. Worth a durable fix for worktree executors.
- Seam choice: tests hand in a docs root through keyword `root` (default the repo's own) on tool_hqp_section, tool_hqp_page, require_manual, manual_sections and search_manual. MCP-visible signatures unchanged. Declined: a fuller manual-path abstraction.
- Brief said the tests could patch the public module constants; filepawl's patches gate refuses any setattr patch, hence the seam.
- hqp_find with context is covered through manual_sections exclusion, not an end-to-end test (lowest lane, rule 15).
