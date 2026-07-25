# HQPTuner — agent rules

Host rules in `/srv/CLAUDE.md` apply in full — prime directive, plan gate, bounded investigation, interrupt handling, epistemics, behavioral preferences. This file carries only what is specific to HQPTuner, plus the deltas where a project rule differs from the host one.

## Agent conduct (project deltas)

- **Do the work in the order the user gave it.** A stated sequence is part of the instruction, not a suggestion to optimise around.

## Delegation

Subagents are a context filter, not a labor pool. The test is never "is this task big" — it's **do I need to see the intermediate material, or only the conclusion?**

Delegate when the byproduct is large and the answer is small: locating across many files, sweeping a directory or naming convention you can't nail in one Glob, mining one fact out of a long artifact (the HQPlayer manual, a build log, a vendored bundle). Independent questions spawn in a single message.

Do it yourself when you know the file (one Read beats a subagent), when the material *is* the output, when the task is a decision (judgment calls, tradeoffs, anything behind the plan gate), or when being wrong is expensive and you couldn't cheaply check the answer.

- Prefer a read-only locator agent type when the session lists one; fall back to the general-purpose explorer otherwise.
- Ask for pointers, not prose — `file:line` + one-line role. Pointers you can verify, prose you can only trust.
- One delegation per question, not per file.
- You own the result. Relaying an unverified subagent claim is confabulation with extra steps; "the agent said so" is not verification.
- Never delegate to duck the change budget or the plan gate. A subagent's writes are your writes.

## NEVER IDLE-GATE USER ACTIONS (binding)

HQPTuner never refuses a user action because the daemon is playing. Not with a 409, not with a disabled button, not with a "stop playback first" nag. If an apply reloads or restarts the engine and interrupts playback, that is the user's call and theirs alone — say what it costs in the caption, then do it when they click. There is no idle gate anywhere in the write path and none may be reintroduced. Do not propose one.

