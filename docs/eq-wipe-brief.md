# Agent brief — structural-crossfeed EQ-wipe incident

**I am a huge fucking retard, please don't trust anything I've written here.**

Verified facts only. No theories, no proposed fixes. Every prior agent explanation of the MECHANISM was rejected by the user as wrong; the trigger sequence itself is user-given and settled.

## Trigger sequence (given by user — not open)

1. Switched the matrix EQ off: `matrix_enabled` → BYPASS (Matrix tab, General card — control identity confirmed by user).
2. Switched bauer crossfeed on, to test whether bauer works without the matrix engaged. It does not — no audible crossfeed with the matrix bypassed.
3. That sequence left the EQ pipelines mutated. Engaging structural crossfeed afterwards showed the note "pipelines 1+2 do not route straight through — they have been set aside, and the block carries no EQ of its own", and the EQ was wiped from the pipelines.
- Recurrence during the session: user then saw "pipelines 1+2 use linear gain, which the block cannot carry as a preamp — they have been set aside, and the block carries no EQ of its own" together with the matrix-bypassed note.

## Live state captured at recurrence (loopback GETs, outputs observed)

- `GET /api/config/pending`: the pending buffer held `pipelines: "16"` and a 16-row structural block whose rows carry ONLY the block's own stages (`lp1;f=1162.7`, `delay:t=0.000306780`, empty chains) — an EQ-less block, i.e. the wipe staged and not yet applied. User was told not to Apply and to Discard.
- `GET /api/config` file pipelines at the same moment: exactly 2 rows, `gainunit:"Lin"`, straight-routed — row 1 = `0>0 Lin 0.498574234` with the ori3 EQ chains, row 2 = `1>1 Lin -0.060990406` with `lp1;f=1162.7` prefix plus the ori3 EQ chains. These match individual rows of the saved 16-row "ZMF Ori 3.0" structural block (its rows 0 and 9), not the user's plain dB pair. How the file config came to hold this 2-row fragment is unestablished.

## Code facts (working tree = `dev`, uncommitted WIP across crossfeed files)

- The note text is built at `hqptuner/static/lib/xfmode.js:156` from `pairInfo` (`hqptuner/static/lib/binaural-setup.js:71-87`), which returns `setAside` for: missing rows, a pair whose gains are not `dB`, or any routing other than straight 0→0 / 1→1.
- `stageStructural` (`xfmode.js:142-165`): when rows 0..15 are not a recognized structural block and `pairInfo` returns set-aside, it compiles a 16-row block with empty EQ and stages `[block, ...rows.slice(2)]`. The contents of rows 0+1 are discarded; nothing durable preserves them.
- `setAside` stash: existed as uncommitted WIP in `xfmode.js`, contrary to the ruling below, and was excised 2026-08-03. No stash mechanism exists; a removed block is gone, and re-engaging compiles from the controls on screen.
- `setXfMode` (`xfmode.js:231-247`): flipping the Bauer|Structural segment to Bauer with a recognized structural block installed calls `removeStructural`, rewriting pipelines 16→2 rows; flipping to Structural calls `disableBauer` (removes a recognized comp block, stages `crossfeed_enabled=0`) and installs nothing. The view segment writes pipelines. Whether this fired in the incident is unestablished.
- `installStructural` (`components/Crossfeed.js:89-93`): dismantles a compensation block only when `xfeedBlock` recognizes it; otherwise the raw rows reach `stageStructural`.
- A compensation block's rows 0,1 are (src 0→mix 0), (src 1→mix 0) (`lib/xfeed.js:165-167`). An unrecognized compensation block, and equally an unrecognized structural block (rows 0,1 both 0→0), each produce the "do not route straight through" note when fed to `pairInfo`. A straight-routed Lin pair — such as the captured 2-row fragment — produces the "linear gain" note.
- `matrix_enabled` and `crossfeed_enabled` are plain config fields; no code path from either writes pipeline rows.
- `hqplayerd-readme.txt` §1.11/1.11.2: bauer crossfeed is a `post_process` plugin nested inside the `matrix` element; `matrix enabled=0` disables matrix processing. Not live-verified against the daemon.

## Repro facts (executed; outputs observed)

- Saved profile "ZMF Ori 3.0" holds a 16-row structural block with the ori3-v7 EQ chains in all 16 rows; `recognizeRows` recovers it (node run: lambda 0, angle 34, headRadius 0.0939, preamp −4.68 both ears, chains intact).
- Earlier in the session the daemon file config pipelines were 2 straight dB rows carrying the full ori3-v7 chains at gain −4.68, matching `docs/eq-assistant/ori3-v7-correction.txt`. The EQ remains recoverable from that profile, from the correction txt, and from the chains still present in the captured Lin fragment rows.
- `msRecognize` robustness (node run, 9 cases): fresh compile; recognition under two drifted bauer settings (stale=true, still recognized); 9-decimal requantized gains; trailing zeros stripped; 60% and 0% slider positions; empty EQ chain; block compiled under one setting and recognized under another — all 9 recognized. No serialization or settings-drift case was found that breaks compensation-block recognition.
- In-place edits to rows inside a recognized block break recognition by design (tamper cases in `scripts/gates/check_binaural.py`; line 286 asserts "pair shapes read or set aside, never refused").
- No saved profile was wiped; every named profile still carries its EQ rows.

## Open

- The mechanism: which code, fired by the user-given sequence above, wrote the mutated rows. No agent explanation offered so far survived the user's review.

## User rulings (binding)

- Hard rule: no code path may discard pipeline rows. Unparseable input → refuse.
- Refusal wording, exact and sole text: `/!\ Structural crossfeed requires a stereo starting point. Ensure the first two pipelines route to themselves.`
- Rejected: EQ-write chokepoint / import refusals (scope creep); any set-aside or stash mechanism.
- Plans must state the finished behavior in plain English; "investigate then fix" is not a plan; work starts only on an explicit go word.
