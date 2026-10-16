# HQPTuner-owned state

This document owns the state HQPTuner keeps that the daemon does not.

## Preset store

Presets are full-config XML snapshots in a directory HQPTuner owns, driven through one reliable daemon primitive, `POST /restore` onto `[default]`.

hqplayerd's named-profile subsystem cannot serve this: `POST /restore` drops the daemon to `[default]` and ignores the named working member, `profile/save` to an existing name silently no-ops, and `/backup` empties after a profile load. The daemon's own `data/cfgs/<name>.xml` files are kept **mirrored** so its native web UI stays populated, but they are never HQPTuner's load/save path. Matrix profiles are separate and switch cleanly live, via 4321 `MatrixSetProfile` (`docs/spec/protocol.md` "Matrix profile commands").

Preset CRUD is not a 4321 Control API operation for HQPTuner: it goes through the port-8088 HTTP interface under Digest auth. The 4321 `ConfigurationLoad` crypto path (auth-gated by `SessionAuthentication`) is **not used**: the daemon rejects self-generated client keys, and the HTTP route does the same job with ordinary Digest auth.

## Preset operations

Five operations, all built on that one primitive:

- **Load**: restore the preset's config as `hqplayerd.xml`, so it runs on `[default]`, and mirror it to `data/cfgs/<name>.xml`. Never `profile/load`.
- **Save / Save-as-new**: snapshot the running config into the store, and nothing else: a save never restores. Its `data/cfgs/<name>.xml` mirror rides the next restore that happens anyway, the apply's own when the save follows one. Never `profile/save`. Auto-pilot's state is recorded under the preset's name in `state/autopilot.json` rather than in the XML, because hqplayerd's config carries no junk-filter field for it to sit beside; a load restores it, and auto-pilot settles the filter itself from the next tick.
- **Delete**: remove from the store, plus `profile/delete` for the daemon's mirror (the one native profile route that works cleanly). The preset's listening mode (speakers or headphones) goes with it, from `state/matrixmodes.json`: that store is keyed by preset name, so an entry left behind is read by nothing and would be inherited by the next preset saved under the same name.
- **Ephemeral Apply**: edit the running config and restore it, touching neither store nor snapshot, so the change reverts on the next preset load. The user experiments freely without spending a preset.
- **Migration**: on first connect, import the daemon's existing `data/cfgs/*.xml` into the store. Idempotent; store presets win on a name collision; the active pointer is seeded from the daemon's reported active config.

The daemon's own profile list and active profile are read from 4321 `ConfigurationList` / `ConfigurationGet` (unauthenticated) or `GET /config`.

## Live snapshots

A config preset is a whole `hqplayerd.xml` applied by restarting the daemon. A live snapshot is a handful of enum IDs applied through the live lane, so it never writes the config file and never restarts anything. The daemon never sees them: one JSON file HQPTuner owns, with the same name rule as presets. The one exception is the matrix profile, which a snapshot holds as `matrix_profile` and an apply switches through the matrix lane's `MatrixSetProfile` after the live settings land, refusing a name the daemon does not list.

**Snapshots belong to a station.** A station is a config preset, or `""`, the unnamed default loaded while none is. The file is one book, `{"schema": 6, "stations": {station: {name: record}}}`. `GET /api/livepresets` answers the loaded station, its snapshots as `presets`, and the whole book as `stations`, every station the preset store holds with `""` first.

A `PUT` writes the one record under each station its body's `stations` names, the loaded one when it names none; a station the preset store does not hold refuses the whole save (`stations_unknown`). Apply and delete take `?station=`, the loaded one when absent. Deleting a config preset drops its station's snapshots. A file in the flat layout earlier schemas wrote reads with each record under every station and under `""`.

A record holds output **mode**, both chain filters, dither/modulator and adaptive volume, each as value plus display name at save time; values apply and names only render, because engine-built enumerations shift under a stored preset. A record may carry a subset of the settings: the `PUT` body names the kept keys, and any chain-scoped key forces `mode` in. Playback volume is excluded: restoring a level hands the listener a loudness jump they never asked for.

**The junk filter and its auto-pilot are never stored**: the filter follows the material, so a save naming `junk_filter` or `autopilot` is refused (`fields_unknown`) and an apply leaves both where they are. A record stored under schema 3 or earlier loses its `junk_filter` and its `autopilot` on read.

