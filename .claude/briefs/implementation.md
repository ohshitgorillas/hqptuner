# Implementation brief

The shape of a brief that carries an unfinished implementation out of one session and into a fresh one.

## The criterion

A brief carries only what its reader cannot get for itself.

Repo-readable material is out, however important it sounds: what a component renders, what a rule says, what a function is for. The reader opens the file.

Session-only material is in, however trivial it looks: a measurement, a run's output, a ruling, a line already checked and found correct, a defect already located. Nothing outside the dead session holds it.

## Slots

Required: `symptom`, `rule`, `scope`. Optional: `authority`, `verified`, `defects`, `transcript`.

No other slot exists. Prose outside a slot is not part of the brief.

`symptom`, 3 lines. What the user observes, in their words where the session has them.

`rule`, 8 lines. What must be true when the work is done, imperative. Acceptance, not explanation.

`authority`, 6 lines. A measured or cited fact the reader cannot derive: a wire timing, a protocol behavior, a documented constant. Each carries its source.

`verified`, 12 lines. `file:line` plus one clause, for work already checked and correct. This slot exists to stop the next session redoing it.

`defects`, 12 lines. `file:line` plus what is wrong there. Located, not diagnosed at length.

`scope`, 6 lines. Baseline commit, worktrees, branches, suite state.

`transcript`, 1 line. Absolute path of the session JSONL the brief was drawn from.

Whole brief: 40 lines.

## Excision

A cut instruction deletes whole slots. It never rewords inside one.

A slot is cut when every line in it fails the criterion. Surviving slots stay byte-identical, so a cut round is checkable by diff.

A cut instruction goes to a fresh `brief-writer` against the same transcript, never to the agent that drafted the text under it.
