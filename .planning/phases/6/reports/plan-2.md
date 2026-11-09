PLAN COMPLETE

Plan: .planning/phases/6/PLAN-2.md

Tasks: 5 of 5

| Task | Commit | Note |
|---|---|---|
| 1 - struck by owner ruling (F-021) | none | Struck, not skipped. Discovery behavior, comments and its test stay. |
| 2 - refused save shows backend's sentence | de918df3 | submitConnection catches host_invalid, credentials_required, login_values_pinned; shows the error's message under verdict "rejected" (the first two) or the existing "pinned"; clears awaitingVerdict; panel stays open; other codes rethrow. logIn maps host_invalid to "rejected". `verdict` doc comment updated (eleven members). Component renders loginSentence for "rejected". CHANGELOG `[Unreleased]` `### Security` entry landed verbatim as owner-approved. Bite: 7 new cases red against the previous src. |
| 3 - blank-password placeholder | none | Owner ruling: current text "Leave blank to keep the stored password" stands. Task makes no change. |
| 4 - stored-password note | 0bbc6dc4 | `<p class="t-caption" data-testid="setup-remember-note">` inside `.setup-remember`, owner-approved text verbatim; no new CSS (`.setup-card p` already covers margin and measure). Component case by test id and class; red against previous src. The owner's own look at the panel (e2e job or local run) is still due before the phase is called done. |
| 5 - IPv6 bracket in daemon link | 1382ae4d | eightyEightyEight strips brackets from the host field and page host, brackets once when the address holds a colon. Four cases (IPv6 field, IPv4 field, bare IPv6 pageHost, bracketed pageHost). |

Deviations:

- [deviation] Task 5 Verify expected the bracketed-pageHost case to be red against the commit before; observed green (old code interpolated the already-bracketed value untouched). Kept as a guard against bracketing twice; added a bare-IPv6 pageHost case (`2001:db8::7`), which is red before and covers the plan's "bare in some browsers" half. Criterion unchanged.

Open items:

- The owner's unstaged working-tree edits (`.planning/` files) were left uncommitted.
- Full suite: `scripts/gate.sh make check` (Makefile; workflow.test_command is null) printed exit=0 after the last commit.