Mode is included, which is why apply sets mode alone and then the rest, rather than one batch. **Applying a snapshot saved on the other chain is not a conflict to refuse**: switching is the request. A snapshot whose stored ID the running enumerations no longer offer refuses the whole snapshot, naming the field. A `rate` stored by older versions is ignored on apply.

## JSON stores are schema-stamped

Every JSON store follows one pattern: a store stamped by a newer HQPTuner is refused (`store_too_new`), and an unstamped one is adopted on the next write.

## Narrowing persists for the install

The narrowing facets persist per install (`state/narrowing.json`, `GET`/`PUT /api/narrowing`), the way stars and live snapshots do: the narrowing console has no daemon field behind it, so there is nothing to reconcile with and nowhere else it can live. Nothing polls; last write wins across browsers.

Two asymmetries are deliberate. A **write** refuses an unknown or out-of-domain facet, because the client is our own frontend and anything else is a bug, while a **read** degrades any damaged entry to that facet's default, so a hand-edited file costs the narrowing rather than the console. A **refused write leaves the facet where the user put it** (unlike a refused star, which reverts), because narrowing changes nothing but what the menu offers. The favorites-only switch is not stored; it stays session state beside the stars.

## Where stores live

In a frozen build the shipped `data/*.json` travels inside the bundle and is read from there, while every store this document names (`state/*.json`, `presets/`, `backups/`) sits under the platform's per-user data directory, since the installed program is not the user's to write. The Linux package's systemd unit points that directory at `/var/lib/hqptuner`. A checkout and the container keep the paths written here.

## The state archive

`GET /api/state-export` zips every store, the connection record with its password blanked, and the logs. `POST /api/state-import` takes that zip back. Each store the archive carries **replaces** this install's copy; a store it lacks is left alone. The connection record, `backups/` and the logs in an archive are never imported: the password was blanked, and the host and login that work are the ones already here.

The whole archive is checked before anything is written, upload and unpacked stores each bounded by `HQPTUNER_STATE_MAX_BYTES`, and a refusal (`state_unreadable`, or `state_too_new` for a store stamped by a newer HQPTuner) changes nothing. The stores an import replaces are first saved, alone, to `backups/pre-import-state.zip`, so an import can be undone by importing that file and the backup never carries an earlier one.

An import never contacts the daemon. Presets land in the store only, and the daemon's `data/cfgs` mirror catches up on its next restore. The active pointer is cleared. An archive whose live snapshots use the flat layout reads with each record under every station and under `""`.

## Event log

**Every durable write records what it was handed, and the volume trace records what was read.** Append-only JSON Lines, off unless `HQPTUNER_DEBUG_LOG` names a path; the disabled log's emitters are no-ops, so no call site ever guards on whether it is enabled.

**The success path is the point.** Staged edits live in a server-side buffer, and the apply that drains it clears it in the same request (`POST /api/config/apply`), so a write that landed wrong has no evidence left unless it was recorded as it happened. Failure-only logging answers nothing here.

- **One instance.** Each instance resumes `seq` from the file on construction, so a second copy reissues numbers the first already used. A sequence that repeats is worse than none: it reads authoritative.
- **Emitters are typed per event, never free-form.** The vocabulary is the contract, and it is what tests assert; log *text* stays off-limits per `docs/spec/testing.md` rule 1. A new durable write path gets an emitter or reuses one; a silent write is a defect.
- **Values are captured whole to 128 KB**, so a payload is recoverable from the log rather than merely described by it; larger ones truncate, and the record carries `truncated` plus `full_digests` keyed by dotted field path. The file rolls to `<path>.1` past its size cap.
- **`password` / `secret` / `token` never reach a record**, at any depth.
- **The volume trace is the one reader in the vocabulary.** Volume rides two mechanisms, the config file's `defaults_volume` the daemon boots on and the live 4321 value, and two write paths reach the second, so `volume.write` names which path and `volume.observe` records a checkpoint's reading. Every observation carries `last_write`, the level HQPTuner most recently asked for: a reading that has moved to something else is a move HQPTuner did not make. The trace's own entry points suppress `OSError` around the emitter, because two checkpoints sit inside the poll tick and an unwritable log path would otherwise stall every reading in the app.
- **No UI, deliberately.** It is an operator's tool: set on the container, read with `jq`, or over `GET /api/audit`, which exists only while the variable is set.
