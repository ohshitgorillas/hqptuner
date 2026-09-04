---
description: Author tests for new or changed behavior from an approved spec block, through the blind test-writer when the spec is large enough to earn one. Argument: what changed (module, behavior, or "the working tree").
---

Cover this with tests: $ARGUMENTS

You are the orchestrator. Run the chain below end to end without stopping to re-ask between steps.

The chain is tests-first in every mode: the spec is approved at stage 2 of the plan gate, the tests are written from the spec in a tree that holds no implementation, the red run in that tree proves they bite (`docs/testing.md` rule 8), and only then does the implementation land beside them. Blindness is a bonus where it is cheap; the red run is the invariant. Section 6 is invoked from sections 3 and 5 rather than walked through in order.

The pair costs two metered actions end to end (`open` and `merge`), so there is no size threshold worth arguing about: anything carrying a spec block uses it. Implement in the main checkout only for a change too small to have one.

## 1. Build the spec block

For a change that adds or alters observable behavior, the spec block is authored **at stage 2 of the plan gate**, after the plain English plan has been approved, and presented for its own approval — the grounding gate already forces the reading it requires. When `/tests` is invoked over code that already exists — characterization tests, retrofitting an untested module — build the spec here instead.

Read whatever you need of the implementation — that is your job, not the writer's — and distil it into a **spec block**. Five parts:

**Derive each line before you phrase it.** The failure mode this ordering exists to prevent is writing the line from the fix you already have in mind, which yields a line the fix satisfies by construction and nothing else rules out. Work in this order, and do not skip to the phrasing:

0. **Make the block discriminate before you make any line precise.** The defect that costs the most rounds is not a vague line, it is a precise block that a lookup table satisfies. A block is stub-proof only when its expected outcomes take **at least two distinct values on one surface**, produced by inputs the wrong implementation cannot have tabulated. Three ways to get there, in order of preference: a **differential** — one line asserting a relation between two observations of the same surface, which a table must enumerate to fake; an **anchor plus its edges** — one ordinary in-range input producing a changed output, alongside the bounds; or a **sweep** whose cases do not all expect the same number. A block of edges, of orderings, of one-sided bounds, or of one absolute value per line, is a table however concrete its figures. The anchor takes the first of the four slots where you use one; it is not an extra, and it is normally the block's weakest bite.
1. **State the failure as two values.** The input a caller supplies, the output they got, the output they should have got. All three literal. If you cannot write the wrong output as a value, you do not yet know what broke.
2. **Widen the input to the class the contract covers, and no wider.** One sentence on why the contract holds for the class and not just the instance. A class you cannot justify means the line pins an example, not a contract.
3. **Choose inputs off the tabulatable set.** A value that is a chip, a preset, a default, or a point where the fixture's own data is degenerate is a value a wrong implementation already has an entry for, and a `kills:` clause can pass a line at such a point while failing everywhere else. Prefer an input between the named values; if a fixture makes the correct and the wrong output coincide, change the fixture, not the line.
4. **Phrase the line so the wrong code fails it, and state the starting value.** "With Length at its default 2 ms, committing 500 leaves lengthMs at 50", never "committing 500 leaves lengthMs at 50" — a reader who cannot tell the outcome from the value already there cannot tell a working feature from a dead one, and both the reviewer and the blind writer are that reader. Then run the line against its own `kills:` at the input the line gives, not at the input you were picturing.

Steps 1 and 2 come before you look at the fix. If the fix is already written, state the contract in words the user could have used before it existed: no function name, no branch, no flag. Where the unit is pure mathematics, step 0 has no repair — every numeric line restates an identity the implementation was derived from, and a table satisfies it. Such a module is pinned against an external reference oracle committed as fixtures, and that is what the plan proposes instead of a block.

**Behaviors.** The minimum set of lines that states the contract, numbered, each phrased as what a caller sees: *"asking for a preset that was never saved raises `PresetError` naming the missing preset"*, never *"the read path checks `exists()` first"*. Every line carries two clauses:

