# The stage-1 plan

A plan is what the owner approves before any behavior is specified. It is prose, not a spec block: it says what is wrong, what changes, and what it costs, in enough detail that a reviewer can resolve every claim it makes against the tree.

## Where a plan lives

| Path | Written by | When | Tracked |
| --- | --- | --- | --- |
| `<gauntlet dir>/plans/drafts/<slug>.txt` | the main agent | while drafting, every round | no |
| `<gauntlet dir>/plans/approved/<slug>.txt` | `gauntlet-prosecutor` | on `READY`, and only then | yes |
| `<gauntlet dir>/reviews/<slug>.plan.<N>.txt` | `gauntlet-prosecutor` | every round that carries checks | no |

One directory, one writer, the same rule `docs/approved-specs.md` states for the spec gate one stage later. `hooks/plans-lane.py` denies every other hand at the tool call, so the presence of `<gauntlet dir>/plans/approved/<slug>.txt` is the evidence that those words passed the plan gate — not a claim in a transcript. Under `GAUNTLET=off` the lane is silent and any hand can write that file, so the evidence is evidence about a session run under the chain; `docs/approved-specs.md` states the same bound for the spec lane.

The approved plan is tracked because a later stage reads it from disk. That is the whole point of the artifact: a fresh agent picking the chain up at implementation reads the plan it is implementing rather than inheriting it from a conversation that may not exist any more.

## The shape

The plan opens with two metadata lines and the owner's brief, then six sections. A reviewer reads `slug:` and `discovery:` as metadata, never as framing.

```
slug: <slug>
discovery: gauntlet-detective

brief:
> <the owner's words that asked for this work, verbatim, one `> ` per line>

## What is wrong
## What the owner sees change
## Which files get touched, and roughly how
## Caller-side delta
## What it costs
## Open questions
```

- **`brief:`** is the owner's words and nothing else. Quote every sentence that asked for work, including the ones that changed the owner's mind: a plan that quotes only the final instruction hides the reversal that produced it. Where a later sentence overrides an earlier one, both are quoted and the plan says which it followed.
- **What is wrong** states the defect or the want, with citations. A claim about the tree carries `file:line`.
- **What the owner sees change** is the delta as the owner experiences it, not as the diff expresses it.
- **Which files get touched, and roughly how** names files and the shape of the change in each. It is not a diff, and it is not a promise of line counts.
- **Caller-side delta** applies where anything outside the changed files has to change with them — an interface, a path, an agent's own instructions. `none` where nothing does.
- **What it costs** names the work the change forces, the tests it breaks, and what was deliberately left out, with the owner's own words where a scope instruction produced the cut.
- **Open questions** is `None` or a numbered list. A question here reaches the owner; a question addressed to the reviewer is a steering tell and burns the round.

## Citations

A citation is a path and a line number inside backticks, and the backticks are what make it one: `docs/plans.md:37` is a citation, and the same characters in running prose are not. A number the prose names without them — "line 72 now says six" — is prose, and nothing resolves it.

Five forms, and one of them carries no path:

- a full citation, path and number: `` `docs/plans.md:37` ``;
- a range, where the claim is about a construct spanning lines: `` `docs/plans.md:37-39` ``;
- a bare continuation, a number alone: `` `:46` ``, which carries the path of the nearest preceding full citation in the same document;
- a basename with no directory: `` `pair.sh:86` ``, resolved against the tree, and an error where more than one path in the tree carries that name;
- a path outside the checkout: `` `/home/atom/dev/CLAUDE.md:12` ``, a legitimate citation from a plan in this repo to a file this repo does not contain.

The continuation is the form a plan uses most, and it is the one that goes wrong silently: a run of `` `:46` ``-shaped numbers under a path the prose changed in between resolves against the wrong file and reports nothing. Where a paragraph moves to another file, the first citation under it is written in full.

Where a sentence quotes the line it cites, the quote is the claim: the number must point at a line containing that text, and for a range, at one line of the span. A citation with no quotation beside it claims only that the line exists.

`python3 scripts/cite.py --check <draft>` resolves all of this and exits 1 on a citation that does not. It reports a bare continuation and a cross-repo path whether they resolve or not, so a run over a clean draft prints rows rather than nothing. It says where a number landed; whether the line it landed on supports the sentence is the `gauntlet-prosecutor`'s check, and no run of the script stands in for it.

## Discovery

The pointers a plan cites come from one `gauntlet-detective` round: every question in one brief, a `file:line` table back. The main agent does not read half the tree to write a plan, and the reviewer resolves the citations that come back.

## The gate

`gauntlet-prosecutor` reads the plan prose and resolves its citations. Its gate token is one of `READY`, `ANOTHER PASS`, `ESCALATE` or `ESCALATE: QUESTION`, and the default on every check is the failing one. `PASS` and `FAIL` are per-check tokens beneath the gate line, never the gate itself.

The owner reads the plan only on `READY`. Rounds before that are between the main agent and the reviewer, and they are cheap; a plan passed carelessly costs the owner directly.

On `READY` the plan waits for the owner. Approval is a message whose first line is exactly `approved`, or exactly `approved with revision` with the amendments below it. Anything else holds.

## Amending an approved plan

An approved plan takes an amendment where implementation settles a value the plan could only estimate: a call-site count, a boundary reading, anything the plan carried as `ASSUMED`. The amendment is a round rather than a redraft, and the amended lines are what moves.

This departs from `docs/approved-specs.md:48`, which has an approved spec amended the same way it was created. A spec amendment is still a full re-review. A plan amendment is scoped, and the scope is stated here because the plan gate's rule lives here.

The main agent returns to a `gauntlet-prosecutor` with three things: the slug, each amended line named by its first words with its new text, and the measured value with the command that produced it and that command's output. Nothing else — the plan body is on disk and the reviewer reads it there.

The main agent takes the measurement, and the command is what makes that safe. The reviewer re-runs the command rather than trusting the number, so a measured value with no command that reproduces it is not an amendment.

The reviewer may be a fresh one. The approved file carries every previous verdict beneath its `--- reviewer ---` divider, and an approved plan is something a `gauntlet-prosecutor` may read, so a reviewer holding none of the original round still reads what that round carried — from the plan file, never from `<gauntlet dir>/reviews/`, which it cannot read at all.

Checks run on the amended lines and the citations they carry, and on nothing else. Every other check prints `carried` with its verdict from the most recent `--- reviewer ---` block. A new finding on unchanged text stays legal and costs one scoped round.

On `READY` the reviewer rewrites `<gauntlet dir>/plans/approved/<slug>.txt`: the amended plan body, then every reviewer block in order, oldest first, each under its own divider. A slug amended twice carries three blocks, and the carried verdicts are read from the last. Any other verdict writes nothing, and the file on disk is the one that stands.

An amendment whose measured value changes no plan line is not a round. No reviewer is spawned and no file is rewritten, and the main agent records the reading in its own report.

A rewritten plan is a new artifact, so the owner's approval of the one before it does not carry, which is the rule `docs/approved-specs.md:50` states for the spec file. `approved` is given again against the plan as it now stands, before implementation continues on it.

An amendment round does not count toward whatever round leash a project sets on this gate. It arrives from the implementation tree rather than from a plan that cannot settle.
