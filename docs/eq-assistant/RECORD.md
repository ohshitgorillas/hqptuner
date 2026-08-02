# Session records — writing the tuning JSON

Binding spec for `*-tuning.json` files in this directory. Read before appending a turn.

## File shape

Top-level: `headphone`, `model`, `eq_profile`, `measurement`, `yardstick` (or `target`), then `turns` — an array, one entry per user turn, append-only. Never rewrite or delete history; a turn invalidated later (bad data, contaminated listening) stays in the ledger with the contamination noted in the entry that discovered it.

## The verbatim rule

`complaint` and `answer` hold the user's words **byte-for-byte** — punctuation, casing, quote marks, profanity, typos, everything. Never summarize, reword, or clean up. Quoting the user inside any other field is also byte-for-byte or not at all.

Agent voice lives only in agent-owned fields: `clarify`, `interpreted`, `diagnosis`, `disclosed`, `alternatives_rejected`, `staged`, `outcome`. Interpretation of ambiguous user wording goes in `interpreted`, clearly separated from the quote it interprets.

## Per-turn fields

- `complaint` — the user's words that opened the turn. Verbatim. Always present.
- `answer` — the user's reply when the turn asked a question. Verbatim.
- `clarify` — options/forks the agent surfaced, agent voice.
- `interpreted` — the agent's reading of ambiguous user wording, with the ambiguous phrase quoted exactly.
- `diagnosis` — `method` (how it was measured/derived), `finding`, `explains_symptom`. Numbers from tool output, never recalled.
- `changes` — the staged diff: `kind` (`append_band`/`amend_band`), `type`, `f_hz`, `gain_db`, `q`, `rationale` per change; plus `preamp_db` when it moved.
- `measured` — before/after metrics from eqlab for this turn.
- `staged` — how it reached the pending buffer (tool, mode, verification) and pointers: job files, snapshots, exports. Always ends by noting Apply is the user's.
- `outcome` — closing summary when a turn concludes a phase.

## Tooling and truth

Design and measure with `scripts/eqlab` (keep job files beside the record); stage with `scripts/eqstage` — never raw `curl` writes. `POST /api/config/apply` is forbidden; Apply is the user's click. The running engine (`/api/matrix`) is truth for the live chain; `data/eqlab/` snapshots are truth for what each turn measured.