```
N. <behavior as the caller sees it>
   kills: <a wrong implementation a user would notice, which this line rejects>
   bite: <the value HEAD produces at this input, measured, with the command> | null stub fails at <input> (surface new)
   existing: none, <the grep you ran and its result> | tests/<file>::<test>
```

`kills:` names one plausible implementation that is wrong in a way a user would notice and that this line, and only this line, rules out. "Returns the wrong type" and "raises" are not implementations; "loads the preset whose name sorts first instead of the one asked for" is. A line for which you cannot name one is not a behavior and does not go in. `bite:` is measured, never assumed: a threshold you believe sits outside HEAD's range and does not is a line that ships green, and the reviewer cannot catch it because it is barred from the implementation. Where the surface does not exist yet there is no measurement to take and an import error proves nothing, so the clause names the **null stub** the line fails instead — the module present, exports named, every function returning its zero value. `existing:` carries the grep you ran and its result, not your belief; a line with an existing test does not go in either. A line whose `kills:` is a wording change is copy (`docs/testing.md` rule 9) and does not go in.

**Default cap is four lines.** Each line beyond four carries one sentence saying why the contract cannot be stated in fewer. A line earns its place by what it kills, not by completing a matrix of cases; boundaries and failure modes are in only when a user would notice their absence.

**Public entry points.** Signatures and docstrings only. Extract them — `grep -n "^def \|^class \|    def " <module>` plus the `__init__` exports, or read the module and copy out the `def` lines — and paste the signatures. Never paste a function body. Where the surface does not exist yet, the signatures are the **planned** public surface: what the plan commits to shipping, in the form it will ship.

**Wire and protocol facts.** The daemon behavior that bears on this, each with a reference into `docs/protocol.md`, `docs/architecture.md`, `hqplayerd-readme.txt` or the HQPlayer manual so the writer can check it. Include the documented quirks the behavior has to survive.

**Applicable fixtures.** Which of `tests/conftest.py`'s fixtures and `tests/fake_*.py`'s fakes cover this, by name, with one line each on what they give.

**Changelog entry.** For a user-visible change, the exact `CHANGELOG.md` line, under the heading it lands beneath, written here and approved with the rest of the plan. It is user-facing text and binds like all of it: the line that lands is the line that was approved, character for character, and rewording it while implementing is a copy change needing its own approval. An internal-only change says "no entry" and one clause on why.

**The spec block contains zero implementation detail.** No function bodies, no private names, no control flow, no "it loops until", no algorithm. If a behavior cannot be stated without describing how it is implemented, that is a spec smell — it usually means the behavior has no observable contract, or the contract is the implementation. **Stop and put that to the user** rather than leaking it into the spec.

### The spec-reviewer runs before the user sees the spec

Once the draft is written, spawn the `spec-reviewer` with the behavior lines and nothing else. It returns a gate verdict — `READY`, `ANOTHER PASS` or `ESCALATE` — then its `discriminates:` line, then one verdict per line, `KEEP`, `DELTA` or `CUT` with a reason, plus its two stub lines and a surviving count. Apply every `CUT` and fold every `DELTA` into the named existing test before presenting; a verdict you disagree with stays applied and goes into the plan as one line of disagreement for the user to rule on.

**The reviewer holds the gate, and the loop runs until it opens.** On `ANOTHER PASS` you repair the block against the named repair and send it back to the **same reviewer** with `SendMessage`, supplying your previous round's verdicts for every line whose text you did not change. One reviewer per spec block, for the life of the block: it holds the rounds it has already ruled on, and a fresh `Agent` call throws that away, re-litigates settled lines, and is the loop that never terminates. Spawning a second reviewer for a block that already has one is a defect on the same footing as skipping the review, whatever the reason: a long wait, a bad brief you want to retract, a context you would rather start clean. A brief you got wrong is repaired by sending the bare block to the same agent, not by finding one that has not read it. There is no round limit and no discretion in it: rounds between you and the reviewer are cheap and the user never sees them, while a draft you present early costs the user directly, and the user has ruled that first drafts are not to reach them. Presenting a block the reviewer has not marked `READY` is a defect on the same footing as skipping the review. On `ESCALATE` you stop redrafting and put the design question to the user in the plan — the surface cannot be pinned this way, and the reviewer's alternative goes with it. The one appeal you keep is a verdict you believe is wrong on a fact the reviewer is barred from reading: state the fact, and the line goes to the user alongside the block whatever the token said. `READY` is the reviewer's to grant; being seen by the user is not the reviewer's to withhold.

