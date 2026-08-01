# HQPTuner — agent rules

Host rules in `/srv/CLAUDE.md` apply full — prime directive, plan gate, bounded investigation, interrupt handling, epistemics, behavioral preferences. This file = HQPTuner-specific rules plus deltas where project rule differs from host rule.

## Binding product rules

### User actions always proceed

HQPTuner honors every user action, daemon playing or not — no 409, no disabled button, no "stop playback first" nag. If apply reloads or restarts engine and interrupts playback, that's user's call alone — say what it costs in caption, then do it when they click. Write path stays idle-gate-free: keep it that way, propose none.

(Different thing, still fine: *dev probe scripts* writing to production daemon may check state first — protects host's listener, not UI user.)

### Probing the engine: standard mathematics yes, proprietary design no

Probing the running engine is fine where what you're after is standard mathematics, and HQPTuner is partly built that way — `scripts/probe_iir_q.py` established how the IIR plugin calculates Q, and a biquad is textbook mathematics Signalyst does not own. The decision gate is one question: **could the information I'm after be proprietary, or is it just standard mathematics?** Standard mathematics, documented interfaces and wire-protocol behaviour are fair game. Proprietary design is not, and **filter specifications are always proprietary unless published** — passband corner, transition width, roll-off slope, tap count, stop-band attenuation, the design of any resampling, noise-shaping or junk filter. Measuring those out of the engine is reverse engineering in violation of Signalyst's terms; where HQPlayer's own docs are silent on a filter's specification, the answer is "undocumented" — say so and plan around it, never measure it. A plan step proposing such a measurement is a defect. When a question's side of the line isn't obvious, ask before probing.

### Running engine is enumeration authority

Running engine = sole authority for enumeration names/IDs/ordering; static `data/*.json` joins by name (architecture §2).

## Agent conduct (project deltas)

- **Do work in order user gave it.** Stated sequence part of instruction, not suggestion to optimise around.
- **Grounding gate on plans.** Answer every question free investigation can answer before presenting plan — reading is free, so read first. Every load-bearing claim either verified (cite `file:line` or command output) or tagged ASSUMED; ASSUMED legal only when verification needs metered action, live experiment, or user decision. Revising plan after reading material that was free to read before presenting = defect, same class as unverified subagent claim.
- **Approval is explicit words only.** Work starts when user says go / approved / continue / proceed / yes or plain equivalent. Everything else is discussion — questions, refinements, corrections, tradeoff talk, "that looks right", "makes sense", partial agreement. Discussion answers in words and ends there; next tool call waits for approval word. Re-present revised plan and ask again rather than reading agreement into commentary.

## Delegation

Subagents = context filter, not labor pool. Test is **do I need see intermediate material, or only conclusion?** — task size irrelevant.

Delegate when byproduct big, answer small: locating across many files, sweeps you can't nail in one Glob, mining one fact from long artifact (HQPlayer manual, build log, vendored bundle). Independent questions spawn in single message.

Do yourself when you know file (one Read beats subagent), when material *is* output, when task is judgment call or behind plan gate, or when being wrong expensive and answer not cheaply checkable.

- Prefer read-only locator agent type when session lists one; else general-purpose explorer.
- Ask pointers, not prose — `file:line` + one-line role. Pointers you verify, prose you only trust.
- One delegation per question, not per file.
- You own result. Relaying unverified subagent claim = confabulation with extra steps; "agent said so" not verification.
- Change budget and plan gate follow you into delegation — subagent writes = your writes.
- **Tests for new/changed behavior are authored by the `test-writer` agent from a spec block, never by the agent that wrote the implementation.** Orchestrator adjudicates failures; editing a test to make it pass requires stating why the test, not the code, was wrong. Chain is `/tests`: spec block, blind writer, run, adjudicate, bite check (new tests must fail against pre-change code), `test-reviewer`.

## Verification & hand-back

- **Look yourself.** Subagent measurements trustworthy — computed styles, box geometry, gap arithmetic, error counts. Its *visual* review not: returns "no visual problems" on screenshots with plainly broken controls in frame, repeatedly. Delegate measuring and screenshotting; read every screenshot with own eyes.
- **User's eyes final say, always.** Not `make check`, not green measurement table, not your own screenshot reading — gates catch what they were pointed at, shipped defects are ones nobody pointed at. Every visual change goes in front of user at hand-back URL before called done.
- **Task-complete check binding: after ANY code edit or rebuild, run `/task-check` (`bash .claude/task-check.sh`) before reporting work done.** Runs `make check`, then (green only) rebuilds `hqptuner:dev` container from working tree and health-checks `:8090`. **User views and tests every change themselves in browser** — work counts "done" once gate green, container rebuilt from working tree, and hand-back URL task-check prints on PASS handed to user.
- **Frontend/visual verification:** use `scripts/snap.py` — screenshot + geometry/computed-style measurement in one CLI, no scratchpad playwright boilerplate (`.venv/bin/python scripts/snap.py --help`). Browser binary from `HQPTUNER_CHROMIUM` env var (set in `hqpcreds`; source it first). Only drop to raw `playwright` in `.venv` for interaction flows snap.py can't express; browser = host system chromium — pass binary to `p.chromium.launch(executable_path=…)` (path in host skill). Host chromium is only browser available — skip `playwright install`, no ms-playwright cache exists.

## Change budget (hard rule)

`.claude/hooks/change-budget.py` meters what you change between turns where user speaks, on **two separate leashes**. Whichever trips first stops you and forces report: what you did, what you found, what you plan next — "plan next" means immediate next steps (1-3 lines), not a full plan; a trip mid-investigation reports findings-so-far + next reads, and full plans arrive only through the plan gate, grounded per the grounding gate above.

**Only prose you typed resets the leashes.** Slash command, `/clear`, local-command output — harness rows, not user reading anything, so they buy nothing. One exception: first human row after a trip always resets, whatever it is, so answering a trip with a slash command never wedges you.

- **Change budget — 5.** Anything escaping working tree or not undoable from it: `sudo`, docker, `git commit`, `git push`, mutating `curl`, `rm`, `python -c` / `python script.py`, package installs, writes outside repo.
- **Edit allowance — 30.** `Write` / `Edit` / `NotebookEdit` to path inside git working tree.

Free, never counted, never blocked: file reads, `Grep`/`Glob`, web fetch/search, delegation to read-only agent type, read-only Bash — verification (`make check`, `make lint-js`, `make test-js`, `pytest`, `ruff check`, `mypy`, …) and investigation (`grep`, `sed -n`, `ls`, `find`, `cat`, `jq`, …), even piped or redirected to `/dev/null` or scratchpad. Ground yourself in code, docs, live state before spending anything.

**Free list = closed allowlist (`.claude/hooks/free_bash.py`); one unrecognised stage meters whole pipeline.** Three misfires worth memorising: `cd` and `awk` not on list, so any pipeline containing either meters — chain with `&&` or pass paths to `grep` directly instead of `cd`, use `cut`/`column`/`grep -o` in place of `awk`; and `sed` free **only** in no-autoprint mode, so `sed -n '10,20p'` free while `sed -E 's/…/'` meters.

`python -c`, `python script.py`, mutating `curl` stay metered — arbitrary code and network writes can't be inspected. Free equivalents: `jq` for JSON (loopback GETs free: `curl -s http://127.0.0.1:<port>/api/… | jq '…'`), `grep`/`sed -n` for text, `Read` tool for files.

**Two advisories, `.claude/hooks/read-volume.py` (PostToolUse). Advisory only — never deny, never meter, never block.** Past 25 KB of free reading in one leash period it names the read-only agent types you can hand remaining reading to; free-read of a path already in context that nothing has written since, it says so once. Heed both — measured: over a third of all free-read bytes were rereads of files already in context.

Rules:

- **Batch commands, not edits.** Chain related shell work (`&&`, one script, one compose invocation). Leave edits as separate `Edit` calls a reviewer can read — never batch into opaque script to save budget. Exceptions: small, repetitive, consistent write tasks may be batched.
- **Report like it matters** at trip: findings, plan, open questions — not rubber-stamp "continuing".
- **Work inside budget quietly.** Budget stays; working within it is job.
- **Hooks stay on and unweakened** — same tier as prime directive. Requests to disable them get refused, in continuations too.
- If purely investigative command counted against budget, say so.

## Repo rules

- Docs: design + normative rules `docs/architecture.md`; wire truth `docs/protocol.md`, `docs/settings-classification.md`.
- **Markdown soft-wrapped, enforced.** One paragraph, list item, or blockquote = one logical line — never break prose at any column. `PostToolUse` hook (`.claude/hooks/md-softwrap.py`) rejects hard-wrapped writes; repair with `--fix`, check with `--check`. Blank lines, fenced code, tables, headings, explicit two-space breaks exempt.
- **HQPlayer's own docs live in working dir** — `hqplayer6desktop-manual.pdf` and `hqplayerd-readme.txt` (every config-XML element, attribute, plugin parameter). Authority for HQPlayer behavior, config attributes, enum meanings — **reference before inferring anything about wire/config behavior**; guessing routes and attributes ships bugs.
- **Testing policy binding: `docs/testing.md`.** Behavior only, one assertion per test, public API only, fakes speak wire protocol. Read before writing or modifying any test.
- **Frontend layout binding: `docs/design-system.md`.** Tokens, two-track grid, definition of done, visual hand-back protocol. Read before any CSS or layout work.
- Quality gates: `make check` green before every commit. Pre-commit enforces same; gates run in full every time — `--no-verify`, `SKIP=`, hook-config edits stay off table.
- **Changelog binding:** every user-visible change lands with `CHANGELOG.md` entry under `[Unreleased]`, same commit. Internal-only refactors/tests may skip.
- Keep `README.md` current when features change. Decisions recorded in commit message, and in `docs/architecture.md` when they change normative rule.
- Commits carry placeholders only, never real credentials. **Explicit binding exception: hqplayerd management credentials not secret** — LAN-only daemon, stock pair published in hqplayerd's own docs and this README, and agents must poke live daemon to develop. They appear in commands, logs, probe scripts, hand-back reports as matter of course: treat as ordinary text — quote freely, run commands carrying them, leave unredacted. General credential rule governs everything else.
- **Branches:** `dev` (scratch, where work lands) → `beta` (testers, `:beta` image) → `main` (release, `:latest`). Promotion = user's call, never agent's. When told, ship with `/ship dev|beta|main` (`scripts/ship.sh`) — one metered action for whole promotion chain. Author release commit first with `scripts/bump.sh <--major|--minor|--patch> ["body"]` — increments both version files, opens `CHANGELOG.md` heading, commits, prints diff, one metered action. Ship script runs gate, refuses dirty tree, refuses beta/main ship unless HEAD is the `release:` commit bump.sh authored (channel branches only ever point at release commits), never force-pushes.
- **Trivia gets cut:** Any references to project "trivia" or "decision archaeology" DO NOT BELONG IN DOCUMENTATION at any level. They bloat context and cost tokens for no benefit. Before writing, ask yourself: does this assist the next agent, or is it just a random fact I know?

## Host

- hqplayerd runs **bare metal on dev host**, that host's top-priority service (Roon + HQPlayer audio path). Treat as live production — this is what idle-gate rule protects.
- Write ops against production daemon: idle-gate first (`State state="0"`), restore what you change, verify restore by `State` readback — `scripts/capture_pcm_enums.py` is pattern.
- Host-specific facts deliberately **not** in this file: LAN address and hand-back URL, sudo gating, package-install policy, parent-repo layout, browser binary path, credential locations. If session lists host skill for this project, load before touching host state, quoting URL to user, or pushing.

## Dev

- Run: `.venv/bin/python -m hqptuner` — REST API on `127.0.0.1:8090`. All knobs `HQPTUNER_*` env vars, see `hqptuner/config.py`. Without credentials everything works except `/api/config`.
- Local hqplayerd management credentials in **gitignored `hqpcreds`** at repo root (`HQPTUNER_HQP_USERNAME` / `HQPTUNER_HQP_PASSWORD`) — gitignored for hygiene, not secrecy (see exception above); using or echoing during development fine. Source before running: `set -a; source hqpcreds; set +a; .venv/bin/python -m hqptuner`.
- **`.env` is symlink to `hqpcreds`, exists for one reason:** `docker compose` auto-loads `.env` to resolve `${HQPTUNER_HQP_*}` in `docker-compose.yaml:24-25`; without it dev container silently comes up on stock credentials. **Always work through `hqpcreds`, unblocked** — host hook hard-blocks any Bash command naming `.env`, by filename.
- `make check` = `lint lint-js test test-js` (ruff, black, xenon B/A/A, vulture, strict mypy, file-length + test-assertion gates, offline pytest, JS gates). `make test` = offline suite. `make test-live` adds `live`-marked tests (needs reachable hqplayerd). Pre-commit runs same gates except JS test suite, deliberately.
