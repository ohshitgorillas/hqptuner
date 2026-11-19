PLAN CHECKPOINT: human-verify

Plan: .planning/phases/7/PLAN-5.md

Tasks: 0 of 1

| Task | Commit | Note |
|---|---|---|
| 1 - The spec names the time base as the owner of the conversion | none | Waiting on the owner's verbatim approval of the amendment (D-05). `docs/spec/timing.md` untouched. |

Proposal put to the owner (agent draft, a proposal only, not the spec):

Site 1, two-clocks table, "Playback time" row, last sentence of "Its only source". Now: "The feed store converts both to ms at that rate, once." Proposed: "The feed store converts them to ms at that rate, once, through `hqptuner/static/lib/timebase.js`, which owns the conversion of whole samples to ms and the reading of a frame's start and end."

Site 2, meter pipeline table, "Feed store" row. Now: "Decoding, queueing, detecting a break in samples, converting the stamp to ms, stamping each event with the wall time it arrived". Proposed: "Decoding, queueing, detecting a break in samples, converting the stamp to ms through `lib/timebase.js` (the one call site that converts wire stamps), stamping each event with the wall time it arrived".

Site 3, rule 2 "Durations come off the wire". Proposed sentence appended: "Samples become ms in one place, `lib/timebase.js`, and the feed store is the one caller that converts a wire stamp."

Two places that disagree with D-02, named, changed only in words the owner approves:

(a) Examples, "Positions come from stamps": `slice.end = last.at + last.ms;` sums two ms values; D-02 makes a frame's end the whole-sample end converted. Proposed: `slice.end = endOf(last);`.

(b) Two-clocks row says the store "converts both to ms"; the store converts three values (`at`, `end`, `ms`), end from `at + n` in samples. Covered by the Site 1 wording above ("them", plus start and end read through timebase.js).

Deviations: none

Open items: Owner approval of the wording above outstanding; no file written. After approval, Edit exactly that text, then run the Verify checks (grep "lib/timebase.js", md-softwrap --check, check_docs.py, grep for em dash) and commit `docs(7-5)` with `docs/spec/timing.md` only.
