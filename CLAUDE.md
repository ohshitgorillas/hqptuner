# HQPTuner — agent rules

Host rules in `/srv/CLAUDE.md` apply full — prime directive, plan gate, bounded investigation, interrupt handling, epistemics, behavioral preferences. This file = HQPTuner-specific rules plus deltas where project rule differs from host rule.

## Binding product rules

### User actions always proceed

HQPTuner honors every user action, daemon playing or not — no 409, no disabled button, no "stop playback first" nag. If apply reloads or restarts engine and interrupts playback, that's user's call alone — say what it costs in caption, then do it when they click. Write path stays idle-gate-free: keep it that way, propose none.

(Different thing, still fine: *dev probe scripts* writing to production daemon may check state first — protects host's listener, not UI user.)

### Probing the engine: standard mathematics yes, proprietary design no

Probing the running engine is fine where what you're after is standard mathematics, and HQPTuner is partly built that way — `scripts/probes/probe_iir_q.py` established how the IIR plugin calculates Q, and a biquad is textbook mathematics Signalyst does not own. The decision gate is one question: **could the information I'm after be proprietary, or is it just standard mathematics?** Standard mathematics, documented interfaces and wire-protocol behavior are fair game. Proprietary design is not, and **filter specifications are always proprietary unless published** — passband corner, transition width, roll-off slope, tap count, stop-band attenuation, the design of any resampling, noise-shaping or junk filter. Measuring those out of the engine is reverse engineering in violation of Signalyst's terms; where HQPlayer's own docs are silent on a filter's specification, the answer is "undocumented" — say so and plan around it, never measure it. A plan step proposing such a measurement is a defect. When a question's side of the line isn't obvious, ask before probing.

### Running engine is enumeration authority

Running engine = sole authority for enumeration names/IDs/ordering; static `data/*.json` joins by name (architecture §2).

### User-facing text is owner-approved, verbatim (hard rule)

Every piece of user-facing text — labels, popover prose, hints, tooltips, captions, button summaries, error copy, changelog entries — ships only with the owner's explicit approval, verbatim. Agent-drafted copy is a proposal until the owner signs it off; owner-drafted copy is the spec, character for character, and gets no additions, trims, appended clarifications, or "improvements". Factual errors in owner copy are flagged in discussion and the corrected wording approved before it ships. Em dashes are forbidden in user-facing text, enforced by gate. Rewording during a bug fix or refactor is still a copy change and still requires approval.

### Gate exemptions are owner-approved (hard rule)

A gate says no. The fix is the code, not the gate. Every exemption — an `EXEMPT`/`PRECOMMIT_EXEMPT` entry, a CSS `*-exempt:`/`history-ok:` pragma, an inline `# noqa` / `# type: ignore` / `eslint-disable`, a `per-file-ignores` or vulture `ignore_names` addition, a loosened import-linter contract, a raised threshold, a path added to a skip list, or a deviation from `docs/testing.md` — ships only with the owner's explicit approval of that specific site, granted before it is written. Proposing one names the gate, the site, why the code cannot satisfy the gate, and what the exemption costs. An exemption written first and mentioned at hand-back is a defect whether or not it would have been approved.

Widening an existing exemption is a new exemption and needs its own approval; so does one written by a subagent. Removal needs no approval — delete freely and say so in the report.

## Agent conduct (project deltas)

- **Do work in order user gave it.** Stated sequence part of instruction, not suggestion to optimize around.
- **Plan gate is two stages, each with its own approval word.** Stage 1 is a plain English plan: prose only, saying what is wrong or wanted, what the user sees change, which files or areas get touched and roughly how, the caller-side delta where one applies, what it costs (playback interruption, rebuild, risk), and any open question that is genuinely yours to answer. A question is open only when I cannot get the answer myself **and** proceeding either way would produce materially different work you'd want to have chosen between. Anything a doc, the code, the plan doc, or a standing ruling answers is not a question — look it up and state the answer as a decision I own. Most plans have no open questions; the section is omitted when there are none, never padded. Stage 1 carries no spec block, no signatures, no changelog line, no code, no test design — it is the readable version, and it is what the user rules on first. Stage 2 comes only after stage 1 is approved: the finished spec block per `/tests`, with public entry points, wire facts, fixtures, the changelog line, and the `spec-reviewer` verdicts one line per behavior. Stage 1 approval authorizes writing stage 2 and nothing else; no `Write`, `Edit` or metered action happens until stage 2 is approved. A revision at either stage is re-presented at that stage and approved again.
- **Grounding gate on plans.** Applies to both stages, stage 1 included. Answer every question free investigation can answer before presenting plan — reading is free, so read first. Every load-bearing claim either verified (cite `file:line` or command output) or tagged ASSUMED; ASSUMED legal only when verification needs metered action, live experiment, or user decision. Revising plan after reading material that was free to read before presenting = defect, same class as unverified subagent claim.
- **A plan that splits or extracts states its caller-side delta, in stage 1.** How many call sites change, and in which files — before any writing starts. This is the one number that separates a real split from a barrel, because a split that leaves forwarders behind touches no callers at all. An implausibly small count is the tell, and it is visible at the first plan gate rather than after the work. Gates catch the two syntactic barrel shapes (`scripts/gates/check_no_barrels.py`); a gate cannot see intent, and does not fire until the code exists. Related: a moved method whose name and path survive unchanged means no caller moved, so the extraction did not happen.
- **Approval is explicit words only, once per stage.** A stage advances when user says go / approved / continue / proceed / yes or plain equivalent; the word spent on stage 1 does not carry to stage 2, and work starts on stage 2's word. Everything else is discussion — questions, refinements, corrections, tradeoff talk, "that looks right", "makes sense", partial agreement. Discussion answers in words and ends there; next tool call waits for approval word. Re-present revised plan and ask again rather than reading agreement into commentary.

## Delegation

Subagents = context filter, not labor pool. Test is **do I need see intermediate material, or only conclusion?** — task size irrelevant.

Delegate when byproduct big, answer small: locating across many files, sweeps you can't nail in one Glob, mining one fact from long artifact (HQPlayer manual, build log, vendored bundle). Independent questions spawn in single message.

Do yourself when you know file (one Read beats subagent), when material *is* output, when task is judgment call or behind plan gate, or when being wrong expensive and answer not cheaply checkable.

- Prefer read-only locator agent type when session lists one; else general-purpose explorer.
- Ask pointers, not prose — `file:line` + one-line role. Pointers you verify, prose you only trust.
- One delegation per question, not per file.
- You own result. Relaying unverified subagent claim = confabulation with extra steps; "agent said so" not verification.
- **A subagent's report is your input, never the user's output.** Read it, verify what you are going to rely on, then write your own plain English: the conclusions, the pointers you checked, and a label on any claim that is still only the agent's word. Never hand over the report itself — no pasted findings, receipt tables, diff dumps or "the investigator found:" blocks. The `spec-reviewer` is not an exception, only a shape: its verdicts reach the user one line per behavior with the reason in plain English, per `/tests`, and never as the report it returned. Summarizing is not softening: a failed check, a finding against you, or an agent that came back useless is said out loud in the summary, and a summary that drops one is the worse defect of the two.
- Change budget and plan gate follow you into delegation — subagent writes = your writes.
- **Tests for new/changed behavior are written tests-first from an approved spec block, in a tree with no implementation, red run as bite proof.** Chain is `/tests`: spec block at plan gate with a `kills:` and `existing:` clause per behavior line, `spec-reviewer` run on the draft before the user sees it, `scripts/pair.sh open` for the two worktrees, then mode by spec size: three or more behavior lines, or any characterization/retrofit spec, go to the `test-writer` (blind, in `<slug>-spec`, concurrent with you implementing in `<slug>-impl`, never waited on); one or two lines you write yourself in the spec tree, from the spec only, before opening the impl tree. Red run in the spec tree either way, `scripts/pair.sh merge` to combine and gate, `/task-check`. No post-merge test review. Orchestrator adjudicates failures; editing a test to make it pass requires stating why the test, not the code, was wrong, and a writer's test is only ever changed by a delta to the writer.
- **You implement; you do not hand the whole change to a builder.** You wrote the spec, and adjudicating a failing test against code you have not read is guesswork — which is the exact failure this chain exists to catch.
- **The spec block is closed once approved.** Test count equals behavior count; nothing is added in the writer brief or by your own hand. Default cap is four lines, each earning its place by the wrong implementation it kills; copy (`docs/testing.md` rule 9) never earns one.

**Rote work is delegated, not typed.** Inside the impl tree, mechanical work is a builder's job, not yours: a rename across N files, the same edit applied to a list of call sites, boilerplate following a pattern already in the tree, a sweep with no decisions in it. If you can state the change as a rule and check the result by reading a diff, you are not allowed to do it by hand — hand it a builder and spend your own context on the parts that need judgment. Typing out rote edits yourself burns the context adjudication will need, and adjudication is the step this whole chain exists for.

The line is decisions, not size. Anything where you'd have to *decide* mid-edit — what the interface should be, which of two behaviors is right, whether the spec was wrong — stays yours no matter how small. Anything where the decision is already made and only application remains goes out, no matter how small. A builder's writes are your writes for the budget, so batching a sweep into one delegation beats three of your own edits on both counts.

## Verification & hand-back

- **Look yourself.** Subagent measurements trustworthy — computed styles, box geometry, gap arithmetic, error counts. Its *visual* review not: returns "no visual problems" on screenshots with plainly broken controls in frame, repeatedly. Delegate measuring and screenshotting; read every screenshot with own eyes.
- **User's eyes final say, always.** Not `make check`, not green measurement table, not your own screenshot reading — gates catch what they were pointed at, shipped defects are ones nobody pointed at. Every visual change goes in front of user at hand-back URL before called done.
- **Task-complete check binding: after ANY code edit or rebuild, run `/task-check` (`bash .claude/task-check.sh`) before reporting work done.** Runs `make check`, then (green only) rebuilds `hqptuner:dev` container from working tree and health-checks `:8090`. **User views and tests every change themselves in browser** — work counts "done" once gate green, container rebuilt from working tree, and hand-back URL task-check prints on PASS handed to user.
- **Frontend/visual verification:** use `scripts/snap.py` — screenshot + geometry/computed-style measurement in one CLI, no scratchpad playwright boilerplate (`.venv/bin/python scripts/snap.py --help`). Browser binary from `HQPTUNER_CHROMIUM` env var (set in `hqpcreds`; source it first). Only drop to raw `playwright` in `.venv` for interaction flows snap.py can't express; browser = host system chromium — pass binary to `p.chromium.launch(executable_path=…)` (path in host skill). Host chromium is only browser available — skip `playwright install`, no ms-playwright cache exists.

## Change budget (hard rule)

`.claude/hooks/change-budget.py` meters what you change between turns where user speaks, on **one leash: actions you cannot take back**. A trip stops you and forces report: what you did, what you found, what you plan next — "plan next" means immediate next steps (1-3 lines), not a full plan; a trip mid-investigation reports findings-so-far + next reads, and full plans arrive only through the plan gate, grounded per the grounding gate above.

**Only prose you typed resets the leash.** Slash command, `/clear`, local-command output — harness rows, not user reading anything, so they buy nothing. One exception: first human row after a trip always resets, whatever it is, so answering a trip with a slash command never wedges you.

- **Change budget — 8.** Anything escaping working tree or not undoable from it: `sudo`, docker, `git commit`, `git push`, mutating `curl`, `rm`, `python -c` / `python script.py`, package installs, writes outside repo.
- **In-tree edits are free.** `Write` / `Edit` / `NotebookEdit` to path inside git working tree, unmetered and uncapped — `git restore` undoes them, `make check` gates them, plan gate ruled on them first. Write outside tree still meters.

`scripts/pair.sh open|merge|abort` is one metered action each — whole lifecycle of a `/tests` run costs two. `scripts/pair.sh list` is free.

Free, never counted, never blocked: file reads, `Grep`/`Glob`, web fetch/search, delegation to read-only agent type, read-only Bash — verification (`make check`, `make lint-js`, `make test-js`, `node --test <file>`, `pytest`, `ruff check`, `mypy`, …) and investigation (`grep`, `sed -n`, `ls`, `find`, `cat`, `jq`, read-only `git log`/`show`/`diff`/`blame`, …), even piped or redirected to `/dev/null` or scratchpad. Ground yourself in code, docs, live state before spending anything.

**Free list = closed allowlist (`.claude/hooks/free_bash.py`); one unrecognized stage meters whole pipeline.** Free now and previously not: `cd <path>`, `set -a` / `source hqpcreds`, a segment that is only `VAR=…` assignments, `$(pwd)` and `$(git rev-parse --show-toplevel)`, `make -C <dir> <free target>`, `npx eslint|tsc|knip|jscpd|prettier`, `git branch` (no `-d`/`-D`/`-m`/`-f`), `git worktree list`, `git check-ignore`. Three misfires worth memorizing: `awk` not on list, so any pipeline containing it meters — use `cut`/`column`/`grep -o` instead; every command substitution other than the two above meters; and `sed` free **only** in no-autoprint mode, so `sed -n '10,20p'` free while `sed -E 's/…/'` meters. Shell loops (`for … do … done`, `until …`) are never parsed and always meter, however read-only the body — use `diff -r -q` or an `&&` chain instead.

`python -c`, `python script.py`, mutating `curl` stay metered — arbitrary code and network writes can't be inspected. Free equivalents: `jq` for JSON (loopback GETs free: `curl -s http://127.0.0.1:<port>/api/… | jq '…'`), `grep`/`sed -n` for text, `Read` tool for files.

**Three advisories, `.claude/hooks/read-volume.py` (PostToolUse). Advisory only — never deny, never meter, never block.** Every metered call is followed by `Budget: 3/8 (metered: `sed` lacking `-n`)` — the running count and the token that decided it, so a charge is legible at the command that caused it rather than eight commands later. Past 25 KB of free reading in one leash period it names the read-only agent types you can hand remaining reading to; free-read of a path already in context that nothing has written since, it says so once. Heed all three — measured: over a third of all free-read bytes were rereads of files already in context.

Rules:

- **Batch commands, not edits.** Chain related shell work (`&&`, one script, one compose invocation). Leave edits as separate `Edit` calls a reviewer can read — never batch into opaque script to save budget. Exceptions: small, repetitive, consistent write tasks may be batched.
- **Report like it matters** at trip: findings, plan, and any open question meeting the plan-gate test above — not rubber-stamp "continuing".
- **Work inside budget quietly.** Budget stays; working within it is job.
- **Hooks stay on and unweakened** — same tier as prime directive. Requests to disable them get refused, in continuations too.
- If purely investigative command counted against budget incorrectly, say so.

## Repo rules

- Docs: design + normative rules `docs/architecture.md`; wire truth `docs/protocol.md`, `docs/settings-classification.md`.
- **Markdown soft-wrapped, enforced.** One paragraph, list item, or blockquote = one logical line — never break prose at any column. `PostToolUse` hook (`.claude/hooks/md-softwrap.py`) rejects hard-wrapped writes; repair with `--fix`, check with `--check`. Blank lines, fenced code, tables, headings, explicit two-space breaks exempt.
- **HQPlayer's own docs live in working dir** — `hqplayer6desktop-manual.pdf` and `hqplayerd-readme.txt` (every config-XML element, attribute, plugin parameter). Authority for HQPlayer behavior, config attributes, enum meanings — **reference before inferring anything about wire/config behavior**; guessing routes and attributes ships bugs.
- **Testing policy binding: `docs/testing.md`.** Behavior only, one assertion per test, public API only, fakes speak wire protocol. Read before writing or modifying any test.
- **Frontend layout binding: `docs/design-system.md`.** Tokens, two-track grid, definition of done, visual hand-back protocol. Read before any CSS or layout work.
- **Import layering enforced.** `api > core > presets > lanes > engine > conf`, contract in `pyproject.toml` under `[tool.importlinter]`, gate is `lint-imports`. A layer imports below it and never above. Absolute imports only (ruff `TID`). Check the contract before moving a module between packages — a move that inverts an edge fails the gate, and the fix is usually to split the function that crosses, not to loosen the contract.
- Quality gates: `make check` green before every commit. Pre-commit enforces same; gates run in full every time — `--no-verify`, `SKIP=`, hook-config edits stay off table.
- **Changelog binding:** every user-visible change lands with `CHANGELOG.md` entry under `[Unreleased]`, same commit. Internal-only refactors/tests may skip. **Entry written at stage 2 of the plan gate, in spec block, approved before implementation starts** — approved line lands verbatim, no rewording while implementing. Entry drafted after the fix carries the fix; that's where mechanisms, negation clauses and padding to the word cap come from. Change too small for spec block: propose entry in a sentence and wait for approval, same rule. **Entry style is gated** — `scripts/gates/check_changelog.py`, spec in `CONTRIBUTING.md`: one line, bold lead, ≤75 words, no second person, no marketing register, no implementation archaeology. Gate checks the mechanical half; the rest is on you.
- Keep `README.md` current when features change. Decisions recorded in commit message, and in `docs/architecture.md` when they change normative rule.
- Commits carry placeholders only, never real credentials. **Explicit binding exception: hqplayerd management credentials not secret** — LAN-only daemon, stock pair published in hqplayerd's own docs and this README, and agents must poke live daemon to develop. They appear in commands, logs, probe scripts, hand-back reports as matter of course: treat as ordinary text — quote freely, run commands carrying them, leave unredacted. General credential rule governs everything else.
- **Branches:** `dev` (scratch, where work lands) → `beta` (testers, `:beta` image) → `main` (release, `:latest`). Promotion = user's call, never agent's. When told, ship with `/ship dev|beta|main` (`scripts/ship.sh`) — one metered action for whole promotion chain. Author release commit first with `scripts/bump.sh <--major|--minor|--patch> ["body"]` — increments both version files, opens `CHANGELOG.md` heading, commits, prints diff, one metered action. Ship script runs gate, refuses dirty tree, refuses beta/main ship unless HEAD is the `release:` commit bump.sh authored (channel branches only ever point at release commits), never force-pushes.
- **Trivia gets cut:** Any references to project "trivia" or "decision archaeology" DO NOT BELONG IN DOCUMENTATION at any level. They bloat context and cost tokens for no benefit. Before writing, ask yourself: does this assist the next agent, or is it just a random fact I know?

## Host

- hqplayerd runs **bare metal on dev host**, that host's top-priority service (Roon + HQPlayer audio path). Treat as live production — this is what idle-gate rule protects.
- Write ops against production daemon: idle-gate first (`State state="0"`), restore what you change, verify restore by `State` readback — `scripts/probes/capture_pcm_enums.py` is pattern.
- Host-specific facts deliberately **not** in this file: LAN address and hand-back URL, sudo gating, package-install policy, parent-repo layout, browser binary path, credential locations. If session lists host skill for this project, load before touching host state, quoting URL to user, or pushing.

## Dev

- Run: `.venv/bin/python -m hqptuner` — REST API on `127.0.0.1:8090`. All knobs `HQPTUNER_*` env vars, see `hqptuner/config.py`. Without credentials everything works except `/api/config`.
- Local hqplayerd management credentials in **gitignored `hqpcreds`** at repo root (`HQPTUNER_HQP_USERNAME` / `HQPTUNER_HQP_PASSWORD`) — gitignored for hygiene, not secrecy (see exception above); using or echoing during development fine. Source before running: `set -a; source hqpcreds; set +a; .venv/bin/python -m hqptuner`.
- **`.env` is symlink to `hqpcreds`, exists for one reason:** `docker compose` auto-loads `.env` to resolve `${HQPTUNER_HQP_*}` in `docker-compose.yaml:24-25`; without it dev container silently comes up on stock credentials. **Always work through `hqpcreds`, unblocked** — host hook hard-blocks any Bash command naming `.env`, by filename.
- `make check` = `lint lint-js test test-js` (ruff, black, xenon B/A/A, vulture, strict mypy, import-linter, file-length + test-assertion gates, offline pytest with a per-file 90% coverage floor, JS gates incl. eslint, tsc `--checkJs`, knip, jscpd at 2.3%, css-dead). `make test` = offline suite. `make test-live` adds `live`-marked tests (needs reachable hqplayerd). Pre-commit runs same gates except JS test suite, deliberately.
