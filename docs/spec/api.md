# REST API contract

This document owns the contract HQPTuner's REST API keeps with its clients.

## Field readings

`GET /api/config` returns the shared field reading directly, without a `data` wrapper:

```js
{
  generation,
  fields: { [key]: FieldReading }
}
```

Each setting's `FieldReading` has these members:

```js
{
  engine: { value, name, generation } | null,
  file: { value, generation } | null,
  staged: value | null,
  lane: "live" | "restore" | "form" | "matrix" | "volume",
  show: "engine" | "file",
  restarts: boolean,
  diverges: boolean,
  bounds: { min, max, step } | null
}
```

`engine.value` is the Engine's list index for an enumeration, with its Engine name in `name`; `engine` is null when the field is off chain or its Engine source has not been read. `file.value` retains the enum ID or the form's own domain, and `file` is null before that source has been read. Each store's `generation` records its acquisition generation; the response's `generation` is the lifecycle generation. The server does not assign a new acquisition stamp merely by serving a retained value.

`staged` is the pending buffer's value, or null when its destination store already holds that value. Reconciliation compares values in the destination store's domain. The latest change to a live setting applies immediately. Restart-class changes remain staged until Apply; a newer staged value replaces the older one, and Apply restarts the engine once.

`lane` names the field's write lane and `show` names the store used for display. `restarts` describes the field's own restart classification, independently of other edits in a staged batch. A restart mark never appears merely because another staged field needs a restart. `diverges` reports whether the Engine and File disagree, compared by the server in one domain; an Engine list index is never compared directly with a File enum ID. It is false when either store is unread, off chain or otherwise incomparable. Clients keep no lane table, compare no Engine indices with File enum IDs and derive no per-field restart or divergence policy.

`bounds` comes from the daemon's form or `VolumeRange`. Numeric fields always have `min`, `max` and `step`; only nonnumeric fields have null bounds. Numeric controls wait until the daemon has reported their limits. Last-known limits and invented limits are not substitutes for that evidence.

After a restart the backend re-reads File sources in the background. The page keeps showing the last known values until the fresh reading arrives, then replaces them; controls never show "unread" during this refresh. An older acquisition stamp still identifies the older acquisition, but does not by itself clear the displayed value. An accepted File write re-reads the affected sources. The refresh requirement is not satisfied by retaining old values without re-reading them.

Profiles, the active preset, device capabilities, daemon info, release, license and app version are read-only fields in the shared field register and are served through this same config reading. Their existing displays remain available; they have no separate metadata feed. The setting shape above may be extended for those registered read-only fields.

## Health

`GET /api/health` returns this object directly:

```js
{
  phase: "Down" | "Reachable" | "Ready" | "Alarm",
  generation,
  connected_at,
  credentials_ok: true | false | null,
  address_found: true | false | null
}
```

`phase` and `generation` belong to the lifecycle. `connected_at` is elapsed seconds since the standing connection became Reachable, or null without a connection; it is not a timestamp. `credentials_ok` reports learned credential acceptance or rejection, and is null without conclusive evidence. Credential rejection does not change the lifecycle phase.

`address_found` is false for name resolution failure or host/network unreachable, true after a successful TCP connection or an explicit connection refusal, and null before the first dial or after an inconclusive dial timeout. An authentication or application-handshake failure does not erase evidence that the host was found. Address and credential evidence reset when their target or credentials change. Health serialization performs no dial or independent phase inference.

## Pipeline staging

The client stages pipeline rows only. The server's pending buffer derives their count and owns rows and count as one edit. At 128 rows the page stops offering the add button; there is no refusal message. At the minimum it does not offer the remove button.

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

## Meter feed

The meters read the daemon's metering stream (`docs/spec/protocol.md` "Metering side channel") from `GET /api/meter/feed` as server-sent events, each an `event:` line naming it and a `data:` line of compact JSON. Two events are sent:

- `geometry`, sent ahead of the first `frame` it describes and again on every change: `nyquist` (float, Hz, the header's `bandwidth`), `channels` (int), `bins` (int, the header's `xformLength`), `rate` (int, Hz, the metering rate `(xformLength − 1) / transformTime` rounded to whole hertz). The metering rate is set by the daemon from the playback path, not the source rate.
- `frame`, one finished stride: `channels` (a list, one entry per channel: `peak` float dBFS max-held over the stride, `rms` float dBFS power-averaged over the stride, `bins` a base64 string of two bytes a bin, low byte first, each a count of 0.5 dB steps below full scale), `at` (int, samples at the geometry's `rate`, the sample the stride starts at, counted from the feed's reset) and `n` (int, samples at that rate, the samples the stride covers).

A consumer tests every `frame` in whole samples: one whose `at` is not the previous `frame`'s `at + n` is a break. A `frame` dropped from a full subscriber queue and a partial stride dropped at a geometry change each show up as one. Frames that arrive while no page is attached are not counted, so a reconnect carries no gap in its stamps and is a break by being a new connection.

## Volume

Beyond the persistent volume settings (`docs/spec/settings-classification.md` "Volume"), the running engine's current volume is real-time control on its own lane: `Volume` (4321) writes immediately, `VolumeRange` reports the live bounds and the `enabled` flag, and `State.volume` is the current level. HQPTuner exposes this as `GET/POST /api/volume` — a dedicated immediate-write path, never staged, never restarting. It is usable only when `VolumeRange enabled=1` (volume control active — not fixed volume, and an active stream); the UI grays the slider otherwise.
