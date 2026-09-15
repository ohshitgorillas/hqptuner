# The roster

Eight agents, and the whole system is the shape of what each one is not allowed to see or write.

| Agent | Sees the code | Writes | Hooks |
| --- | --- | --- | --- |
| `gauntlet-prosecutor` | yes, all of it | `<gauntlet dir>/reviews/<slug>.plan.<N>.txt`, `<gauntlet dir>/plans/approved/<slug>.txt` | `reviews-lane`, `plans-lane` |
| `gauntlet-detective` | yes, all of it | nothing | `specs-lane`, `tests-lane`, `reviews-lane` |
| `gauntlet-examiner` | yes, all of it | throwaway scripts outside the tree | `specs-lane`, `tests-lane` |
| `gauntlet-arbiter` | **no** | `<gauntlet dir>/reviews/<slug>.<N>.txt`, `<gauntlet dir>/specs/approved/<slug>.txt` | `no-impl-reads`, `reviews-lane`, `specs-lane` |
| `gauntlet-scrivener` | **no** | `<tests dir>/` of its own spec worktree | `no-impl-reads`, `tests-lane`, `specs-lane`, `blind-bash` |
| `gauntlet-bailiff` | **no** | nothing | `no-impl-reads`, `specs-lane`, `tests-lane`, `plans-lane`, `reviews-lane`, `verdicts-lane`, `blind-bash` |
| `gauntlet-juror` | **no** | nothing | `no-impl-reads`, `specs-lane`, `tests-lane`, `reviews-lane` |
| the main agent | yes | everything else | all of them, session-wide |

## The switch

"All of them, session-wide" holds for a session with the gauntlet on, which is every session the owner does not start with `GAUNTLET=off claude`. That variable silences the seven lane hooks and the `Stop` gate for one session, so the owner can work outside the chain — repairing a lane file, demoing the kit, working on the hooks themselves — without weakening a hook in the tree. It is not an agent and takes no row: it belongs to the hand that launches the session, an agent inside one may never propose it, set it, or suggest the owner set it, and `gauntlet-off.py --bash` denies a `GAUNTLET=` assignment and a nested `claude` invocation so the session cannot reach it.

One statement here covers every sentence in this file that says a hook denies something, including `pair.sh red` below. Each is a statement about a session with the gauntlet on.

## Who is blind, and why

The `gauntlet-arbiter`, the `gauntlet-scrivener`, the `gauntlet-juror` and the `gauntlet-bailiff` are the four that never read the implementation. Everything else in the repo exists to keep that true.

Under `GAUNTLET=off` it is not true. `no-impl-reads.py` and `blind-bash.py` are two of the seven hooks the switch silences, so a `gauntlet-arbiter` or a `gauntlet-scrivener` spawned in a bypassed session can read the implementation and can run any shell command, and nothing denies it. Blindness is the property the whole chain rests on, so a spec block or a test produced in such a session is worth what an unblind agent's work is worth, and it lands in a tracked file that looks like any other. A session with the gauntlet off should not run the chain.

A reviewer that can read the code will rationalize a spec line that merely describes what the code already does — the line looks true, because it is, and it pins nothing. A test writer that can read the code writes a test that mirrors it: the test and the implementation share the same mistake, so it goes green on a wrong implementation and nobody sees. A certifier that can read the code reads a `GREEN` as the implementation already being right rather than as the test failing to bite, which is the one reading the red run exists to rule out. A post-merge checker that can read the code reads a softened assertion as matching what the code turned out to do, which is exactly the change it is there to catch.

The certifier is also blind to the test it is judging in a second sense: it did not write it. The `gauntlet-scrivener` grading its own red run is the same conflict one stage down from an agent testing its own code, so the run output goes to a fresh agent that holds none of the reasons the test was written the way it was.

Blindness costs something, so it is paid for. The `gauntlet-examiner` measures the values a blind reviewer cannot look up, and the `gauntlet-detective` finds the lines a plan needs to cite. Both can read everything. Neither issues a verdict, which is why letting them see is safe.

## The chain

1. The main agent drafts a plan and sends its discovery questions, all of them, to one `gauntlet-detective`.
2. The `gauntlet-prosecutor` resolves the plan's citations and returns a pass or fail per check and, on `READY` and only then, writes `<gauntlet dir>/plans/approved/<slug>.txt`. The owner reads it only on a pass. Rules in `plans.md`.
3. The main agent drafts a spec block. Where a `bite:` value needs a script or a rendered state space, the `gauntlet-examiner` measures it.
4. The `gauntlet-arbiter` runs its checks blind and, on `READY` and only then, writes `<gauntlet dir>/specs/approved/<slug>.txt`.
5. The `gauntlet-scrivener` reads that file — refusing any spec path outside the folder — and writes the tests, blind.
6. The tests run red under `scripts/pair.sh red`, and a `gauntlet-juror` reads that saved output against the approved block and returns one verdict per line, blind.
7. The main agent implements against the tests, and never edits them.
8. After `scripts/pair.sh merge`, a `gauntlet-bailiff` reads the `TEST CHECK` brief the script printed, and the `<gauntlet dir>/merge/<slug>.txt` that brief names, against the committed block, and returns `PIN`, `SOFT`, `MISSING` or `EXTRA` per behavior line, blind. It is the only round that holds test code, so rules 4, 6, 13 and 14 are checked there and nowhere else.