`READY` is not "every line KEEPs". A block that reaches it as two deltas and no new tests is a good outcome, and `survives:` is a count, not a score. The plan presents the trimmed spec, then **one line per behavior** beneath it: the verdict, unchanged, plus its reason in plain English — the reviewer's wording where that reads clearly, yours where it does not. Every verdict appears, the ones you disagreed with and applied anyway included. What does not appear is the rest of the report: no stub lines, no preamble, no surviving count, no reviewer boilerplate. The last round's verdicts are the ones reported, and two things travel with them: the `discriminates:` line verbatim, and every fact the reviewer flagged as one it could not read, because the user is the only reader who can settle those and the sample of past reviews shows unread-code guesses cutting good lines. The spec that reaches the user has already been through the adversary; the user reads `kills:` clauses, not a padded list.

**The approved spec is closed.** The numbered lines are the whole spec: no additions in the writer brief, no "may also cover", no entry-point tests on top. The test count equals the behavior count, parametrize sweeps counting as one. A behavior discovered later takes section 6's path.

## 2. Open the pair, pick the mode, start

On stage-2 approval, open the two worktrees this run needs — one action:

```
scripts/pair.sh open <slug>
```

`<slug>` is a short topic slug plus a few characters of the session id, because other agents are working in this repo at the same time and must not land in your trees. You get:

- `.claude/worktrees/<slug>-spec` on branch `spec/<slug>` — the tests tree. Tests only; no implementation reaches it until section 5.
- `.claude/worktrees/<slug>-impl` on branch `impl/<slug>` — the implementation tree. Implementation, docs, `CHANGELOG.md`; never `tests/`.

Both are cut from dev's committed tip. The main checkout is the user's and is never an agent workspace.

**Mode is decided by the approved spec, before anything is written:**

- **Writer mode — three or more behavior lines, or any characterization/retrofit spec regardless of size.** Characterization has no red run, so blindness is the only defense it has. In a single message: spawn the `test-writer` with the spec block and the **absolute path** of its target file inside the spec tree — `.claude/worktrees/<slug>-spec/tests/<file>` — give it the spec and that path, nothing else; and enter the impl tree and start implementing (section 4). Writer and implementation run concurrently; blindness holds by construction, because the implementation does not exist yet and when it does it is in a tree the writer never opens.
- **Solo mode — one or two behavior lines, new behavior.** You write the tests yourself, **in the spec tree, from the approved spec only, before opening the impl tree or writing anything else.** That ordering is the rule: you are as blind as you will ever be at that moment, and the red run costs nothing. Then move to the impl tree (section 4).

**The lanes are enforced, not trusted.** `pair.sh merge` refuses if the spec tree wrote outside `tests/` or the impl tree wrote inside it. That rule is what makes the two branches combine without conflict, so treat a lane failure as a misplaced file, never as something to argue with.

## 3. Red run — prove the tests bite

When the tests exist (writer returned, or you finished them in solo mode), run the file in the spec tree. That tree has no implementation in it and will not until section 5.

```
cd .claude/worktrees/<slug>-spec && PYTHONPATH=$(pwd) .venv/bin/pytest tests/<file> -q
```

The `PYTHONPATH` is not optional. A worktree borrows the main checkout's `.venv`, which has `hqptuner` installed editable against the main checkout — without it you are testing the wrong tree's code.

