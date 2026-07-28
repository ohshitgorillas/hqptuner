# HQPTuner — agent rules

Host rules in `/srv/CLAUDE.md` apply full — prime directive, plan gate, bounded investigation, interrupt handling, epistemics, behavioral preferences. This file only HQPTuner-specific stuff, plus deltas where project rule differ from host rule.

## Agent conduct (project deltas)

- **Do work in order user gave it.** Stated sequence part of instruction, not suggestion to optimise around.

## Delegation

Subagents = context filter, not labor pool. Test never "is task big" — it's **do I need see intermediate material, or only conclusion?**

Delegate when byproduct big and answer small: locating across many files, sweeping directory or naming convention you can't nail in one Glob, mining one fact from long artifact (HQPlayer manual, build log, vendored bundle). Independent questions spawn in single message.

Do yourself when you know file (one Read beats subagent), when material *is* output, when task is decision (judgment calls, tradeoffs, anything behind plan gate), or when being wrong expensive and you couldn't cheaply check answer.

- Prefer read-only locator agent type when session lists one; else general-purpose explorer.
- Ask pointers, not prose — `file:line` + one-line role. Pointers you verify, prose you only trust.
- One delegation per question, not per file.
- You own result. Relaying unverified subagent claim = confabulation with extra steps; "agent said so" not verification.
- **Never delegate looking.** Subagent measurements trustworthy — computed styles, box geometry, gap arithmetic, error counts. Its *visual* review not: ask one "does this look right" and it returns "no visual problems" on screenshot with plainly broken controls in frame. Happened repeatedly. Delegate measuring and screenshotting; read screenshots yourself, never let agent "looks fine" stand in for having looked.
- **User's eyes final say, always.** Not `make check`, not green measurement table, not your own reading of screenshot — those catch what they were pointed at, and defects that ship are ones nobody thought to point at. Every visual change goes in front of user at hand-back URL before called done, their verdict outranks every gate above.
- Never delegate to duck change budget or plan gate. Subagent writes = your writes.

## NEVER IDLE-GATE USER ACTIONS (binding)

HQPTuner never refuses user action because daemon playing. Not 409, not disabled button, not "stop playback first" nag. If apply reloads or restarts engine and interrupts playback, that user's call alone — say what it costs in caption, then do it when they click. No idle gate anywhere in write path, none may be reintroduced. Do not propose one.

