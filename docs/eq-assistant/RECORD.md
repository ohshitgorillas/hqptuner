# Session records — writing the tuning JSON

Binding spec for the `*-tuning.json` files under `sessions/<headphone>/`. Read before appending a turn.

## File shape

Top-level: `headphone`, `model`, `eq_profile`, `measurement`, `yardstick` (or `target`), `state`, then `turns` — an array, one entry per user turn, append-only.

Append-only binds turn existence and the verbatim fields: no turn is ever deleted, and `complaint`/`answer` are never touched once written. A turn invalidated later (bad data, contaminated listening) stays in the ledger with the contamination noted in the entry that discovered it. Agent-voice fields are not history in that sense — they are the agent's own prose, and condensing them later is maintenance, not falsification. Cut process narration and metrics the reader can fetch from the job file whenever a field has outlived its turn.

The per-turn key set is closed: only the keys listed under Per-turn fields appear. A turn needing something the spec has no key for goes in the nearest agent-voice field, never in a key invented on the spot.

## `state`

The current chain, rewritten in place every turn, so a reader learns where the session stands without replaying it.

- `bands` — the staged chain, one entry per band, the shape of a `changes` entry without `kind`.
- `preamp_db` — current preamp.
- `serves` — one line per band saying what it is for.
- `prices` — deviations knowingly left unfilled, each with its reason.
- `as_of` — the turn this reflects.

`state` is the one block rewritten rather than appended, and it is wholly derived: every number in it traces to a turn below.

## Archive

A ledger keeps its head blocks and roughly the last eight turns. Older turns move, unedited, into an archive file beside it, oldest batch `01`, shaped `{"of": "<live file>", "turns": [...]}`; the live file names it in `archived_turns`, and every archived turn carries an explicit `turn` number so citations still resolve. Moving a turn is not deleting it; the archive is opened only when a question reaches back past `state`.

The archive filename is the live filename with `-turns-NN` before the extension — `ori3-tuning.json` archives to `ori3-tuning-turns-01.json`. That shape is load-bearing, not cosmetic: `.gitignore` excludes `docs/eq-assistant/sessions/**` and re-includes only `*tuning*.json`, so an archive named without `tuning` in it is untracked and is lost on clone.

## `measurement` and `yardstick`

Present whenever the session is corrective (`CORRECTIVE.md`); both may be absent in a pure voicing session.

- `measurement` — `file` (repo path to the data), `source` (who measured, on what rig, with what tool and settings — enough to judge trust), `form` (raw or compensated, channels, point count, resolution, frequency range; note any unparsed original kept as archive), `cleaning` (despike parameters, points rejected, any override stretches and why).
- `yardstick` — `what` (the target curve and where it came from, or `flat-on-this-rig`), `basis` (the evidence the target rests on — rig family compatibility, or cited testimony for a nonstandard rig), `used_as` (tight fit target vs sizing reference, tilt and alignment applied), and `pending_upgrade` when the target's confidence is provisional (name what evidence is awaited and what it would change). `file` when the target is a data file.

Both blocks are the session's epistemic ground: every `diagnosis.method` that computes an error curve refers back to them, so they carry the detail a later agent needs to re-derive the same target spec.

## The verbatim rule

`complaint` and `answer` hold the user's words **byte-for-byte** — punctuation, casing, quote marks, profanity, typos, everything. Never summarize, reword, or clean up. Quoting the user inside any other field is also byte-for-byte or not at all.

Agent voice lives only in agent-owned fields: `clarify`, `interpreted`, `diagnosis`, `disclosed`, `alternatives_rejected`, `staged`, `outcome`. Interpretation of ambiguous user wording goes in `interpreted`, clearly separated from the quote it interprets.

## Per-turn fields

- `complaint` — the user's words that opened the turn. Verbatim. Always present.
- `answer` — the user's reply when the turn asked a question. Verbatim.
- `clarify` — options/forks the agent surfaced, agent voice.
- `interpreted` — the agent's reading of ambiguous user wording, with the ambiguous phrase quoted exactly.
- `diagnosis` — `method` (how it was measured/derived), `finding`, `explains_symptom`, `confidence_flags` when the finding carries a caveat. Numbers from tool output, never recalled.
- `changes` — the staged diff: `kind` (`append_band`/`amend_band`), `type`, `f_hz`, `gain_db`, `q`, `rationale` per change; plus `preamp_db` when it moved.
- `measured` — before/after metrics from eqlab for this turn.
- `staged` — how it reached the pending buffer (tool, mode, verification) and pointers: job files, snapshots, exports. Always ends by noting Apply is the user's.
- `disclosed` — a limit, risk or cost the agent put in front of the user before staging.
- `alternatives_rejected` — forks considered and turned down, each with the reason. This is the field anti-patterns are later mined from, so the reason matters more than the option.
- `outcome` — closing summary when a turn concludes a phase. Turns that close nothing carry none.

Four of these have a length rule, because all four have run long in practice:

- `method` is one sentence naming how the numbers were got, plus the job file. Search attempts that failed, retries, solver settings tried and dropped, and where the turn was interrupted are all recoverable from the job files and belong there, not here.
- `measured` carries only the metrics `finding` argues from — three to five. The full metric set is already in the job file `staged` points at.
- `rationale` on a band is written only when the band's purpose is not already plain from `finding`. Five bands rarely need five sentences.
- `explains_symptom` connects the finding to the user's words and stops. It does not restate the finding.

## Tooling and truth

Design and measure with `scripts/eqlab` (keep job files beside the record); stage with `scripts/eqstage` — never raw `curl` writes. `POST /api/config/apply` is forbidden; Apply is the user's click. The running engine (`/api/matrix`) is truth for the live chain; `data/eqlab/` snapshots are truth for what each turn measured.
