# Staging from the CLI — operating doc for assistant agents

What "staging" means here: HQPTuner's pending-changes buffer is **server-side** — `PendingStore` on `app.state.pending` (`hqptuner/api/pendingapi.py:19-36`), two dicts: `live` (Control-API edits keyed by live setting) and `http` (persistent config fields keyed by field name). It survives browser reloads because it lives on the backend, and the web UI mirrors it every ~2 s (`static/store/sync.js:61`). Therefore anything staged into the store shows up in the user's open browser tab within a poll tick, lights the pending bar, and arms Apply — no page interaction by the agent required.

## Use the tool

`scripts/eqstage/` stages an EQ — bands, preamp, extra fields — in one job. It reads the baseline rows, edits only the rows you select, canonicalises and lints, POSTs, and verifies the echo. Full manual: `scripts/eqstage/README.md`.

```
echo '{"rows":"all","eq":{"bands":[{"type":"peak","f":107,"q":0.7,"g":-4},{"type":"hshelf","f":10000,"q":0.7,"g":-4.3}]},"preamp_db":"auto"}' \
  | node scripts/eqstage/eqstage.js
```

Design and verify the chain with **eqlab** first (`node scripts/eqlab/eqlab.js < job.json`, `scripts/eqlab/README.md`) — read-only, same math as the UI plots. `{"from":"snapshot","name":…}` in an eqstage job stages exactly what eqlab measured. Prior tuning-session records live under `sessions/<headphone>/` (`sessions/auteur/auteur-classic-tuning*.json`).

**Forbidden either way: `POST /api/config/apply`.** Apply flushes the whole buffer to the daemon (`api/app.py:218-237`) and is the user's click, always — the agent stages, the user applies. Same for `POST /api/config/live` and any write to the daemon on 8088/4321. `DELETE /api/config/pending` clears everything staged including the user's own edits — only on explicit request.

## What the tool is doing underneath

Useful when a job fails, or when staging something eqstage does not model.

- **Stage:** `POST /api/config/stage` with body `{"live": {...}, "http": {...}}` (`pendingapi.py:59-66`, body model `api/models.py:10-12` — both dicts of strings, both optional). Repeated POSTs merge (`PendingStore.stage` is `dict.update`).
- **Inspect:** `GET /api/config/pending` returns the snapshot (`pendingapi.py:69-71`).
- Parametric EQ bands **and** preamp are one `http` field, `matrix_pipelines`: a single canonical-JSON string holding an array of rows `{gain, gainunit, mixdown, process, source}` with **every value a string and keys in that alphabetical order** (`static/store/resolve.js` `canonRow`/`canonPipelines`; server grammar `hqptuner/conf/matrixconf.py:85-101`). Compact JSON, no whitespace. It **replaces the entire row set**, so the current rows are read first and edited, never synthesised — file truth `GET /api/config` → `.data.file.matrix_pipelines`, read-only-mode fallback `GET /api/matrix` → `.data.rows`.
- Bands are `iir` stages in a row's `process` string — comma-separated, plugin syntax `iir:type=peak;f=1000;q=1;g=-3` (authority: `hqplayerd-readme.txt` §1.11 "process" / Plugin "iir": types `lp|lp1|hp|hp1|bp|ap|notch|peak|lshelf|hshelf|biquad`, args `f`, `q`, `g` in dB, plus `bw|s|b0..a2`). Preamp is the row's channel `gain` with `gainunit` `"dB"` — the same mapping the UI's EQ import uses for a `Preamp:` line (`static/components/MatrixTab.js:53`, `static/lib/eqimport.js:27`). A Bauer-crossfeed-decomposed matrix carries `gainunit:"Lin"` rows; do not overwrite those with a dB preamp — amend band gains, or ask.
- `/config/stage` validates only `live` keys (422 on unknown, `pendingapi.py:61-63`); `matrix_pipelines` is grounded at apply time, which is why eqstage lints the row contract itself before posting.
- Other persistent fields stage as scalar `http` entries (e.g. `{"http":{"post_bauer_frequency":"700"}}` — field names per `store/schema.js`); pass them through eqstage's `http` block.

## Fallback: ParametricEQ text export + UI import

If the API lane is unavailable, write a standard EqualizerAPO/REW-style text file — `Preamp: -3.0 dB` plus `Filter N: ON PK Fc 107 Hz Gain -4.0 dB Q 0.70` lines (grammar: `static/lib/eqimport.js`), or `{"kind":"export"}` from eqlab — hand the path to the user, and have them import it in the browser: Matrix tab → the row's Import EQ control → pick the file → staged bands appear in the pending bar → user clicks Apply. Import appends parsed stages onto the row's `process` and maps the Preamp line onto row gain (`static/components/MatrixTab.js` `doImport`).
