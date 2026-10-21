# REST API contract

This document owns the contract HQPTuner's REST API keeps with its clients.

## Errors

Every refusal the REST API sends is `{"detail": ..., "code": ...}`. `detail` is FastAPI's field, a sentence or the live lane's per-field reasons dict, user-facing and reworded at will; nothing branches on it and no test asserts it (`docs/spec/testing.md` rule 9). `code` is the stable identifier a client acts on. The status is a property of the code, so a route names the cause and never picks a status.

| code | status | meaning |
|---|---|---|
| `no_credentials` | 503 | app built without hqplayerd management credentials |
| `credentials_refused` | 503 | a credential the app holds that hqplayerd refused |
| `no_http_client` | 503 | app built without HTTP management credentials for the 8088 config lane |
| `backup_failed` | 500 | the settings backup taken before a destructive restore could not be written |
| `not_loaded` | 503 | first poll of the daemon has not landed yet |
| `daemon_read_failed` | 502 | a read from hqplayerd's HTTP or 4321 interface failed |
| `daemon_log_absent` | 404 | hqplayerd answered its log page 404: it has no log to serve |
| `daemon_write_failed` | 502 | a write to hqplayerd failed |
| `daemon_unavailable` | 503 | 4321 not connected, timed out, or answered unparseably |
| `daemon_refused` | 503 | daemon answered `result="Error"` |
| `not_found` | 404 | no preset, profile or library under that name |
| `name_invalid` | 422 | a preset name the shared name rule rejects |
| `invalid_input` | 422 | a value a store or the config editor rejects |
| `nothing_staged` | 400 | apply with nothing to apply |
| `fields_unknown` | 422 | a field no lane accepts |
| `values_unknown` | 422 | `PUT /api/livepresets/{name}` body `values` names a value that is not an enumerated id of the record's chain, a value for a field not named in `fields`, a mode other than `pcm` or `sdm`, or a flag outside 0/1, or a matrix profile the daemon does not list |
| `stations_unknown` | 422 | a live snapshot save naming a station the preset store does not hold |
| `store_too_new` | 409 | a JSON store stamped by a newer HQPTuner |
| `state_unreadable` | 422 | a state upload that is not a state archive this build can read, or is past `HQPTUNER_STATE_MAX_BYTES` |
| `state_too_new` | 409 | a state upload carrying a store stamped by a newer HQPTuner |
| `store_corrupt` | 500 | a store file that exists but does not read as a JSON object |
| `store_unwritable` | 500 | a store read, write or delete the filesystem refused |
| `archive_unreadable` | 500 | an uploaded backup archive that is not a readable zip, or whose descriptions will not parse |
| `chain_unknown` | 409 | engine's active chain unknown, no live state to snapshot |
| `route_refused` | 409 | live lane refused the batch; `detail` names each field's reason |
| `route_unknown` | 404 | no route at that path |
| `method_not_allowed` | 405 | a real path, wrong method |
| `internal_error` | 500 | an exception no other handler maps; its traceback is in the log |

## Lane reports in a 200 body

Lane reports returned inside a 200 body carry the same vocabulary per item: a failed setter is `{"ok": false, "error": ..., "code": ...}`, its `code` the raised error's own (`daemon_unavailable`, `daemon_refused`, `invalid_input`). A preset save that fails is a refusal like load and delete, the save an apply asks for included.

## Connection

Neither credential field is empty by default, since both fall back to hqplayerd's published stock pair, so a field's emptiness does not say whether the install has been configured; a password that is not the stock default does. `GET /api/connection` reports it as `has_password`, so the connection panel can tell a stored credential from a defaulted one. A blank password field in that panel keeps whichever credential is in force and never clears one.

## Field readings

`GET /api/config` answers every field with its Engine value, its File value and its Staged value, each stamped, and the lane the field writes on (`docs/spec/settings-truth.md` rule 3). The body is `{"generation": int, "fields": {key: FieldReading}}`, replaced whole on each read and never merged. A `FieldReading` has these members:

- `engine`: `{"value", "name", "generation"}`, the Engine's last verified reading, `value` a list index, or `null` for a field off the loaded chain or not yet read.
- `file`: `{"value", "generation"}`, the File's reading, `value` an enum ID or the form's own domain, or `null`.
- `staged`: the pending buffer's value, or `null` when the stores already hold it (`core/pending.py`).
- `lane`: one of `live`, `restore`, `form`, `matrix`, `volume` (`docs/spec/settings-classification.md`).
- `show`: `engine` or `file`, the store the lane names for display; the client shows `reading[show]` and holds no lane table.
- `restarts`: true when applying the field restarts the engine, which drives the restart mark.
- `diverges`: true when the Engine and the File disagree, compared by the server in one domain; the client compares no list index with an enum ID.
- `bounds`: `{"min", "max", "step"}` from the daemon form's own limits or from `VolumeRange`, or `null` where the daemon gives none, and then the control is unbounded. A unit is display copy and is not served.

The client holds no per-field flag naming a store, a restart or a bound.

## Health

`GET /api/health` answers `{"phase", "generation", "connected_at", "credentials_ok"}`. `phase` is one of `Down`, `Reachable`, `Ready`, `Alarm` (`docs/spec/lifecycle.md`), and `generation` is the lifecycle policy's ordering token. `connected_at` stamps the current connection, and `credentials_ok` carries the management credentials' verdict, which does not move the phase. A client picks the page's one phase from `phase` and holds no reachable, ready or connected flag of its own.

## Meter feed

The meters read the daemon's metering stream (`docs/spec/protocol.md` "Metering side channel") from `GET /api/meter/feed` as server-sent events, each an `event:` line naming it and a `data:` line of compact JSON. Two events are sent:

- `geometry`, sent ahead of the first `frame` it describes and again on every change: `nyquist` (float, Hz, the header's `bandwidth`), `channels` (int), `bins` (int, the header's `xformLength`), `rate` (int, Hz, the metering rate `(xformLength − 1) / transformTime` rounded to whole hertz). The metering rate is set by the daemon from the playback path, not the source rate.
- `frame`, one finished stride: `channels` (a list, one entry per channel: `peak` float dBFS max-held over the stride, `rms` float dBFS power-averaged over the stride, `bins` a base64 string of two bytes a bin, low byte first, each a count of 0.5 dB steps below full scale), `at` (int, samples at the geometry's `rate`, the sample the stride starts at, counted from the feed's reset) and `n` (int, samples at that rate, the samples the stride covers).

A consumer tests every `frame` in whole samples: one whose `at` is not the previous `frame`'s `at + n` is a break. A `frame` dropped from a full subscriber queue and a partial stride dropped at a geometry change each show up as one. Frames that arrive while no page is attached are not counted, so a reconnect carries no gap in its stamps and is a break by being a new connection.

## Volume

Beyond the persistent volume settings (`docs/spec/settings-classification.md` "Volume"), the running engine's current volume is real-time control on its own lane: `Volume` (4321) writes immediately, `VolumeRange` reports the live bounds and the `enabled` flag, and `State.volume` is the current level. HQPTuner exposes this as `GET/POST /api/volume` — a dedicated immediate-write path, never staged, never restarting. It is usable only when `VolumeRange enabled=1` (volume control active — not fixed volume, and an active stream); the UI grays the slider otherwise.
