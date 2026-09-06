---
name: plan-gate
description: The two-stage plan gate for HQPTuner, the plan-reviewer and spec-reviewer loops, the two disagreement lanes, the grounding gate and the open-question test. Load before drafting any plan, and before answering a "what if" about code.
---

# Plan gate

## Stage 1: plain English

Prose only. Opens with the owner's brief quoted verbatim under `brief:`, and under each brief sentence one line, `delivered:` naming the plan element that carries it or `dropped:` naming why, every `dropped:` repeated as an open question. Dropping a brief element silently, for any reason including grounding, is a defect; the reviewer fails it under check (i).

Then: what is wrong or wanted, what the user sees change, which files or areas get touched and roughly how, the caller-side delta where one applies, what it costs (playback interruption, rebuild, risk), and any open question that is genuinely the owner's. Stage 1 carries no spec block, no signatures, no changelog line, no code, no test design. Its first line is `slug: <slug>`, the slug `scripts/pair.sh open` will take; its second is the `grounding:` line from the grounding gate below.

**Open questions.** A question is open only when I cannot get the answer myself AND proceeding either way would produce materially different work the owner would want to have chosen between. Anything a doc, the code, the plan doc or a standing ruling answers is not a question; look it up and state the answer as a decision I own. Most plans have none; the section is omitted, never padded. Before a proposal enters a plan, argue it down myself: name the state or case where it fails and see if it survives. What dies never reaches the owner as a branch. The `plan-reviewer` checks disclosure, never design merit, so `READY` is no evidence the design is sound.

**Caller-side delta.** A plan that splits or extracts states how many call sites change and in which files, before any writing starts. A split that leaves forwarders behind touches no callers; an implausibly small count is the tell. A moved method whose name and path survive unchanged means no caller moved, so the extraction did not happen. Gates catch the syntactic barrel shapes (`scripts/gates/check_no_barrels.py`) and cannot see intent.

## Grounding gate

Applies to both stages. Answer every question free investigation can answer before presenting; reading is free. Every load-bearing claim is verified with a citation (`file:line`, unit, command output) or tagged `ASSUMED`, legal only when settling it needs a metered action, a live experiment, or the owner's decision. Revising a plan after reading material that was free to read before presenting it is a defect, same class as an unverified subagent claim.

**Locating is delegated, verifying is not.** The trigger is a read, not a count: before the first read of any file outside the plan's touched list, every grounding question goes to one `caveman:cavecrew-investigator` in a single batched brief, asking for pointers (`file:line` plus a one-line role) and short quotes. Write the touched list first, then the brief, then spawn; a read outside the list before the spawn is the defect this paragraph exists to name. Each pointer I will cite is then verified by reading only the cited range, with `sed -n` or `Read` with offset and limit, never the whole file. A pointer that does not say what the investigator said it says, and a brief item it left unanswered, go back to the same agent by `SendMessage`, unless one grep I can run myself settles it. Whole-file inline reads are allowed for the files the plan lists as touched, and for nothing else. Investigator text is never pasted into a plan; every citation is a line I have read myself. The investigator is not a chain agent, so it is not blinded from `hqptuner/`, and its spawn is free.

**The `grounding:` line.** The plan's second header line, directly under `slug:`, is `grounding: investigator` or `grounding: inline`. `inline` is legal only when every citation in the plan lies inside its touched list; one citation outside it means the investigator, whatever the size of the question. The plan-reviewer counts the cited files outside the touched list under check (b), and a missing line or an `inline` that cites outside fails there. When the investigator answers `No match.` on a load-bearing claim, I run the one grep myself and cite the command output; a `No match.` is never cited on the investigator's word. When it refuses, the question was a fix or design question rather than a location question: restate it as one and return it to the same agent, or answer it by reasoning if no location settles it.

Never edit `hqptuner/` in the owner's checkout to run an experiment, even restored afterward. A "what if" question is answered by reading and reasoning; if measurement would help, say so and ask, and do it in a throwaway worktree.

## The plan-reviewer

Every stage 1 plan goes to `plan-reviewer` before the owner reads one, whatever its size. The brief is the bare plan prose: it counts framing before it runs a check, and a spec block, a diff or a finished change is rejected on sight. It reads the implementation deliberately, because its checks are claim resolution: the plan cites `file:line` and the reviewer opens it. It returns `READY`, `ANOTHER PASS` or `ESCALATE`, one line per fixed check, and writes every round to `state/reviews/<slug>.plan.<N>.txt` itself.

- `ANOTHER PASS`: repair against the named repair and return to the **same** agent by `SendMessage`, carrying the previous round's findings for every check whose plan text is unchanged. A fresh `Agent` call for a plan that already has a reviewer is a defect on the same footing as skipping the review.
- `REJECTED: STEERING` or `REJECTED: EVASION`: that reviewer is finished, printed no checks, and the bare plan goes to a fresh one, named as abandoned in the report.
- `ESCALATE`: stop redrafting and put the design question to the owner inside the plan, with the reviewer's alternative.
- No round limit, but past eight rounds stop and report: what the reviewer keeps failing, what each repair changed, why it is not converging.

**Disagreement has two lanes and no third.** Fact lane: a citation the reviewer lacked, `file:line` or command output, sent to the reviewer, one round. Apply-and-flag lane: the repair applied, and one line in the plan quoting the finding and saying why you think it wrong, for the owner to rule on with one word. An unapplied finding you have no citation against is never presented, never argued, never rewritten around; a reviewer note naming a file you can read is read before the plan goes anywhere. Arguing, "already ruled", silence on a finding, or restating the claim so the finding no longer applies gets `REJECTED: EVASION`.

Findings reach the owner as plain English, never the report. `READY` is the reviewer's to grant; being seen by the owner is not the reviewer's to withhold. Presenting a plan the reviewer has not marked `READY` is a defect on the same footing as skipping the review.

## Stage 2: the spec

Only after stage 1 is approved. The finished spec block per `/tests`: public entry points, wire facts, fixtures, the changelog line, and the `spec-reviewer` verdicts one line per behavior. Stage 1 approval authorizes writing stage 2 and nothing else; no `Write`, `Edit` or metered action happens until stage 2 is approved. A docs-only change with no behavior lines has no spec block and no spec-reviewer; the deliverable to rule on is the text itself.

## Approval

A stage advances on go / approved / continue / proceed / yes or a plain equivalent, once per stage; stage 1's word does not carry to stage 2. Everything else is discussion: questions, refinements, corrections, tradeoff talk, "that looks right", "makes sense", partial agreement. Discussion is answered in words and ends there. Re-present a revised plan and ask again rather than reading agreement into commentary; a revision at either stage is re-reviewed and re-approved.

## What needs no permission

Work that requires no decision from the owner is not a permission request. Free reading, finishing an investigation after a budget trip, deleting dead code already flagged, rewriting my own defective spec block: mine to do, and asking first is a failure. Before asking, name the decision that is actually the owner's: a preference, a tradeoff between real branches, something irreversible. If the answer is obviously one way, or the action is free and reversible, do it and report. The fix to my own bad spec, plan or code is mine to write; a menu of options in place of a call is the same failure.

## Delegation notes

Concurrent subagents share one scratchpad directory and pick the same obvious filenames (`orig.json`, `tmp.json`), so one agent's snapshot lands under another's restore step. Any brief for concurrent agents names the scratchpad files it may use, prefixed with the target's slug, and says the directory is shared; verify the target's identity after the run by a distinctive field, never by trusting the filename.
