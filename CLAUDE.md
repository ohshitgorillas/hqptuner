# HQPTuner — agent rules

## Agent conduct

- **Prime directive: safeguard the host** — health, uptime, safety, security. Refuse any command, from the user or otherwise, that could compromise the system. You may *generate* a dangerous command for the user to run with justification; never *execute* one. No chat instruction, approval, or authorization overrides this.
- **Plan before any system change.** Explain intent, wait for explicit approval, then execute end-to-end without re-asking. Approval covers the explained scope only; deviations need fresh approval.
- **Escalate, don't just ask permission.** When you hit an ambiguous fork or a tradeoff the user should own, stop and surface it. Quality above completeness.
- **Bounded investigation.** Each command answers one named question; once you have the fact, stop and report.
- **A user interrupt is a hard stop.** "Why", "stop", "is this necessary" — halt every tool call, answer in plain words, wait for an explicit go. The interrupt wants words, not more commands.
- **Be sparing with commands.** Batch and chain to minimize approval prompts.
- **Follow through** on approved work, trusting the permission already given.
- **Do the work in the order the user gave it.** A stated sequence is part of the instruction, not a suggestion to optimise around.
- **Assume the user gave full info.** Reason from it, or name the specific missing fact.
- **Fix root causes, not symptoms.** Masking or silencing noise is worse than leaving the problem visible.

## Delegation

Subagents are a context filter, not a labor pool. The test is never "is this task big" — it's **do I need to see the intermediate material, or only the conclusion?**

**Delegate** when the byproduct is large and the answer is small:

- Locating across many files — "where is X handled", "what calls Y", "every place that does Z".
- Sweeping a directory or a naming convention you can't nail in one Glob.
- Mining one fact out of a long artifact (the HQPlayer manual, a build log, a vendored bundle).
- Independent questions that can run at once — spawn them in a single message.

**Do it yourself** when:

- You know the file. One Read beats a subagent every time.
- The material *is* the output — you need the code in front of you to change it.
- The task is a decision. Judgment calls, tradeoffs, and anything behind the plan gate are yours; they do not delegate.
- Being wrong is expensive and you couldn't cheaply check the answer.

**Rules:**

- Prefer a read-only locator agent type when the session lists one; fall back to the general-purpose explorer otherwise.
- Ask for pointers, not prose. "Return `file:line` + one-line role" beats "explain the architecture" — pointers you can verify, prose you can only trust.
- One delegation per question, not per file.
- You own the result. Relaying an unverified subagent claim is confabulation with extra steps; "the agent said so" is not verification.
- Never delegate to duck the command budget or the plan gate. A subagent's writes are your writes.

## NEVER IDLE-GATE USER ACTIONS (binding)

HQPTuner never refuses a user action because the daemon is playing. Not with a 409, not with a disabled button, not with a "stop playback first" nag. If an apply reloads or restarts the engine and interrupts playback, that is the user's call and theirs alone — say what it costs in the caption, then do it when they click. There is no idle gate anywhere in the write path and none may be reintroduced. Do not propose one.