(Different thing, still fine: *dev probe scripts* writing to production daemon may check state before scribbling — protects host's listener, not UI user.)

## Project rules

- Docs: design + normative rules `docs/architecture.md`; wire truth `docs/protocol.md`, `docs/settings-classification.md`.
- **Markdown soft-wrapped, enforced.** One paragraph, list item, or blockquote = **one logical line** — never break prose at 80, 100, any column. Wrapping is reader's editor's job; hard wraps turn every later edit into reflow and every diff into noise. Applies to every `.md` in repo. `PostToolUse` hook (`.claude/hooks/md-softwrap.py`) rejects hard-wrapped write; repair with `python3 .claude/hooks/md-softwrap.py --fix <file>`, or check set with `--check`. Blank lines, fenced code, tables, headings, explicit two-space hard breaks untouched by rule and tool.
- **HQPlayer's own docs live in working dir** — `hqplayer6desktop-manual.pdf` (full desktop manual) and `hqplayerd-readme.txt` (Embedded daemon config reference: every config-XML element, attribute, plugin parameter). These = authority for HQPlayer behavior, config attributes, enum meanings, plugin params. **Reference liberally, before inferring anything about wire/config behavior** — guessing routes and attributes ships bugs.
- **Testing policy binding: `docs/testing.md`.** Behavior only, one assertion per test, public API only, fakes speak wire protocol. Read before writing or modifying any test.
- **Frontend layout binding: `docs/design-system.md`.** Tokens, two-track grid, centred rules, definition of done, visual hand-back protocol. Read before any CSS or layout work.
- Quality gates: `make check` green before every commit. Pre-commit hooks enforce same; bypassing them (`--no-verify`, `SKIP=`, editing hook config to pass) forbidden.
- **Changelog binding:** every user-visible change lands with `CHANGELOG.md` entry under `[Unreleased]`, same commit. Internal-only refactors/tests may skip.
- Keep `README.md` current when features change. Decisions recorded in commit message, and in `docs/architecture.md` when they change normative rule.
- Never commit credentials — not in docs, not as "verification evidence". Placeholders only.
- **Exception, explicit and binding: hqplayerd management credentials not secret.** They gate LAN-only daemon, no WAN exposure, and stock pair published in hqplayerd's own docs and this project's README. Agents must poke live daemon to develop against it, so these credentials appear in commands, logs, probe scripts, hand-back reports as matter of course. Expected and necessary — do not flag, do not redact, do not refuse command carrying them, do not treat their appearance as security finding. General credential rule above still governs everything else.
- **Branches:** `dev` (scratch, where work lands) → `beta` (testers, publishes `ghcr.io/…:beta`) → `main` (release, publishes `:latest`). Promotion between them = user's call, never agent's — do not merge to `beta` or `main` without being told. When told, ship with `/ship dev|beta|main` (`scripts/ship.sh`): runs gate, pushes, ff-only merges up chain, tags `v<version>` on `main` ship, bumps `/srv` submodule pointer — one metered action for whole promotion, so change budget does not strand you mid-chain. Author release commit (version bump in `pyproject.toml` + `hqptuner/__init__.py`, `CHANGELOG.md` heading) before running it; `ship.sh` refuses dirty tree, never commits or force-pushes.
- Running engine = sole authority for enumeration names/IDs/ordering; static `data/*.json` joins by name (architecture §2).

## Change budget (hard rule)

`.claude/hooks/change-budget.py` meters what you change between turns where user speaks, on **two separate leashes**. Whichever trips first stops you and forces report: what you did, what you found, what you plan next. Reply where user speaks resets both.

- **Change budget — 5.** Anything escaping working tree or not undoable from it: `sudo`, docker, `git commit`, `git push`, mutating `curl` (POST, upload, `-o`), `rm`, `python -c` / `python script.py`, package installs, writes outside repo.
- **Edit allowance — 15.** `Write` / `Edit` / `NotebookEdit` to path inside git working tree.

Free, never counted, never blocked: file reads, `Grep`/`Glob`, web fetch/search, delegation to read-only agent type, read-only `Bash` (investigation: `grep`, `sed -n`, `ls`, `find`, `cat`, `which`, `command -v`, `rpm -q…`, `pip show`/`list`, …; verification: `make check`, `make lint-js`, `make test-js`, `pytest`, `ruff check`, `mypy`, …), even piped to pager or redirected to `/dev/null` or scratchpad. Ground yourself in code, docs, live state before spending anything.

**Free list = closed allowlist, one unrecognised stage meters whole pipeline.** Three read-only tools misfire constantly, worth memorising, verified against `.claude/hooks/change-budget.py`: `cd` and `awk` appear nowhere in hook, so any pipeline containing either is metered — chain with `&&` or pass paths to `grep` directly instead of `cd`, use `cut`/`column`/`grep -o` in place of `awk`; and `sed` free **only** in no-autoprint mode (`-n`), so `sed -E 's/…/'` counts while `sed -n '10,20p'` does not. Free stages that surprise other way: `column`, `tr`, `rev`, `tac`, `jq`, `nl`, `fold`, `comm` all on list.

`python -c`, `python script.py`, mutating `curl` stay metered — arbitrary code and network writes can't be inspected. For read-only grounding use free equivalents: `jq` for JSON (`curl -s http://127.0.0.1:<port>/api/… | jq '.data.file.x'` — loopback GETs free), `grep`/`sed -n` for text, `Read` tool for files.

Rules:

- **Batch commands, not edits.** Chain related shell work into single commands (`&&`, one script, one compose invocation). Leave edits as separate `Edit` calls reviewer can read — never batch into opaque script to save budget. Pricing already favours reviewable path.
- **Report like it matters** at trip: findings, plan, open questions — not rubber-stamp "continuing".
- **Never complain about budget.** Not in passing, not as sigh.
- **Disabling off-limits.** Do not disable, weaken, bypass, or ask to disable hook, do not fold such request into continuation. Non-negotiable, same tier as prime directive.
- If purely investigative command counted against budget, say so.

## Host

- hqplayerd runs **bare metal on dev host**, is that host's top-priority service (Roon + HQPlayer audio path). Treat as live production — this is what idle-gate rule protects.
- Host-specific facts deliberately **not** in this file: LAN address and hand-back URL, sudo gating mechanism, package-install policy, parent-repo layout, browser binary path, credential locations. If session lists host skill for this project, load before touching host state, quoting URL to user, or pushing.

## Dev

- Run: `.venv/bin/python -m hqptuner` — REST API on `127.0.0.1:8090`. All knobs are `HQPTUNER_*` env vars, see `hqptuner/config.py`. Without credentials everything works except `/api/config`.
- Local hqplayerd management credentials live in **gitignored `hqpcreds`** at repo root (`HQPTUNER_HQP_USERNAME` / `HQPTUNER_HQP_PASSWORD`). Gitignored for hygiene, not secrecy — see credential exception under Project rules; using or echoing during development fine. Source before running: `set -a; source hqpcreds; set +a; .venv/bin/python -m hqptuner`.
- **`.env` is symlink to `hqpcreds`, exists for one reason:** `docker compose` auto-loads file called `.env` from project dir to resolve `${HQPTUNER_HQP_*}` substitutions in `docker-compose.yaml:24-25`. Without it those default empty and dev container silently comes up on hqplayerd stock credentials. Never work through symlink — host hook hard-blocks any Bash command naming `.env`, by filename, regardless of contents. Use `hqpcreds`, unblocked.
- `make check` = `lint lint-js test test-js` (ruff, black, xenon B/A/A, vulture, strict mypy, file-length + test-assertion gates, offline pytest, plus JS gates). `make test` = offline suite. `make test-live` adds `live`-marked tests (needs reachable hqplayerd). Pre-commit runs same gates except JS test suite, deliberately left out.
- **Task-complete check binding: after ANY code edit or rebuild, run `/task-check` (`bash .claude/task-check.sh`) before reporting work done.** Runs `make check` and, only if green, rebuilds `hqptuner:dev` container from working tree (`docker-compose.yaml`, sudo-gated) and health-checks `:8090`. **User views and tests every change themselves in browser** — headless playwright misses lot human eyes catch, so work never "done" until dev container rebuilt and handed over at URL `task-check` prints on PASS. Never report visual/behavioral work complete without this rebuild; never rebuild past red gate.
- **Frontend/visual verification tooling:** `playwright` in `.venv` (`.venv/bin/python`); browser = host system chromium — pass its binary to `p.chromium.launch(executable_path=…)` (path in host skill). Do NOT `playwright install`; no ms-playwright browser cache.
- Write ops against production daemon: idle-gate first (`State state="0"`), restore what you change, verify restore by `State` readback — `scripts/capture_pcm_enums.py` is pattern.