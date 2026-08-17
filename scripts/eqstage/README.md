# eqstage — agent operating manual

Puts an EQ into HQPTuner's **pending buffer**, where the user can see it and Apply it. eqlab designs and measures; eqstage stages. The buffer is server-side (`hqptuner/api/routes/pending.py`), so a staged change appears in the user's open browser tab within a poll tick and arms the Apply button — no page interaction by the agent.

```
node scripts/eqstage/eqstage.js < job.json    # JSON on stdout, table on stderr
```

## RULE: staging is not applying

This tool has no code path to `POST /api/config/apply`, `POST /api/config/live`, or `DELETE /api/config/pending`, and none gets added. Flushing the buffer to the daemon is the user's click. If a job cannot express what you need, say so and ask — never route around the tool with raw `curl` writes.

## Job shape

```json
{ "url": "http://127.0.0.1:8090",
  "rows": "all",
  "eq": {"bands": [{"type": "peak", "f": 5000, "q": 2, "g": -4}]},
  "mode": "replace_tail",
  "preamp_db": "auto",
  "http": {}, "live": {},
  "dry_run": false, "force_gainunit": false, "fs": 44100 }
```

- **`rows`** — `"all"` (default) or a list of baseline row indices. Unselected rows are staged byte-identical to their baseline: the field replaces the whole row set, so every row must be present.
- **`eq`** — `{"bands":[…]}` (types `peak`/`lshelf`/`hshelf`, params `f g q bw s`), `{"process":"iir:…"}` for a literal process string, or any eqlab chain source (`{"from":"snapshot","name":…}`, `{"from":"parametric_eq","path":…}`, `{"from":"xml","path":…,"row":…}`) — so what eqlab measured is what gets staged.
- **`mode`** — `replace_tail` (default) swaps the trailing run of parametric-EQ stages and keeps any lead-in (crossfeed `lp1`, `delay`, a convolution); `append` keeps everything and adds the bands after it.
- **`preamp_db`** — a number, `"auto"` (negative of the summed response's maximum, same guardrail eqlab reports), or omitted to leave row gain alone. Written as the row's channel `gain` with `gainunit` `dB`.
- **`http`** / **`live`** — extra fields staged alongside; `http` are persistent config fields (names per `static/store/schema.js`), `live` are Control-API settings validated server-side (422 on unknown keys).
- **`dry_run`** — build and report the payload, POST nothing.

## Answer

`baseline_source` (`config` = file truth via `/api/config`, `matrix` = read-only-mode fallback via `/api/matrix`), `eq` (band count + process string), `preamp_db`, per-row `before`/`after` (band count, process, gain, gainunit) with `selected`, the exact `staged` payload, and `posted` / `verified`.

## Guards

- The baseline is always read, never synthesised — a staged `matrix_pipelines` replaces every row.
- Rows are canonicalised byte-identically to the UI's `canonPipelines` (`static/store/resolve.js`), then linted against the server's row contract (`conf/matrixconf.py` `_validate_row`) — source/mixdown integers 0..127, numeric gain, `gainunit` `dB|Lin`, no control characters. A lint failure aborts before any POST.
- A row already carrying `gainunit:"Lin"` is part of a decomposed matrix (Bauer crossfeed writes those); a dB preamp on it is refused unless `force_gainunit` is set. Amend band gains instead, or ask the user.
- After the POST the buffer is read back and every staged key checked against what was sent. Merge is expected — the user's own staged edits sit alongside — but one of our keys holding a different value means the stage lost a race, and that fails loudly.

## Fallback

If the API lane is unavailable, export a ParametricEQ text file from eqlab (`{"kind":"export"}`), hand the path to the user, and have them import it in the browser: Matrix tab, the row's Import EQ control. Bands land in the pending bar the same way.