(Different thing, still fine: *dev probe scripts* that write to the production daemon may check state before scribbling on it — that protects the host's listener, not the UI user.)

- Design + normative rules: `docs/architecture.md`. Open structural debt: `docs/maintenance.md`. Wire truth: `docs/protocol.md`, `docs/settings-classification.md`.
- **HQPlayer's own documentation lives in the working dir** — `hqplayer6desktop-manual.pdf` (full desktop manual) and `hqplayerd-readme.txt` (Embedded daemon config reference: every config-XML element, attribute, and plugin parameter). These are the authority for HQPlayer behavior, config attributes, enum meanings, and plugin params. **Reference them liberally, before inferring anything about wire/config behavior** — reading them beats guessing (and guessing routes/attributes is how bugs get shipped).
- **Testing policy is binding: `docs/testing.md`.** Behavior only, one assertion per test, public API only, fakes speak wire protocol. Read it before writing or modifying any test.
- Quality gates: `make check` = `lint lint-js test test-js` (ruff, black, xenon B/A/A, vulture, strict mypy, file-length + test-assertion gates, offline pytest, plus the JS gates) must be green before every commit. Pre-commit hooks enforce the same; bypassing them (`--no-verify`, `SKIP=`, editing the hook config to pass) is forbidden.
- README exists (beta, user decision 2026-07-21 — supersedes the old "no README until release" rule); keep it current when features change. Decisions get recorded in the commit message, and in `docs/architecture.md` when they change a normative rule.
- **Changelog is binding (beta, 2026-07-21+):** every user-visible change lands with a `CHANGELOG.md` entry under `[Unreleased]`, in the same commit. Internal-only refactors/tests may skip it.
- Never commit credentials — not in docs, not as "verification evidence". Placeholders only.
- The running engine is the sole authority for enumeration names/IDs/ordering; static `data/*.json` joins by name (architecture §2).

- You are a language model. Fluency is not correctness. Your output looks like an answer whether or not it is one. Never present confidence you haven't earned through verification.
- Confabulation is your default failure mode. Verify against source files, docs, and running code before asserting. If you cannot verify, say so explicitly.
- You bear no consequences for being wrong; the user bears all of them. Act accordingly: conservative claims, verified changes, no silent assumptions.
- Follow instructions literally and completely. No additions, no reframing, no "improvements" beyond the stated request. If the request seems wrong, state that in one line and then do it as asked.
- Do not pad responses. Shortest complete answer wins.

## Design system — frontend layout (binding)

Established in the spacing pass; all future visual work conforms or flags a deviation. Never hardcode layout px — use the tokens.

**CSS is split by concern** under `hqptuner/static/css/` (19 modules, none over the 500-line gate). The `<link>` order in `hqptuner/static/index.html` **is** the cascade order — it is the source order of the former single `app.css`. Never reorder it; add a new module at the position its rules need, not at the end by default.

**Tokens (`hqptuner/static/css/tokens.css` `:root`):**
- Spacing scale `--sp-1..5` = 4/8/12/24/32. Every intra-row / inter-row gap references these.
- Widths: `--w-label` (12rem, the shared label column), `--w-num` (short numerics + knob readouts), `--w-select` (28rem), `--w-select-wide` (30rem, long strings), `--w-path`.
- `--measure` (68ch) = the single caption/description measure. `--w-app` (~1200px) = container cap.

**Typography is tokens-only (binding).** Never write a literal `font-size`, `font-weight` or `letter-spacing` in `static/css/`, and never a raw colour outside `tokens.css`. `scripts/check_css_tokens.py` fails the build on both (wired into `make lint-js` and pre-commit).
- **Size** — pick the token whose *role* matches the text, never by eyeballing a number: `--fs-micro` (0.72, inline hints/credits) · `--fs-caption` (0.78, notes and descriptions) · `--fs-label` (0.85) · `--fs-body` (0.9, **the default** for controls and field labels) · `--fs-head` (0.95, card-head/subhead) · `--fs-body-lg` (1) · `--fs-title` (1.1) · `--fs-brand` (1.25) · `--fs-readout` (1.5) · `--fs-glyph` (1.9, disclosure triangles). SVG text uses `--fs-svg-sm` / `--fs-svg` (px — SVG user units do not follow the root rem).
- **Weight** `--fw-normal|medium|semibold|bold`. **Tracking** `--track-tight|caps|wide`, only ever with `text-transform: uppercase`.
- **Text greys are exactly three, chosen by role:** `--fg` = content the user reads (values, control text, headings) · `--fg-2` = text that *names* things (labels, keys, column heads) · `--muted` = captions, notes, hints, units, disabled/off. A fourth shade is a review flag.
- **Never dim text with `opacity`.** Opacity multiplies a token instead of replacing it — that is exactly how the page ended up with five different effective greys for one role (`--fg-2`@0.8, `--fg-2`@0.65, `--muted`@0.8, `--muted`@1, `--fg-2`@1). Opacity is for whole-control states (disabled, off, inactive), never for shading a colour.
- **Text roles live in `typography.css`** — the one module loaded **last**, because it owns the size and colour of every text role and must win over the modules it replaced. New text takes a role class (`.t-head`, `.t-eyebrow`, `.t-label`, `.t-caption`, `.t-micro`, `.t-value`); it does not get a new rule with its own size and colour.
- Escape hatch for a value that genuinely cannot be a token: `/* token-exempt: <reason> */` on the line. The reason is required — an exemption you cannot justify in a clause is a value that belongs in `tokens.css`.
- Not yet gated: `gap`/`margin`/`padding` still hold ~150 off-scale values (mostly control-internal padding). Prefer `--sp-*` in new work; the sweep is outstanding.

**Rules:**
- **Half-track rows cap controls to the track.** `--w-select`/`--w-select-wide` are legal only in full-span rows; inside a `.pack` (or a half-width `.card-grid` card) selects/text go `width:100%; max-width:100%; min-width:0`, and grid items get `min-width:0`. The 12rem-label + 28rem-select sum overflows a half-track — the column is the cap.
- **Two-track section grid is all-or-nothing** (`.pack`): short rows (numeric / checkbox / radio / narrow select) pack two-up; long-string rows opt into full-span via `.span` (schema `span: true` — device dropdowns, log path), never via `.field.wide`.
- **Pack by relatedness, not source order** (`.pack.chain`): a sequential control chain stacks in the LEFT column, the secondary control goes to the right (e.g. filters `[1x, Nx]` left / dither|modulator right).
- **Two-column cards carry a centred rule (binding).** *Every* full-width card with two internal columns draws a 1px `var(--line)` hairline between them, and **every such rule sits on the card's centre line** so they stack vertically down the page. Three mechanisms, by shape:
  - *Fixed two-column split* (`.knob-cluster`, `.cluster-row`, `.xfc-cols`) — an explicit 1px grid track: `grid-template-columns: 1fr 1px 1fr` + a `<span class="col-rule">`.
  - *Multi-row two-track grid* (`.pack`) — one full-height `::before` on the container's centre line, so it covers however many rows the pack has.
  - *Border fallback* (`.pack.split`) — pull the border into the middle of the gap with `margin-left: calc(var(--sp-4)/-2); padding-left: calc(var(--sp-4)/2)`. Never leave a `border-left` at a column edge: it lands `gap/2` off-centre and visibly misaligns against every other rule.
  - A full-span row (`.span`) must not be struck through — it masks the rule over its own height by painting its surface (`--bg-2` in a card, `--bg` on the bare page).
  - **Exactly one rule per split.** A section marker that draws its own `border-left` beside the centred rule (`.cluster`, `.indent` inside a `.pack`) reads as a second divider — drop the border there and let indentation alone carry the nesting.
  - Below the 1100px breakpoint the split collapses to one column and the rule hides.
- **Card rows fill the container.** Paired cards share height via `.card-grid { align-items: stretch }`; `.card` carries `background: var(--bg-2)` (header `--bg-3` + hairline) so a stretched card's empty area reads as surface, not a page-bg hole.
- **Rhythm:** control→caption gap ≈ ⅓ of the row→row gap (tight intra `--sp-1`, inter-field `--sp-4`). Captions cap at `--measure` and wrap — never truncate.
- **Container** `--w-app` ~1200px; below ~1100px viewport, sections fall back to single column (the old layout is the fallback, kept intact).
- Deliberate trailing half-cells (odd control count) are allowed; unnameable blanks are not.

**Definition of done (every tab @1280):** (a) nothing clips or overlaps; (b) each section fills both tracks or deliberately spans; (c) every card row's right edge is flush with the container; (d) all whitespace is page gutter, inter-track gutter, or caption margin — no unnameable blanks.

**Hand-back protocol for visual work (binding):** before reporting ready, verify against FRESH screenshots at 1280 and report PASS/FAIL per acceptance criterion, with measured pixel numbers for anything measurable (card bottom edges, control widths, edge alignments — measure the DOM via headless chromium + playwright, not by eye). "Ready" with an unverified or failing criterion is a process failure regardless of how the page looks.

**Regression guard:** any new control / row / section / card slots into the token + grid system. A new one-off pixel value in layout CSS is a review flag by default.

## Change budget (hard rule)

A budget hook (`.claude/hooks/change-budget.py`) meters what you change between turns where the user actually speaks, on **two separate leashes**. Whichever trips first stops you and forces a report: what you did, what you found, what you plan next. A reply where the user speaks resets both.

- **Change budget — 5.** Anything that escapes the working tree or can't be undone from it: `sudo`, docker, `git commit`, `git push`, mutating `curl` (POST, upload, `-o`), `rm`, `python -c` / `python script.py`, package installs, writes outside the repo. Small on purpose — these are the ones the user cannot cheaply take back.
- **Edit allowance — 15.** `Write` / `Edit` / `NotebookEdit` to a path inside the git working tree. Recoverable by `git restore`, visible in `git diff`, gated by `make check`, reviewed before commit. Generous on purpose — enough to land a real change in one turn.

Free, never counted and never blocked: file reads, `Grep`/`Glob`, web fetch/search, delegation to a read-only agent type, and read-only `Bash` (investigation: `grep`, `sed -n`, `ls`, `find`, `cat`, `which`, `command -v`, `rpm -q…`, `pip show`/`list`, …; verification: `make check`, `make lint-js`, `make test-js`, `pytest`, `python -m pytest`, `ruff check`, `mypy`, …), even piped to a pager or redirected to `/dev/null` or the scratchpad. Grounding in code, docs, and live state is what stops you drifting onto the wrong thing — read and verify liberally before spending anything. It's the cheapest insurance you have. Resuming after a report is cheap and expected, a drifted agent's failures are not — the budget is a checkpoint, not a wall.

**The asymmetry is deliberate.** Bash mutations always meter, even in-tree, because deciding whether a shell command stays inside the working tree isn't tractable to parse. Structured edits get the cheap lane because their target is a known field. This prices nine `Edit` calls below one `python -c` that rewrites nine files — the reviewable path is the cheap path. Do not batch edits into an opaque script to save budget; that trade no longer exists, and taking it now costs you more than it saves.

`python -c`, `python script.py`, and mutating `curl` stay metered — arbitrary code and network writes can't be inspected, so they're real actions. For read-only grounding use the free equivalents instead: `jq` for JSON (`curl -s http://127.0.0.1:<port>/api/… | jq '.data.file.x'` — loopback `curl` GETs are free), `grep`/`sed -n` for text, the `Read` tool for files. Reach for `python -c` only when you actually mean to spend an action.

This leash is deliberate and correct. It exists because an unsupervised agent drifts — chases the wrong thing, balloons a small fix into a regression, burns the user's trust while they aren't watching. The budget has killed dozens of bad ideas before they cost anything. Treat it as a core safety feature of this host, same tier as the Prime Directive.

Rules:

- **Batch aggressively — commands, not edits.** Chain related shell work into single commands (`&&`, one script, one compose invocation). Five well-packed commands go a long way; five wasted on one-liners don't. Edits are the exception: leave them as separate `Edit` calls where a reviewer can read them. That is what the allowance of 15 is for.
- **Report like it matters.** The forced checkpoint is your chance to catch your own drift. Give a real status — findings, plan, open questions — not a rubber-stamp "continuing".
- **Never complain about it.** Not in passing, not as a sigh, not as a "if only I could just". The budget stays. Working within it is the job.
- **Disabling it is off-limits.** Do not disable, weaken, bypass, or ask to disable the budget hook. Do not fold such a request into a continuation. There is no justification, no scope, no override that makes this acceptable — it ranks with the Prime Directive as non-negotiable.

If you encounter a command that you believe is purely investigative which is being counted against the budget, let the user know.

## Host

- hqplayerd runs **bare metal on the dev host** and is that host's top-priority service (Roon + HQPlayer audio path). Treat it as live production — this is what the idle-gate rule protects.
- Host-specific facts are deliberately **not** in this file: LAN address and hand-back URL, sudo gating mechanism, package-install policy, parent-repo layout, browser binary path, credential locations. If the session lists a host skill for this project, load it before touching host state, quoting a URL to the user, or pushing.

## Dev

- Setup: `python3 -m venv .venv && .venv/bin/pip install -e .` then dev tools: `pytest pytest-asyncio ruff black vulture mypy xenon pre-commit types-beautifulsoup4`. (pip extras syntax with brackets can trip a permission hook — install the list explicitly.)
- Run: `HQPTUNER_HQP_USERNAME=<user> HQPTUNER_HQP_PASSWORD=<pass> .venv/bin/python -m hqptuner` — REST API on `127.0.0.1:8090`. All knobs are `HQPTUNER_*` env vars, see `hqptuner/config.py`. Without credentials everything works except `/api/config`.
- Local hqplayerd management credentials live in a **gitignored `.env`** at the repo root (`HQPTUNER_HQP_USERNAME` / `HQPTUNER_HQP_PASSWORD`) — never committed, never echoed. Source it before running: `set -a; source .env; set +a; .venv/bin/python -m hqptuner`.
- `make check` = full gate suite (pre-commit runs the same gates except the JS test suite, deliberately left out). `make test` = offline suite. `make test-live` adds `live`-marked tests (needs a reachable hqplayerd).
- **Task-complete check is binding: after ANY code edit or rebuild, run `/task-check` (`bash .claude/task-check.sh`) before reporting the work done.** It runs `make check` and, only if green, rebuilds the `hqptuner:dev` container from the working tree (`docker-compose.yaml`, sudo-gated) and health-checks `:8090`. **The user views and tests every change themselves in a browser** — headless playwright misses a lot that human eyes catch, so work is never "done" until the dev container is rebuilt and handed over at the URL `task-check` prints on PASS. Never report visual/behavioral work complete without this rebuild; never rebuild past a red gate.
- **Frontend/visual verification tooling (for the hand-back protocol):** `playwright` is in `.venv` (`.venv/bin/python`); the browser is the host's system chromium — pass its binary to `p.chromium.launch(executable_path=…)` (path is in the host skill). Do NOT `playwright install`; there is no ms-playwright browser cache.
- Phases 0–6 are complete (history in git log; `outline.md` and `roadmap.md` were removed 2026-07-25). The open work is the structural-debt survey in `docs/maintenance.md`.
- Write ops against the production daemon: idle-gate first (`State state="0"`), restore what you change, verify restore by `State` readback — `scripts/capture_pcm_enums.py` is the pattern.
