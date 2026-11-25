PLAN CHECKPOINT: human-verify

Plan: .planning/phases/9/PLAN-4.md

Tasks: 0 of 1

| Task | Commit | Note |
|---|---|---|
| 1 - The owner checks every style under two color suites on the rebuilt dev build | none | Awaiting owner. No rebuild run: the served `/components/faceplate/page/sourcepaint.js` on `:8090` is byte-identical to the working tree file (diff empty, HTTP 200), so `hqptuner:dev` already serves Plan 2's last commit fd8296c8. Own captures via raw playwright (`/tmp/p94/cap.py`, localStorage prefs only, no daemon write, no Apply/Discard/Save clicked) of `.sgrid1` under trace, bars, ridges, aurora, fade, fire with Borealis and viridis. Computed DOM: under Trace the `d` of `.strace`/`.sarea`/`.shold` is 3554/3570/3553 chars (Borealis) and 3556/3572/3556 (viridis); under every other style all three are empty (0 chars). `.sgridl` has 8 children and displays under every style. Captures read element by element: Trace shows line, fill and shadow; Bars, Aurora, Fade, Flames show none of the three; Ridges shows its own stacked lines and no dB grid lines or dB labels (as before); Fade shows its own glow with no separate trace; grid, scales and Range keys show under all other styles. Aurora's shader rendered in headless chromium for both suites, though node lacks WebGL2, so D-10 still rests on the owner's eyes. |

Deviations: none Open items: Own captures were taken with `hqplayerd` State 0 (idle) per `/api/status`; the spectrum had live data from the source, but no agent starts transport, so the owner's check with music playing is the AC7 evidence. The owner's words are not yet in hand.
