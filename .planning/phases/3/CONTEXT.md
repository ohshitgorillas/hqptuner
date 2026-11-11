# Phase 3: HF filter lamp follows the content - Context

Gathered: 2026-11-11

Feeds: /cad-plan 3

## Scope boundary

In: the rail's HF stage lamp is lit only while the playing content is content the engaged HF filter acts on; the engine-row HF filter menu grays every option that does nothing on the playing content, and a tap on a grayed option does nothing.

Out: the HF autopilot (todo.txt:11, being peeled back to a recommendation system); the engine-row HF readout text; any badge, reason text or other new copy on the HF menu; measuring any HF filter's corner, slope or reach (proprietary).

Deferred: None

Plan shape: one plan (owner: right-sized).

## Durable decisions

- D-01 (content rate): the content a filter is judged against is the source rate, `metadata.samplerate` from engine status, never `Status.active_rate` (the upsampled output rate). Evidence: `hqptuner/static/store/live/derive.js:90-107` (`NX_FLOOR`), `hqptuner/static/store/faceplate/chain.js:353-363`, `hqptuner/engine/trackcontext.py:30-62`.
- D-02 (1x): no HF filter acts on 1x content, a source rate below 50 kHz. Evidence: manual §4.6 p27 ("1x rates covers source sampling rates below 50 kHz"), manual-facts §9 p8 (20 kHz filter "functional only for 2x and higher source rates"), `docs/spec/faceplate.md:120`.
- D-03 (Nx filters): the 2x filter acts on content above 2x the base rate (4x content and up), 4x on 8x content and up, 8x on 16x content and up; base rate is the 44.1 or 48 kHz family. Evidence: owner ruling 2026-11-11; manual §8 p52 ("Places steep cut-off at 2x of the base rate"), which is otherwise silent.
- D-04 (DSD sources): a DSD source played through PCM conversion counts at its decimated rate, DSD rate / 64 (DSD64 counts as 44.1 kHz, so 1x and dark; DSD128 as 88.2 kHz), and the PCM rules apply to that rate. Direct SDM keeps the HF stage shown bypassed. Evidence: owner ruling 2026-11-11 ("DSD64 is decimated down to 44.1k, so the filter only works at DSD128 and above where it's decimated to 88.2k"); `hqptuner/static/store/faceplate/chain.js:104-114` (`BYPASSED_BY_DIRECT`), `hqptuner/static/store/faceplate/path.js:19-42`.

## Decisions

- D-05 (fixed corners): 20k, 30k, 40k and 50k act only when the content's Nyquist (rate / 2) is above the filter's nominal corner; 50k is dark at 88.2 and 96 kHz and lit from 176.4 kHz up. Evidence: `hqptuner/engine/junkadvisor.py:94-96`, `hqptuner/engine/junkcurve.py:34` (`CORNER_KHZ`).
- D-06 (name key): the acts-on rule is keyed by the engine's option name (`20k`, `2x`, ...), never by list index; the running engine stays the enumeration authority. Evidence: `hqptuner/metadata.py:177`, `hqptuner/data/settings.json:103-117` (index-keyed, not a join target), live `GET /api/enumerations` 2026-11-11 against `hqptuner/data/engine-enums.json:793-834`.
- D-07 (rail lamp): an engaged filter that does nothing on the content shows the HF stage unlit (`off`), not bypassed (`byp`), and prints no value, as any unlit stage does. Evidence: `hqptuner/static/store/faceplate/chain.js:229-234,276-289`, `hqptuner/static/components/faceplate/Rail.js:79-107`, `docs/spec/faceplate.md:40-41`.
- D-08 (HF menu): the engine-row HF filter menu grays each option that does nothing on the playing content; a tap on a grayed option sends no write. A grayed row carries no badge and no text, and no new copy ships. `none` is never grayed. Evidence: owner rulings 2026-11-11 ("Gray non-acting options", "Does nothing", "HF menu has no badges and get none"); `hqptuner/static/components/faceplate/HfFilter.js:52-63`, `hqptuner/static/store/faceplate/hf.js`.
- D-09 (old tests, spec): tests pinning an engaged filter lit on a 44.1 kHz source are old behavior and are rewritten tests-first as changed behavior, never edited to pass: `tests/js/store/faceplate/chain.test.js:104-106,410-412`, `tests/js/components/faceplate/rail.test.js:118-120` (fixture `:45-49`). The off and paused cases at `chain.test.js:422-435` stay. `docs/spec/faceplate.md:41,120` gains the acts-on rule. Evidence: `docs/spec/testing.md` rule 8, repo `CLAUDE.md` tests-first rule.

## Acceptance criteria

- [ ] AC1: On a 44.1 kHz source and on a DSD64 source played through PCM conversion, the rail HF lamp is unlit for every engaged filter, and every HF menu option except none is grayed.
- [ ] AC2: On an 88.2 kHz source, the lamp is unlit with 50k or 2x engaged and lit with 20k, 30k or 40k engaged. The menu grays 50k, 2x, 4x and 8x.
- [ ] AC3: On a 176.4 kHz source, the lamp is lit with 50k or 2x engaged. The menu grays 4x and 8x only.
- [ ] AC4: On a DSD128 source played through PCM conversion, the lamp is lit with 30k engaged and unlit with 50k engaged.
- [ ] AC5: A tap on a grayed HF menu option sends no write and leaves the running filter as it was.
- [ ] AC6: `scripts/gate.sh make check` prints `exit=0`.

## Flagged assumptions

- D-04's rate / 64 rule also covers a DSD source on the SDM remodulation path (`sdm-sdm`), not only DSD to PCM - Likely; if wrong: the lamp and menu on a remodulated DSD source follow the wrong rate.
- With no source rate known (stopped, missing or 0 `samplerate`), the lamp keeps its existing off/paused behavior and the menu grays nothing - Likely; if wrong: the menu grays every option, or none, while idle.
- When the running filter is itself one that does nothing on the content, its menu row stays ticked and is grayed like the rest - Likely; if wrong: the current row reads differently from what the owner expects at hand-back.
- A 48 kHz-family source (96, 192 kHz) follows the same multiples as the 44.1 kHz family, against its own base - Likely; if wrong: Nx graying is off by one step on 48 kHz content.