## `scripts/pair.sh`

The script that moves a block between the reviewer, the writer and the tree. Its subcommands, and their stdout is contract:

| Invocation | stdout | when |
| --- | --- | --- |
| `pair.sh open <slug>` | `OPEN .claude/worktrees/<slug>-spec` | the approved spec's reviewer section is byte-identical to the newest `<gauntlet dir>/reviews/<slug>.<N>.txt` |
| `pair.sh open <slug>` | `MISMATCH <gauntlet dir>/reviews/<slug>.<N>.txt` | those two texts differ, and no worktree is cut |
| `pair.sh red <slug>` | the saved output's path | after the suite has run in the spec worktree |
| `pair.sh merge <slug>` | `TEST CHECK <slug>`, the two commits, `merge output: <gauntlet dir>/merge/<slug>.txt`, `END TEST CHECK` | `kind:` is `new`, `characterization` or `refactor` |
| `pair.sh merge <slug>` | the `scripts/strike-diff.py` verdict lines | the structure line is `motion: strike` or `motion: amend` |
| `pair.sh review <slug>` | `REVIEW <gauntlet dir>/reviews/<slug>.<N>.txt` | `<N>` is one more than the highest already on disk for that slug, 1 where there is none, and `<gauntlet dir>/reviews/` exists |
| `pair.sh review plan <slug>` | `REVIEW <gauntlet dir>/reviews/<slug>.plan.<N>.txt` | the same count over the plan rounds of that slug |
| `pair.sh restore <slug> <rev>` | `RESTORED <gauntlet dir>/specs/approved/<slug>.txt <rev>` | the approved block on disk is the block as it stood at `<rev>` |
| `pair.sh impl checkout <slug>` | `IMPL .claude/worktrees/<slug>-impl` | the implementation tree is cut on `impl/<slug>`, or already was and is left on the commit it is on |
| `pair.sh impl merge <slug>` | `MERGED <slug> <commit>` | `impl/<slug>` is merged and `<commit>` is the primary checkout's HEAD, holding the implementation tree's tip as an ancestor |
| `pair.sh respec <slug>` | `RESPEC <gauntlet dir>/specs/approved/<slug>.txt <commit>` | the re-approved block is a `spec:` commit on `spec/<slug>`, and its reviewer section is a round newer than the one that branch already committed |
| `pair.sh respec <slug>` | `MISMATCH <gauntlet dir>/reviews/<slug>.<N>.txt` | the block's reviewer section differs from that round file, and nothing is committed |
| `pair.sh abort <slug>` | `ABORTED <slug>` | both worktrees, both branches and the recorded base for the slug are gone |
| `pair.sh list` | one `PAIR <slug> <base> <n>` line per open pair, or `NO PAIRS` | `<base>` is the commit the pair was cut at, and `<n>` is how many commits the target branch has moved since |

`review` is the reviewers' one path into their own lane. `reviews-lane.py` denies a reviewer every read of `<gauntlet dir>/reviews/`, so the reviewer cannot count the rounds it is continuing; the main agent runs `pair.sh review` before each round that will carry verdicts and hands the printed path to the reviewer verbatim in its brief. A round that writes nothing consumes no `<N>`, because the count is of what is on disk.

The evidence sits in the file the `merge output:` line names, not beneath that header: `<gauntlet dir>/merge/<slug>.txt` carries the changed test file names under `test files:`, `git diff <base> HEAD -- <tests dir>/` under `diff:`, and the saved red log under `red output:`, in that order and under those three headings. The section is empty where `<gauntlet dir>/red/<slug>.txt` is absent.

`open` refuses on mismatch because the spec file is editable after the reviewer passed it, and the round file is not: the comparison is what makes the approved block the reviewed block rather than the latest one. `red` removes the whole-file strike targets, which the lane hook denies every agent, and leaves single-test targets to the writer's `Edit`. `merge` routes on the structure line because the two tests-only shapes have no implementation phase, so the blind post-merge reviewer round has no window to watch and the mechanical check takes it.

