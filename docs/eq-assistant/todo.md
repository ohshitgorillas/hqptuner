# EQ Assistant TODO

Execute each item and cross it off the list.

1. Verify content contains audibility of phase changes due to EQ peak presence.

2. ~~Docs contain trivia about the writing/development process that is noise to an agent. Excise.~~ **DONE 2026-07-26.** All seven docs swept. Retrieval mechanics, fetch failures, dated changelog banners and withdrawn-draft narration cut; verification tags, source prohibitions, Open items and normative corrections kept, the last restated present-tense. Two bugs fixed in passing: a malformed `SOURCES.md` §6 table delimiter, and two `PSYCHOACOUSTICS.md` §6 Open items claiming sources were unobtained that the same file reads in full.

Ex:
- PSYCHOACOUSTICS.md: "Read in full from a hand-fetched PDF. (The text layer is a font subset with no Unicode map — pdftotext yields garbage. Read the rendered pages.)"

The details of *how the information was fetched* is of no use to the agent's goal.

3. ~~MAJOR gap: Hearing loss and deficits. one user writes: "I EQ to try to try to compensate for my ears, not to change the phones. If my hearing loss could be magicked away, I'm sure I'd be perfectly happy whith my HD600, let alone HD800. Wait... yes, I remember a time when I was!"~~ **DONE 2026-07-26.** New companion `HEARING.md` (10 sections), from four research lanes. `PSYCHOACOUSTICS.md` §1 gained a scope limit — its ERB arithmetic is normal-hearing-only, and cochlear loss broadens the filter, so the low-Q ruling strengthens while that derivation stops applying. `PRIMER.md` gained the prior an agent needs every turn. Headline finding, and it is a constraint rather than a feature: the naive move — boost where the loss is — is what the evidence most consistently contradicts. Three independent literatures agree listeners take less gain than a mirrored audiogram prescribes, and the shortfall is worst in the treble. Deliberately not done: `vocabulary.json` untouched (see `HEARING.md` §10 — it needs a decision entry, not a quiet edit).