Expected result is **red**. That is the bite proof (`docs/testing.md` rule 8), and it is the strongest form available: nothing has been written anywhere in this tree for the tests to have been shaped around, and no revert is involved.

Read the result:

- **Red with assertion failures — bite confirmed.** That is the result this run exists to produce, and it is the strongest form available: nothing has been written anywhere in this tree for the tests to have been shaped around.
- **Red with only collection or import errors — nothing proved.** Expected where the surface is new, and it says nothing about whether the tests constrain it: every test of a symbol that does not exist yet errors this way regardless of what it asserts. Do not report it as a weak bite. Report that the bite rests on the null-stub argument in the approved spec block, and name the stub.
- **Green — bite failure.** The test passes against a tree that lacks the change, so it constrains nothing. Its `kills:` clause named an implementation the test does not actually distinguish. Tighten the clause, then fix the test: in writer mode re-run the writer **as a delta** — the corrected line and the affected test only — and in solo mode edit it yourself. Implementation keeps running in its own tree while you do.

Skip the check only when there is no pre-change state to fail against — characterization tests of existing behavior, tests accompanying a pure refactor, both expected green here — and say so in the report instead of skipping silently.

## 4. Implement — in the impl tree

Write the change in `.claude/worktrees/<slug>-impl`. You implement it; that is settled, because you wrote the spec and you are the one who will adjudicate a failing test, which is impossible against code you have not read.

**Rote work goes to a builder, not into your own context.** A rename across N files, one edit applied down a list of call sites, boilerplate that follows a pattern already in the tree — if you can state the change as a rule and check the result by reading a diff, hand it out. See the Delegation section of `CLAUDE.md`; it is a rule there, not a suggestion. The line is decisions, not size.

You do not touch `tests/` here. If implementing shows a test needs to change, that is adjudication (section 6), and it happens after the merge, in the combined tree.

If implementing surfaces a spec that was wrong, do not quietly diverge from it — also section 6.

## 5. Converge

One action brings the two trees together, gates the result, and lands it:

```
scripts/pair.sh merge <slug>
```

It lane-checks both trees, commits them, rebases onto dev if dev moved underneath, merges `impl/<slug>` into the spec tree so that tree holds tests plus implementation, runs `make check` there, and only then fast-forwards dev and removes both worktrees. A red gate stops it with dev untouched and both trees left standing — the combined tree is where you adjudicate.

**Green** — run `/task-check` from the main checkout. It binds the one container and `:8090`, host-wide, which the worktrees do not isolate, so it stays post-merge and stays in the main checkout. There is no post-merge test review: the spec was reviewed before approval, the red run proved the tests bite, and the mechanical gates checked their shape.

Abandoning the work instead: `scripts/pair.sh abort <slug>` removes both trees and branches. `scripts/pair.sh list` shows the open pairs and is free.

**Red** — adjudicate first, per section 6.

## 6. Adjudicate every failure yourself — before touching anything

A failing test here means the spec and the code disagree. Exactly one of three things is true, and **you** decide which, in words, before a single edit:

- **The code is wrong.** The test caught a real defect. Say what the defect is; fixing it is a separate change with its own approval.
- **The spec was ambiguous or wrong.** You mis-stated the behavior. Say which line of the spec was wrong and what it should have said, correct the line, then fix the test: in writer mode as a delta to the writer — the corrected line and the affected test only — and in solo mode by your own hand. Never hand-edit a writer's test into agreement; the writer's context is what keeps the delta blind.
- **The test misreads a correct spec.** Rare, and the burden is on you: state why the test, and not the code, is wrong, and what the test asserts that the spec does not say. Same edit path as above.

Report which one to the user before changing code or tests. Editing a test until it passes is forbidden without that statement. It is the failure mode this chain exists to catch, and it is silent: the suite goes green either way.

**Spec discoveries made mid-implementation take this same path.** Report which spec line was wrong, correct it, fix the test by the mode's edit path, and red-check that delta against the pre-change state of the behavior it covers where one exists.