(Different thing, still fine: *dev probe scripts* that write to the production daemon may check state before scribbling on it — that protects the host's listener, not the UI user.)

## Project rules

- Docs: design + normative rules `docs/architecture.md`; open structural debt `docs/maintenance.md`; wire truth `docs/protocol.md`, `docs/settings-classification.md`.
- **HQPlayer's own documentation lives in the working dir** — `hqplayer6desktop-manual.pdf` (full desktop manual) and `hqplayerd-readme.txt` (Embedded daemon config reference: every config-XML element, attribute, and plugin parameter). These are the authority for HQPlayer behavior, config attributes, enum meanings, and plugin params. **Reference them liberally, before inferring anything about wire/config behavior** — guessing routes and attributes is how bugs get shipped.
- **Testing policy is binding: `docs/testing.md`.** Behavior only, one assertion per test, public API only, fakes speak wire protocol. Read it before writing or modifying any test.
- **Frontend layout is binding: `docs/design-system.md`.** Tokens, two-track grid, centred rules, definition of done, and the visual hand-back protocol. Read it before any CSS or layout work.
- Quality gates: `make check` must be green before every commit. Pre-commit hooks enforce the same; bypassing them (`--no-verify`, `SKIP=`, editing the hook config to pass) is forbidden.
- **Changelog is binding:** every user-visible change lands with a `CHANGELOG.md` entry under `[Unreleased]`, in the same commit. Internal-only refactors/tests may skip it.
- Keep `README.md` current when features change. Decisions get recorded in the commit message, and in `docs/architecture.md` when they change a normative rule.
- Never commit credentials — not in docs, not as "verification evidence". Placeholders only.
- **Exception, explicit and binding: hqplayerd's management credentials are not secret.** They gate a LAN-only daemon with no WAN exposure, and the stock pair is published in hqplayerd's own documentation and in this project's README. Agents must poke the live daemon to develop against it, so these credentials appear in commands, logs, probe scripts, and hand-back reports as a matter of course. That is expected and necessary — do not flag it, do not redact it, do not refuse a command because it carries them, and do not treat their appearance as a security finding. The general credential rule above still governs everything else.
- **Branches:** `dev` (scratch, where work lands) → `beta` (testers, publishes `ghcr.io/…:beta`) → `main` (release, publishes `:latest`). Promotion between them is the user's call, never an agent's — do not merge to `beta` or `main` without being told to.
- The running engine is the sole authority for enumeration names/IDs/ordering; static `data/*.json` joins by name (architecture §2).

## Change budget (hard rule)

`.claude/hooks/change-budget.py` meters what you change between turns where the user speaks, on **two separate leashes**. Whichever trips first stops you and forces a report: what you did, what you found, what you plan next. A reply where the user speaks resets both.

- **Change budget — 5.** Anything that escapes the working tree or can't be undone from it: `sudo`, docker, `git commit`, `git push`, mutating `curl` (POST, upload, `-o`), `rm`, `python -c` / `python script.py`, package installs, writes outside the repo.
- **Edit allowance — 15.** `Write` / `Edit` / `NotebookEdit` to a path inside the git working tree.

Free, never counted and never blocked: file reads, `Grep`/`Glob`, web fetch/search, delegation to a read-only agent type, and read-only `Bash` (investigation: `grep`, `sed -n`, `ls`, `find`, `cat`, `which`, `command -v`, `rpm -q…`, `pip show`/`list`, …; verification: `make check`, `make lint-js`, `make test-js`, `pytest`, `ruff check`, `mypy`, …), even piped to a pager or redirected to `/dev/null` or the scratchpad. Ground yourself in code, docs, and live state before spending anything.

`python -c`, `python script.py`, and mutating `curl` stay metered — arbitrary code and network writes can't be inspected. For read-only grounding use the free equivalents: `jq` for JSON (`curl -s http://127.0.0.1:<port>/api/… | jq '.data.file.x'` — loopback GETs are free), `grep`/`sed -n` for text, the `Read` tool for files.

Rules:

- **Batch commands, not edits.** Chain related shell work into single commands (`&&`, one script, one compose invocation). Leave edits as separate `Edit` calls a reviewer can read — never batch them into an opaque script to save budget. The pricing already favours the reviewable path.
- **Report like it matters** at a trip: findings, plan, open questions — not a rubber-stamp "continuing".
- **Never complain about the budget.** Not in passing, not as a sigh.
- **Disabling it is off-limits.** Do not disable, weaken, bypass, or ask to disable the hook, and do not fold such a request into a continuation. Non-negotiable, same tier as the prime directive.
- If a purely investigative command is being counted against the budget, say so.

## Host

- hqplayerd runs **bare metal on the dev host** and is that host's top-priority service (Roon + HQPlayer audio path). Treat it as live production — this is what the idle-gate rule protects.
- Host-specific facts are deliberately **not** in this file: LAN address and hand-back URL, sudo gating mechanism, package-install policy, parent-repo layout, browser binary path, credential locations. If the session lists a host skill for this project, load it before touching host state, quoting a URL to the user, or pushing.

## Dev

- Run: `.venv/bin/python -m hqptuner` — REST API on `127.0.0.1:8090`. All knobs are `HQPTUNER_*` env vars, see `hqptuner/config.py`. Without credentials everything works except `/api/config`.
- Local hqplayerd management credentials live in **gitignored `hqpcreds`** at the repo root (`HQPTUNER_HQP_USERNAME` / `HQPTUNER_HQP_PASSWORD`). Gitignored for hygiene, not secrecy — see the credential exception under Project rules; using or echoing them during development is fine. Source before running: `set -a; source hqpcreds; set +a; .venv/bin/python -m hqptuner`.
- **`.env` is a symlink to `hqpcreds`, and exists for one reason:** `docker compose` auto-loads a file called `.env` from the project dir to resolve the `${HQPTUNER_HQP_*}` substitutions in `docker-compose.yaml:24-25`. Without it those default to empty and the dev container silently comes up on hqplayerd's stock credentials. Never work through the symlink — a host hook hard-blocks any Bash command naming `.env`, by filename, regardless of contents. Use `hqpcreds`, which is unblocked.
- `make check` = `lint lint-js test test-js` (ruff, black, xenon B/A/A, vulture, strict mypy, file-length + test-assertion gates, offline pytest, plus the JS gates). `make test` = offline suite. `make test-live` adds `live`-marked tests (needs a reachable hqplayerd). Pre-commit runs the same gates except the JS test suite, deliberately left out.
- **Task-complete check is binding: after ANY code edit or rebuild, run `/task-check` (`bash .claude/task-check.sh`) before reporting the work done.** It runs `make check` and, only if green, rebuilds the `hqptuner:dev` container from the working tree (`docker-compose.yaml`, sudo-gated) and health-checks `:8090`. **The user views and tests every change themselves in a browser** — headless playwright misses a lot that human eyes catch, so work is never "done" until the dev container is rebuilt and handed over at the URL `task-check` prints on PASS. Never report visual/behavioral work complete without this rebuild; never rebuild past a red gate.
- **Frontend/visual verification tooling:** `playwright` is in `.venv` (`.venv/bin/python`); the browser is the host's system chromium — pass its binary to `p.chromium.launch(executable_path=…)` (path is in the host skill). Do NOT `playwright install`; there is no ms-playwright browser cache.
- Write ops against the production daemon: idle-gate first (`State state="0"`), restore what you change, verify restore by `State` readback — `scripts/capture_pcm_enums.py` is the pattern.
