# The exemption register

`docs/testing.md` bans two things outright and then allows each of them by owner exception: an existence-only assertion (rule 10) and a `skip`/`xfail` marker (Markers). Both say `EXEMPT`. This file is what that word points at, and an exemption that is not written here does not exist.

## The shape

One entry per exempted test, newest last:

```
EXEMPT <tests dir>/<file>::<test>
rule: docs/testing.md rule <n> | marker: skip | xfail
reason: <why the banned shape is the right one here>
owner: <the owner's own sentence granting it, quoted>
date: <YYYY-MM-DD>
```

- **`rule:` or `marker:`**, exactly one. The rule number is the rule the entry suspends, so `rule: docs/testing.md rule 10` and nothing vaguer.
- **`reason:`** says why the surface leaves no better test, not why the test is convenient. "The value is genuinely unbounded" is a reason; "the assertion was flaky" is a defect report.
- **`owner:`** is the owner's words, verbatim, the same way a spec block's `brief:` quotes them. Paraphrase is not a grant.
- **`date:`** is when it was granted, so an entry can be aged out.

An entry covers one test. A parametrize sweep is one test, so one entry covers it; a second test that wants the same shape needs its own entry and its own sentence.

## How one is granted

Approval is for **that specific site**, and it is granted **before the test is written**, never afterwards as a defence of something already landed. A proposal names four things: the rule it suspends, the site, why the test cannot satisfy the rule, and what the exemption costs — what stops being pinned once it is granted.

Widening an existing entry is a new exemption, and so is a second test reaching for one already granted elsewhere. Removal needs no approval at all: an exemption deleted because the test no longer needs it is ordinary work.

## Who writes it

The owner, by hand, or an agent typing the owner's grant at the owner's instruction. The `owner:` line is what makes the entry evidence, which is why it is quoted rather than summarized: a reader checks the entry against what the owner actually said.

**No hook enforces this.** The lane hooks fire on a tool call and key on `agent_type`; this file is not a lane, and a rule that the owner must be the one to decide is not a rule a `PreToolUse` matcher can see. An entry whose `owner:` line quotes a sentence the owner never said is a forged exemption, and nothing in the repo will catch it — the register makes exemptions countable and reviewable, not unforgeable. That is a deliberate gap, stated rather than papered over.

## What it is not

An exemption is not a way past a `STRICKEN`. `gauntlet-arbiter.md` check (o) is explicit: a line taking the existence-only escape needs an entry here before the test lands, obtaining it is the main agent's errand, and its absence is never a reason to keep the line. The reviewer cuts on the line's own merits and the entry decides nothing about that verdict.

A `skip` on an environment or data precondition — a dependency missing, a service down — is mechanism, not exemption, and needs no entry. `docs/testing.md` Markers draws that line.

## Entries

None.
