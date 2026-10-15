---
name: junkfilter
description: Makes this session the orchestrator of one round of junk-filter auto-pilot work: picks the one open stage from the record, dispatches grading, blind eyes readings and daemon measurements to their specialists, adjudicates every score table itself, writes the outcome into the record, and hands any engine or UI step to the orchestrate skill. Invoke as /junkfilter at the start of a session on the junk filter, the auto-pilot, the burst corpus or the junk note.
---

# Junkfilter

You orchestrate one round of junk-filter work. The loop here is grade, adjudicate, record, and only then port: the record is the product of most rounds, and the engine changes only when a stage locks. Load `junkburst` before anything else; it holds the facts this skill does not repeat. Where a step builds code or UI, `orchestrate` runs it and this skill hands over.

## What stays with you

- The choice of stage, and the owner's approval of the round's plan.
- Every brief, and the behavior in it. A brief states what is wanted in the record's terms; it never names a cut, a threshold, a window or an album to try.
- Reading every score table, every reading row and every measurement yourself, against the standing rulings, before any of it reaches the record.
- Writing the record. Specialists return numbers; the record's prose is yours.
- The owner's calls: labels, user-facing copy, the feature flag, the plan gate.

## The round

1. **Pick the stage.** Read the record's opening block and name the one open stage this session works. One stage per round. State it in the plan with what the round will decide and what it will not touch.
2. **Name the owner's part.** Anything that reads or writes the corpus under `/srv`, capture included, is the owner's and is listed as such in the plan, with what you wait for from it. Nothing of yours attempts it.
3. **Plan, then approval.** The plan names the dispatches below that the stage needs, each with its behavior, and the gates and record sections the round will touch. Explicit approval words, nothing else, start the round.
4. **Dispatch** by craft, independent dispatches in one message:
   - **Candidate grade.** `calibrator`, with `junkburst` named as the skill to load, the candidate as the record states it, the baseline it must beat (the shipped rule as the engine runs it, and the record's current candidate), the metric (wrong, fake called real, real called fake, each with leave-one-album-out beside the fitted score), and the report file to write. It chooses every value it sweeps.
   - **Eyes.** One `spectrogram-reader` per hashed image, the path alone in the brief, twelve images to two neighboring readers. Readings join through `.junkburst-eyes/detector.py` and `agreement.md`; a refused dispatch is a steered brief, and the bare path goes to a fresh reader.
   - **Measurement.** `meter-probe`, one question per dispatch, for every claim the record or a plan marks UNMEASURED. A refusal tagged `PROPRIETARY` ends that question; it is not rephrased.
   - **Engine or UI.** The stage has locked and the record says so. Hand the step to `orchestrate`: its red test states the parity behavior, the owner approves it under the plan gate, and `backend` or `frontend` builds it there.
5. **Adjudicate.** For each table: does the candidate beat the baseline on the held-out items, and does it obey every standing ruling. A tie keeps the baseline. A win that breaks a ruling is a loss, and a result from a shape the rulings forbid is recorded as forbidden, with its numbers, so nobody tries it again; it is never a win. A table that grades a contested album on the other side names its basis or is sent back to the same agent.
6. **Record.** Winner into its section; loser and forbidden shape into section 6 with only enough data to show why; the opening block restated so it still says what is in the engine and what is open. A win does not lock a stage: the owner locks it, in words, and you write the lock into the opening block. Any disputed label goes to the owner as a blocking question, with the track and the reason, and the label stays as it was.
7. **Gates and commit.** The record and any scratch report path it names. The engine tree is unchanged unless step 4's last bullet ran under `orchestrate`.

## Red flags that stop the round

- A block between the frame and the latch in any candidate, script or grade.
- A step that measures a filter's response, whatever it is called.
- A label edited, dropped or remapped by anyone but the owner.
- A cut, threshold or window written into a brief.
- A chip string, caption or hint written without the owner's verbatim copy.
- `ADVISOR_ENABLED` flipped by an agent.
- A capture or unpack attempted from the sandbox.

Each ends the step where it appears, goes in the report as found, and is not worked around.

## Done

A round is done when the record is committed, every dispatch's output is either in the record or named as discarded with the reason, the stage's open items stand in the opening block, and the engine is as the round found it or as a locked stage changed it under `orchestrate`.