`merge` converges the pair in six steps, and the target branch is touched only at the last: the lane check, which holds the spec tree to `<tests dir>/` and the implementation tree out of it; a commit in each tree; a rebase of both branches onto the target branch where it moved under them; the combine, which merges `impl/<slug>` into the spec tree; the gate, run in that combined tree; and the land, a fast-forward of the target branch onto the spec branch, after which both trees and both branches are removed. An implementation tree that was never cut is skipped rather than fatal, which is the ordinary shape of the two tests-only kinds. Steps three to six hold `flock` on `.claude/worktrees/.pair.lock`, so two sessions converging at once queue instead of racing the tip, and every land is `--ff-only`.

A red gate stops at step five: nothing lands, both trees stand exactly as they are, and stdout carries no brief — the evidence goes to stderr with the failure, because a brief on stdout is the brief of a merged block. A failing test there means the block and the code disagree, and the way out is the implementation tree or a re-approved block, never an edited test.

The target branch and the gate command are `target_branch` and `gate_command` of `.claude/hooks/blind-reads.json`, read through the same `shell_shapes.py --config <key>` that answers for every directory the kit names. They default to `main` and `make check`. The gate is split into arguments rather than run through a shell, so a second command written after it in that file is an argument and not a command.

The two runners are `pytest_command` and `node_command` of that same file, read through the same reader and split into arguments the same way. They default to `.venv/bin/pytest` and `node --test`, and they are what `pair.sh red` and `scripts/blind.sh test` run: a project that has to deselect a marker or import a loader names the whole invocation once there instead of editing the two scripts by hand. The test path and the flags each script adds come after the configured words, and a configured word carrying a slash is a path in the checkout while a bare word is on `PATH`. A wider runner widens nothing a blind agent may type: `blind-bash.py` admits `scripts/blind.sh test <path>` and no runner argument beside it, so the invocation is configuration and never agent input.

`respec` lands a re-approved block on the open spec branch as the `spec:` commit the writer's delta names. It makes the same comparison `open` makes and one more: the newest round has to differ from the one the spec branch already committed, because a block whose lines changed under the last `READY` would otherwise pass. It stages the block alone, so tests the writer has not committed stay out of that commit.

## The tests-only lane

A change confined to `<tests dir>/` — a test that violates `docs/testing.md` and has to go, or to be replaced — skips steps 1 and 2 entirely. No `gauntlet-detective`, no plan, no `gauntlet-prosecutor`, no owner plan approval.

1. The main agent drafts a `motion: strike` or `motion: amend` block and sends it to a `gauntlet-arbiter`.
2. The reviewer resolves each line's quoted assertion against the test file itself — `<tests dir>/` is open to it, and the implementation is not what these lines rest on — and writes `<gauntlet dir>/specs/approved/<slug>.txt` on `READY`.
3. The `gauntlet-scrivener` removes the targets and writes the replacements its `as:` fields name.
4. `scripts/strike-diff.py`, run by `scripts/pair.sh merge`, checks the landed diff against the block by name and by quoted assertion text. There is no red run and no post-merge reviewer round: neither shape has an implementation phase, so the window those two watch does not exist.

The plan gate is what the lane drops, and it drops it because the gate resolves citations into the implementation. These lines cite `<tests dir>/`.

Steps 4 and 5 are the load-bearing pair, which is why a hook and not a convention stands between them: `<gauntlet dir>/specs/approved/` is written by the reviewer alone, so the file's existence is the writer's proof that the lines were reviewed. Rules in `approved-specs.md`.

## Verdicts, not grades

None of the reviewers hands back a score. `gauntlet-prosecutor` and `gauntlet-arbiter` return a gate token and a finding per check, and the default on every check is the failing one: a check the reviewer cannot decide fails. That is deliberate. A reviewer with discretion between pass and fail spends it on being agreeable, and an under-cut spec costs more than an over-cut one — the main agent can argue a cut back cheaply, and nobody ever argues back a line that should not have shipped.

Every reviewer also refuses a brief that steers it: a conclusion offered as settled fact, a ruling on scope, a question addressed to the reviewer, an alternative verdict, its own rules recited back. A steering rejection burns that agent — the steering is in its context now — so the bare brief goes to a fresh one.

The other rejection, `EVASION`, runs the opposite way, and deliberately. A reviewer calls it on a re-review when the main agent's return neither did the named repair nor supplied the missing citation. Burning the reviewer there would reward the evasion: a fresh one holds none of the findings that were evaded, so the main agent would get a clean slate and could run the same evasion again. So an `EVASION` call leaves the reviewer open, holding its findings, and the main agent answers that call back to the same reviewer, by `SendMessage`, with the repair or the citation. An answer that evades again gets a second `EVASION` call from the same reviewer. Only steering replaces a reviewer.
