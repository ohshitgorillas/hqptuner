# HQPTuner — architecture and normative rules

**This document carries rules, not inventories.** Anything enumerable points at the artifact that owns it, because prose is not checked by `make check` and the artifact is.

**Section numbers are the citation contract.** Code cites this file as `architecture §4.3`; `scripts/gates/check_doc_refs.py` fails the build when a cited number names no section. Renumber a section and update its citers in the same commit.

## 1. Scope

HQPTuner is a configuration interface for HQPlayer Embedded. It replaces the stock configuration, matrix and speaker pages for day-to-day settings work.

**Non-goals:** playback, library and media control of any kind; a standalone convolution-engine page. Convolution *within* matrix pipelines is in scope, and so is matrix pipeline editing; its design of record is `docs/matrix-spec.md`.

## 2. Engine interfaces

### 2.1 Control API lane (TCP 4321)

XML messages, unauthenticated. Carries the runtime-switchable settings (filters, dither/modulator, mode, rate, matrix profile) and all status and metering, with no restart. Changes are **memory-only, never persisted** (§3.6). Wire reference: `docs/protocol.md`.

A response document is bounded twice. Each read waits at most the request timeout, and a document still incomplete six request timeouts after its first chunk arrives is given up on as no answer, naming the total's seconds, with the connection dropped as for any timeout. A document over 4 MiB without ending is refused.

### 2.2 HTTP lane and the restore path (TCP 8088)

Digest auth. `GET /config` is the read side for persistent settings and their constraints. Persistent **writes** ride the **restore lane**: fetch `/backup`, surgically edit the field in the config XML, push it with `POST /restore` (`scope=system`), on which the daemon self-restarts in about 5.6 s.

**Every 8088 exchange is bounded.** A whole exchange, the Digest challenge round trip and the body together, ends at a total deadline of six of its request's timeouts (60 s at the default 10 s), on the app's clock (`noanswer.under_total`, carried by `HttpOptions.deadline`); httpx's own timeout restarts at every read and stays beside it. A reply is read up to a ceiling set by its path, the 401 challenge body included, and a reply over it is refused: 256 KiB for the form pages and every write answer, 32 MiB for `/backup/settings.zip` (`noanswer.reply_ceiling`). The request asks for an identity encoding and a reply in any other is refused, because a compressed body has no size until it is decoded.

**There is no `POST /config`.** `/config` is GET-only. The genuine form POSTs are `POST /matrix`, `POST /matrix/{load,save,delete}` and `POST /speakers` (about 3 s engine reload each), plus `POST /config/profile/delete` for removing a preset mirror. Per-field lane assignments and the evidence base live in `docs/settings-classification.md`.

### 2.3 Discovery is not a lane

Discovery (UDP 4321 multicast, `239.192.0.199`) is unauthenticated and read-only, carries no setting and no status, and runs on demand before a lane exists, to find out where to point one: `hqptuner/engine/discovery.py`, surfaced as `GET /api/discover`. Wire reference: `docs/protocol.md` §2. The app also asks one address itself at startup, the container-host alias, where no record and no host variable have named a daemon.

### 2.4 Credentials

HQPTuner takes the HQPlayer management username and password from `HQPTUNER_HQP_USERNAME` / `HQPTUNER_HQP_PASSWORD`, or from the install's saved connection record when the variables are unset or empty (`hqptuner/core/connection.py`; `POST /api/connection` rebuilds the 8088 client in place rather than waiting for a restart). It uses them for HTTP Digest auth against 8088 (realm `com.signalyst.hqplayer.embedded`) and holds the credential server-side. HQPTuner requires both lanes: with the credential missing or refused, or the 8088 page or the daemon down, the app does not work, and no feature runs over 4321 alone. The 4321 `SessionAuthentication` crypto handshake is **not** used, and the daemon rejects self-generated client keys anyway (`docs/protocol.md` §3.5–§3.6).

An install whose username or password is empty has no 8088 lane, so `ready` never turns true: the status pill reads Unreachable and the app does not work, the same reading a refused credential gets. Neither field is empty by default: both fall back to hqplayerd's published stock pair (`config.STOCK_CREDENTIAL`), so an install that has configured nothing connects outright against a daemon still on that pair.

**A field's emptiness therefore does not say whether the install has been configured; `Config.hqp_password_chosen` does**: a password that is not the stock default. `GET /api/connection` reports it as `has_password`, so the connection panel can tell a stored credential from a defaulted one. A blank password field in that panel keeps whichever credential is in force and never clears one.

**A browser logs in once, with the HQPlayer management pair, and the login is checked against hqplayerd.** `POST /api/login` (`hqptuner/api/login.py`) asks the daemon at the host the login names, or the host in force, whether the typed username and password are accepted (`hqptuner/conf/httpauth.py` `check_pair`, one Digest read of `/config`), and answers 401 `login_refused`, 503 `login_not_answered` or 200 with the login cookie. It fills no field from the pair HQPTuner holds: a blank password is checked as blank. The cookie is `HttpOnly`, `SameSite=Strict`, `Path=/` and not `Secure`, because every package serves plain HTTP. Its value is a token only HQPTuner can mint (`hqptuner/core/login.py`): an HMAC over the install's secret and a fingerprint of the username and password in force, with the login's kind, its issue time and a nonce. A change of username or password therefore ends every login made under the old pair. The choice "save password" (`remember` true) sets a cookie with an expiry of 30 days, which the server also enforces from the issue time inside the token; "log in every time" sets a session cookie, which the server refuses after 24 hours. The secret is random bytes held in memory and written beside the connection record only by a "save password" login, so that login survives a restart; a "log in every time" login writes no file. `remember` on a login decides that browser's cookie alone and never the stored connection record. A login whose pair or host differs from the one in force applies them as a Connection-panel save does, except that a host, username or password the environment pins (`HQPTUNER_HQP_HOST`, `HQPTUNER_HQP_USERNAME`, `HQPTUNER_HQP_PASSWORD`, an empty value counting as unpinned) cannot differ: such a login is refused 403 `login_values_pinned` before any check is sent, any cookie is set or any record is written.

**Every `/api` route but `/api/health` and `/api/login` needs a valid login cookie, and the gate is installed once.** `hqptuner/api/gate.py` is a pure ASGI wrapper added in `create_app`, so it covers every route registered on the app, the conditional audit router, an unknown `/api` path and any route added later; it passes the meter feed's event stream through unchanged. A request without a valid cookie is answered 401 `login_required` in the shared error shape. There is no exemption for a loopback caller: a local browser that never logged in is refused like any LAN peer. Paths outside `/api`, the page's own files, are not gated. A cookie is valid when its token verifies for the pair in force at the instant the app's clock reads, so a login ends with its lifetime, with a change of the pair, and with a restart that leaves no password. A Connection-panel save that changes the username or password sets a fresh cookie for the new pair on its own response, keeping the kind and issue time of the login it replaces, so the browser that saved stays logged in and every other browser logged in under the old pair does not.

**A state-changing request from another website is refused, whatever cookie it carries.** `hqptuner/api/crosssite.py` is a second pure ASGI wrapper added in `create_app` after the gate, so it runs first. It covers every POST, PUT, PATCH and DELETE to `/api` or under it, the login route included, and answers 403 `cross_site_refused` when `Sec-Fetch-Site` is present and is neither `same-origin` nor `none`, or when `Origin` is present and is `null` or names a host and port other than the request's own `Host` header. It compares a request with itself, so it needs no configured host list. A request that carries neither header (curl, the dev scripts, the packaged smokes) passes it and meets the gate. GET and HEAD are not checked. The cookie's `SameSite=Strict` is the other half: a browser does not send the login on a cross-site request in the first place. `upload()` in `static/lib/api.js` sends no `Content-Type` of its own and carries no token header.

**While `ConnectionManager.ready` is false, every engine write is refused by one gate.** `hqptuner/api/readygate.py` is a pure ASGI wrapper installed in `create_app` before `LoginGate`, so it runs after the login gate and an unauthenticated write answers `login_required`. It reads `ready` and no other flag. It holds every POST, PUT, PATCH and DELETE to `/api` or under it, so a write route added later is held without a change to the gate, except the open set: `POST /api/login`, `POST /api/connection`, `POST /api/config/stage`, `DELETE /api/config/pending`, `PUT /api/favorites`, `PUT /api/descriptions`, `PUT /api/narrowing`, `PUT /api/matrixmodes`, `PUT` and `DELETE` of `/api/livepresets/{name}`, and `POST /api/autosave`. These write HQPTuner's own stores or are the way back to a working install. Paths match exactly. GET and HEAD, and every path outside `/api`, pass: the 4321 reads are attempted and bounded, and nothing relies on them. A held request is answered with the refusal of the first cause that applies, in the shared error shape and not passed on: 503 `no_http_client` or 503 `no_credentials` when the 8088 pair is missing or refused, so the fix is named before a symptom; 503 `daemon_unavailable` when the control lane is not connected or the 8088 lane has not yet answered; 502 `daemon_read_failed` when the last read of `/config` failed. The window in which HQPTuner's own apply has the daemon restarting is not exempt. Two writes start in the server and so never meet the wrapper: auto-pilot's junk-filter move and the LIVE re-assert on a chain change. Both send nothing while `ready` is false; auto-pilot acts on the first tick after it returns and the re-assert sends the memory it kept on the first poll after it returns.

## 3. Reading engine truth

### 3.1 The running engine is enumeration authority

Filter and shaper names and list ordering change between HQPlayer versions. The running engine's enumeration queries (`GetModes`, `GetFilters`, `GetShapers`, `GetRates`, `GetJunkFilters`) are the sole runtime authority for names, IDs and ordering. Static `data/*.json` joins **by name** and never overrides live data; an engine entry with no metadata match still renders, by name only. Never ship a constant where an engine-reported value belongs.

### 3.2 Never mix index and ID domains

`Set*` and `State` speak list **index**; `hqplayerd.xml` stores enum **ID**. Translating between the lanes requires the live lists.

### 3.3 Enumerations are mode-relative; never pre-capture

The engine returns only the current mode's lists (SDM lists in SDM, PCM lists in PCM), and they differ wholesale, so indices shift between modes. Re-run the enumeration queries on every mode switch rather than filtering a cached list; never flip modes to pre-capture the other one. Mode index 0 (`[source]`) keeps the current lists.

### 3.4 Static facets fill in for the inactive mode

The live enumeration covers only the active mode, so filters exclusive to the inactive mode would carry no facets and bypass narrowing. Quality, focus, apodizing and ratio are transcribed into `data/filters.json` and consumed by `store/narrow/facets.js` as the **fallback for filters the live enumeration omits**. Live stays sole authority for the active mode.

### 3.5 Length and adaptive are overlay-first

The wire carries no length or adaptive signal, so these two facets are the exception to live-first: a `length` token or `adaptive` bool on a filter's `data/filters.json` row wins over the name-token rules, which remain the fallback for names the overlay does not reach. Enumeration authority is untouched: the overlay still joins by name and decides nothing about which filters exist.

### 3.6 Live and file diverge; surface it

hqplayerd never writes Control API changes to `hqplayerd.xml`, not while running and not at shutdown. The running engine can differ from the file indefinitely, and does in normal use. Read both lanes and show the divergence; never assume it away.

### 3.7 `result="OK"` is not proof of application

Always verify by `State` readback.

## 4. Writing to the engine

### 4.1 A request that fails after its bytes went out drops the connection

The daemon answers every command it accepts, unknown ones included (`protocol.md` §4), so a reply given up on is a reply still to come, and left on an open socket it becomes the answer the *next* command reads. Nothing downstream can catch that: `set_command` checks the root element's `result` and never which element it is, so a stale `<Volume result="OK"/>` passes as success for a `MatrixSetProfile` that was never acknowledged, and `_attrs` returns the wrong document's attributes into `readings`.

So `ControlClient.request` closes its own connection on a read timeout, a socket error or a frame that will not parse, and the poll loop reconnects. A `CommandError` (`result="Error"`) keeps the connection: that reply is complete and correctly paired. At the batch level, fields behind a stalled setter in one `apply_live` report `daemon_unavailable` instead of being written over a suspect connection, while fields behind a *refused* one still apply.

### 4.2 Live vs restart split is all-or-nothing per batch

Every control is classified live or restart-required (tagging: `docs/settings-classification.md`), and the pending-changes bar reports the split before Apply. One restart-required field sends the whole staged batch down the restore lane (`lanes/live/routing.split_live`): the restart happens anyway, and a value applied live never reaches the config file the restart boots from, so a split batch would revert its own live half.

Chain fields a staged apply does route live are recorded per chain (`lanes/live/lane.remember_routed`), the same record LIVE keeps, so auto-save and chain re-entry report and re-assert them while the chain is dormant.

### 4.3 Two write paths share no staging state

The tabs view stages into the shared `PendingStore`, and Apply flushes **everything** in it (`api/routes/pending.py`, apply route in `api/routes/apply.py`). LIVE writes one batch on the spot, readback-verified, and writes through neither the pending store nor the 8088 lane, so it can never restart the daemon (`POST /api/config/live` → `lanes/live/lane.apply_now`). The rule binds in both directions: a LIVE control routed through stage and apply would apply edits the user staged elsewhere and never asked for.

### 4.4 Mode rides alone, then the rest re-resolves

`SetMode` swaps the enumerations the remaining indices were resolved against, so `routing._mode_blocks_batch` refuses a batch carrying mode and chain fields together. Applying mode alone, re-enumerating, then resolving the rest against the post-switch lists is legal, and is what `lane.apply_preset` does; `apply_now` runs the same sequence after any verified mode write (`reassert_chain`). The refusal is about one batch, never about what the engine can be told.

**A live mode write always goes through that re-enumerating path, whatever else is staged with it** (`lane._mode_apart`). A mode routed as an ordinary edit leaves the enumeration cache holding the departed mode's lists. Because it also refreshes `mgr.state`, it consumes the mode transition `core/loader.poll` watches to re-enumerate on its own, so the next apply resolves a filter's enum ID against the wrong list and the engine takes a different filter than the one named. Every live-routing caller runs `lane.refresh_after_live` for the same reason.

### 4.5 Matrix edits belong to the active matrix profile

Post-process chain and pipeline rows are a property of a matrix context, not of the config. An apply never moves the listener off the profile they were on.

### 4.6 No idle gating

HQPTuner never refuses a user action because the daemon is playing; see the binding rule in `CLAUDE.md`.

### 4.7 A staged value is one its page offers, and is written escaped

A staged value outside the choices its own page lists (a select's options, a checkbox's `0` and `1`, with `volume_fixed` also taking `2`) is refused at stage and at live, before anything is staged, held or written; a number or text input, or a field the page does not render, is not checked this way. Every value HQPTuner writes into `hqplayerd.xml` is escaped as an XML attribute value and read back unescaped. A staged `http` value, a matrix row's `process` string or a profile name holding a character the file cannot carry back is refused before anything is written: a control character (below U+0020, tab, line feed and carriage return included), a surrogate, U+FFFE or U+FFFF. XML cannot hold the surrogates, the two noncharacters or the control characters other than those three, and the daemon's parser reads those three back as spaces.

## 5. HQPTuner-owned state

### 5.1 HQPTuner owns its preset store

Presets are full-config XML snapshots in a directory HQPTuner owns (`hqptuner/presets/store/presets.py`), driven through one reliable daemon primitive, `POST /restore` onto `[default]`.

hqplayerd's named-profile subsystem cannot serve this: `POST /restore` drops the daemon to `[default]` and ignores the named working member, `profile/save` to an existing name silently no-ops, and `/backup` empties after a profile load. The daemon's own `data/cfgs/<name>.xml` files are kept **mirrored** so its native web UI stays populated, but they are never HQPTuner's load/save path. Matrix profiles are separate and switch cleanly live, via 4321 `MatrixSetProfile` (`docs/matrix-spec.md`).

### 5.2 Preset operations

Five operations, all built on that one primitive (`presets/store/presets.py` plus `presets/presetops.py`):

- **Load**: restore the preset's config as `hqplayerd.xml`, so it runs on `[default]`, and mirror it to `data/cfgs/<name>.xml`. Never `profile/load`.
- **Save / Save-as-new**: snapshot the running config into the store *and* mirror it to `data/cfgs/<name>.xml` via restore. Never `profile/save`. Auto-pilot's state is recorded under the preset's name in `state/autopilot.json` rather than in the XML, because hqplayerd's config carries no junk-filter field for it to sit beside; a load restores it, and auto-pilot settles the filter itself from the next tick.
- **Delete**: remove from the store, plus `profile/delete` for the daemon's mirror (the one native profile route that works cleanly). The preset's Matrix-tab mode goes with it, from `state/matrixmodes.json`: that store is keyed by preset name, so an entry left behind is read by nothing and would be inherited by the next preset saved under the same name.
- **Ephemeral Apply**: edit the running config and restore it, touching neither store nor snapshot, so the change reverts on the next preset load. The user experiments freely without spending a preset.
- **Migration**: on first connect, import the daemon's existing `data/cfgs/*.xml` into the store. Idempotent; store presets win on a name collision; the active pointer is seeded from the daemon's reported active config.

### 5.3 Live snapshots are a separate store

A config preset is a whole `hqplayerd.xml` applied by restarting the daemon. A live snapshot is a handful of enum IDs applied through the LIVE lane, so it never writes the config file and never restarts anything (`hqptuner/presets/store/live.py`, routes in `api/routes/livepreset.py`). The daemon never sees them: one JSON file HQPTuner owns, with the same name rule as presets.

A record holds output **mode**, both chain filters, dither/modulator, junk filter and adaptive volume, each as value plus display name at save time; values apply and names only render, because engine-built enumerations shift under a stored preset. Auto-pilot's state sits beside them, outside `fields`, since it is not a live-lane field; the route applies it after the lane, and `autopilot: null` leaves the switch alone. A record may carry a subset of the settings: the `PUT` body names the kept keys, and any chain-scoped key forces `mode` in. Playback volume is excluded: restoring a level hands the listener a loudness jump they never asked for.

Mode is included, which is why apply is `lane.apply_preset` rather than one batch (§4.4). **Applying a snapshot saved on the other chain is not a conflict to refuse**: switching is the request. A snapshot whose stored ID the running enumerations no longer offer refuses the whole snapshot, naming the field. A `rate` stored by older versions is ignored on apply.

### 5.4 JSON stores are schema-stamped

Every JSON store under `presets/store/` follows the `store/presets.py` pattern (reader in `presets/store/jsonfile.py`): a store stamped by a newer HQPTuner is refused (`store_too_new`), and an unstamped one is adopted on the next write.

### 5.5 Narrowing persists for the install

The narrowing facets persist per install (`state/narrowing.json`, `presets/store/narrowing.py`, `GET`/`PUT /api/narrowing`), the way stars and live snapshots do: the bar has no daemon field behind it, so there is nothing to reconcile with and nowhere else it can live. Nothing polls; last write wins across browsers.

Two asymmetries are deliberate. A **write** refuses an unknown or out-of-domain facet, because the client is our own frontend and anything else is a bug, while a **read** degrades any damaged entry to that facet's default, so a hand-edited file costs the narrowing rather than the bar. A **refused write leaves the facet where the user put it** (unlike a refused star, which reverts), because narrowing changes nothing but what the menu offers. The favorites-only switch is not stored; it stays session state beside the stars.

### 5.6 Where stores live

In a frozen build the shipped `data/*.json` travels inside the bundle and is read from there, while every store this document names (`state/*.json`, `presets/`, `backups/`) sits under the platform's per-user data directory, since the installed program is not the user's to write (`hqptuner/paths.py`). The Linux package's systemd unit points that directory at `/var/lib/hqptuner` (`packaging/linux/hqptuner.service`). A checkout and the container keep the paths written here.

## 6. Static metadata

### 6.1 Metadata joins live enumerations by name

Shipped as JSON, extracted from the HQPlayer manual, joined against the live enumerations **by name** (§3.1):

- `data/filters.json`: prose, genre, notes, plus the facet fallback. Join rules are documented in the file's own `_join_rules` field: exact name → aliases → `-2s` suffix strip with the two-stage note appended → render the engine name bare.
- `data/shapers.json`: dither/modulator prose, order, type, and the minimum and optimal rate constraints that drive modulator graying and both families' conflict alerts. Sole source for those constraints.
- `data/settings.json`: per-control tooltip prose, with a `source` field citing manual §, readme §, or `hqptuner` for UI-native text.

### 6.2 Filter prose is chain-dependent

An entry flagged `sdm_two_stage` picks up the shared `sdm_two_stage_note` only on the SDM chain. Both filter chains render at once (four persistent dropdowns), so the chain is the control's own `desc` (`filter` vs `sdm_filter` in `store/schema.js`), never the live output mode, which says nothing about which dropdown is being read. This is unrelated to `two_stage_note`, which is keyed by the `-2s` name.

### 6.3 Metadata coverage is gated

`scripts/gates/check_metadata.py`: the shipped files load through `StaticMetadata`, every shaper and filter in the `engine-enums.json` snapshot has a row (filters through the join rules), and every exposed control has its prose. The offline suite never reads the shipped files; it runs on `tests/support/fixtures/metadata_min` (`docs/testing.md` rule 9).

## 7. UI

### 7.1 The control surface is owned by three artifacts

The control set is **not enumerated in prose**. Three checked artifacts own it:

- `hqptuner/static/store/schema.js`: every control, its lane, its widget, its `grayWhen` disclosure logic. The glue between the control surface and the two lanes.
- `hqptuner/data/settings.json`: tooltip prose for every exposed control, plus a `_comment` block listing settings with upstream prose HQPTuner deliberately does not expose.
- `docs/settings-classification.md`: every control tagged live / http / file, with empirical evidence per field.

### 7.2 Tabs

Tabs are **Output · Volume · Resampling · DSP · System**; the registry `static/components/tabs/index.js` is the authority, not this list. Loudness lives on Volume; crossfeed and matrix pipelines on DSP.

### 7.3 LIVE is a mode, not a tab

A header switch (`store/prefs.liveMode`) replaces the whole tabbed body with one page of the settings the running engine can change in place (`static/components/live/View.js`, fed by `store/live/model.js`). No staging and no Apply: every control writes on change and shows what the engine reported back, not what was requested. The page is not a second control surface: each control names its `schema.js` key and so carries the same label, note and per-selection prose as its tab twin. Both filter chains render at once; edits to the chain the engine has not loaded are held per chain and applied when it loads, which is also how auto mode before playback works.

### 7.4 METER is a mode, not a tab

A header switch on the mini spectrum (`store/prefs.meterMode`, not persisted) replaces the tab bar and tab body with the METER page (`static/components/meter/View.js`); the pending bar stays. LIVE and METER exclude each other: each setter, turning its mode on, turns the other off.

### 7.5 Signal path order

The signal path bar shows the live chain in physical processing order:

```
source → matrix → Bauer crossfeed → conversion stages → DAC correction → output rate
```

Crossfeed is input-side and operates on the source-rate signal. **DAC correction is output-rate-dependent**, so it runs *after* the conversion stages and cannot precede the filter. Disabled post-process stages are omitted from the bar entirely. Implementation and data sources: `hqptuner/static/components/SignalPath.js`.

### 7.6 Graying reacts to staged values

Disclosure follows staged values, not applied ones, so it updates before Apply.

### 7.7 Disclosure by mode and backend

- The per-family rate control grays for the inactive mode on the tabs view; Auto ungrays both.
- **Transport params are per-backend, not mode-gated.** The Embedded `/config` form scopes device / DAC bits / DoP / 48k-DSD / buffer per backend (`alsa_*` vs `net_*`, independent values). "DAC bits grays in SDM / DoP grays in PCM" belongs to the *desktop* app and does not apply here. IPv6 is Network-only.
- ALSA / Network sections **collapse** by backend rather than gray; every field still persists, because the daemon rejects a partial form.
- FFT filter length has no card of its own: it renders inside a chain card only while that chain's OWN filter slots select an FFT-family filter, so auto mode with FFT on both sides shows it in both cards, and it is absent everywhere else. The daemon carries one `fft_size` field, so the two renders are two views of one value.
- E-core allocation is meaningful only on hybrid CPUs and carries a muted "hybrid CPUs only" caption.
- Graying carries no caption where a reason string would reflow the row on a mode change (`quietGray`).

### 7.8 Mode switch coherence

Flipping PCM ↔ SDM swaps the rate option set and the shaper card (label and option list) in the same interaction.

### 7.9 Rate selection lives on the Output tab

LIVE carries no rate control: **`SetRate` is never sent**. It writes the FIXED rate slot (`samplerate`/`bitrate`), and an exact rate there overrides automatic base-rate selection, so 44.1k material goes out at a 48k base and the engine refuses the filter. The rate limits (`lanes/live/chain.RATE_LIMIT_FIELD`, always a tier's 48k member under forced `auto_family`) are config fields with no live route, so rate selection lives on the Output tab, where an apply is expected to restart the daemon. The loaded chain takes filter and shaper edits live (`active_chain`, resolved from `Status.active_rate`).

### 7.10 Rate-aware shaper graying and conflict alerts

SDM modulator options whose floor is above the selected SDM rate are grayed **with a short reason** (e.g. "needs ≥ 40.96 MHz"), never hidden: visible-but-disabled teaches the constraint. The rule is the same in both views, off one schema field (`rateGray`), applied by `components/widgets/Field.js` on the tabs and `store/live/chains.js` on LIVE. Rate constraints come from static metadata; the engine ships shaper names only.

**PCM dithers gray nowhere**: their floors are the manual's recommendations, and a dither below its floor still produces output, so every dither stays selectable at every rate. **Rates never gray by shaper**, in either family: that would lock the user into the higher rate, a worse failure than the one it fixes.

The order graying cannot close (rate dropped under an already-selected shaper) is reported as an alert-strip row instead (`store/alerts/shaperfit.js`): `crit` for an SDM modulator below its floor, which stops output outright, `warn` for a PCM dither below its floor, which does not. One row per family, scoped to the family that will produce output (the loaded chain, else the mode, both in `[source]`), with thresholds named as tiers rounded up rather than as frequencies.

### 7.11 Device-aware rate and mode graying

Rate tiers and the SDM mode gray against what the selected output device announced it can carry. The `/config` form offers every rate whatever device is selected, and the Control API has no capability command. `GetRates` lists only the rates the device supports on hqplayerd 6.2.1 and later (protocol.md §SetRate / GetRates), but the form the Output tab is built from does not, and on the supported 6.0.x to 6.2.0 releases neither does, so the graying applies on every supported release. Its source is the device announcement in the daemon's own log, read over the same `GET /log` lane as the System tab (`hqptuner/engine/devicecaps.py`, frontend in `store/narrow/devicecaps.js`). A DSD tier the device did not announce natively is still reachable when DoP is on and the device announced its carrier rate, the DSD rate ÷ 16 (DoP v1.1).

**Uncertainty narrows nothing**: no announcement, an announcement naming a device other than the staged one, or the `combo` backend (two devices, one announcement, unknown which limits bind) all leave every menu whole. Graying an option the hardware can in fact reach is the worse failure, so the rule is one-directional. Every grayed rate option carries the one word `unavailable` whatever made it unreachable, because the reason renders on the option's own label and has no room for a sentence; the mode segment keeps the explanation, being the one surface with room.

**A setting already sitting on an unreachable value falls back**, to the highest reachable tier, or to PCM where no DSD rate is reachable at all, **as a staged edit, never a display-only substitution**, so the pending bar shows it and Discard undoes it. That it costs a restart at Apply is the user's to spend.

### 7.12 Filter narrowing

Facets AND-combine with each other across both the 1x and Nx lists. **Within** genre and focus the user picks how their own values combine, with an AND/OR switch closing each popover (genre defaults to OR, focus to AND). Phase and length are multi-select too but carry no such switch and always union: a filter holds exactly one phase and exactly one length, so an AND across two picks is empty by construction.

A mode set while its facet is unpicked narrows nothing and does not count as narrowing engaged. Genre's `any` tag outranks the mode: the manual marks such a filter as suiting every genre, so it survives either way; focus has no such tag. An empty result shows an explicit "no filters match — widen criteria" state, never a stale selection. Persistence: §5.5.

### 7.13 Crossfeed gate is mode-aware; the view selector never installs processing

The card's one ENGAGE|BYPASS gate drives two mechanisms: in the Bauer view the `crossfeed_enabled` config key, in the Structural view the install and removal of the sixteen-row matrix block (no config key exists for it). The Bauer|Structural switch below the gate selects a VIEW: it disables the mode being left and turns nothing on.

## 8. REST API contract

### 8.1 API errors

Every refusal the REST API sends is `{"detail": ..., "code": ...}`. `detail` is FastAPI's field, a sentence or the live lane's per-field reasons dict, user-facing and reworded at will; nothing branches on it and no test asserts it (`docs/testing.md` rule 9). `code` is the stable identifier a client acts on. The status is a property of the code (`hqptuner/api/errors.py` `STATUS`), so a route names the cause and never picks a status; project exceptions carry their code from `hqptuner/errors.py` `HQPTunerError` and reach the body through `refuse(exc)`. The frontend surfaces both as `status` and `code` on the rejected `ApiFailure` (`static/lib/api.js`).

| code | status | meaning |
|---|---|---|
| `login_refused` | 401 | hqplayerd refused the username and password a login typed |
| `login_required` | 401 | a request to a gated `/api` route carried no valid login cookie |
| `login_not_answered` | 503 | hqplayerd did not answer the check a login asked of it |
| `login_values_pinned` | 403 | a login named a host, username or password that the environment pins to another value |
| `host_invalid` | 422 | a Connection save or a login named a host that is not a hostname, an IPv4 literal or a bare IPv6 literal (a port, path, query, userinfo, space, zone ID or bracketed form); nothing was saved or sent |
| `credentials_required` | 422 | a Connection save changed the host without carrying both a non-empty username and a non-empty password; nothing was saved or sent |
| `cross_site_refused` | 403 | a state-changing request to `/api` carried a `Sec-Fetch-Site` naming another site, or an `Origin` that is `null` or not the request's own `Host` |
| `no_credentials` | 503 | app built without hqplayerd management credentials |
| `no_http_client` | 503 | app built without HTTP management credentials for the 8088 config lane |
| `backup_failed` | 500 | the settings backup taken before a destructive restore could not be written |
| `not_loaded` | 503 | first poll of the daemon has not landed yet |
| `daemon_read_failed` | 502 | a read from hqplayerd's HTTP or 4321 interface failed |
| `daemon_log_absent` | 404 | hqplayerd answered its log page 404: it has no log to serve |
| `daemon_write_failed` | 502 | a write to hqplayerd failed |
| `daemon_unavailable` | 503 | 4321 not connected, timed out, or answered unparseably |
| `daemon_refused` | 503 | daemon answered `result="Error"` |
| `not_found` | 404 | no preset, profile, action or library under that name |
| `name_invalid` | 422 | a preset name the shared name rule rejects |
| `invalid_input` | 422 | a value a store or the config editor rejects |
| `nothing_staged` | 400 | apply with nothing to apply |
| `fields_unknown` | 422 | a field no lane accepts |
| `store_too_new` | 409 | a JSON store stamped by a newer HQPTuner |
| `store_corrupt` | 500 | a store file that exists but does not read as a JSON object |
| `store_unwritable` | 500 | a store read, write or delete the filesystem refused |
| `archive_unreadable` | 500 | an uploaded backup archive that is not a readable zip, or whose descriptions will not parse |
| `chain_unknown` | 409 | engine's active chain unknown, no live state to snapshot |
| `route_refused` | 409 | live lane refused the batch; `detail` names each field's reason |
| `route_unknown` | 404 | no route at that path |
| `method_not_allowed` | 405 | a real path, wrong method |
| `internal_error` | 500 | an exception no other handler maps; its traceback is in the log |

### 8.2 Lane reports in a 200 body

Lane reports returned inside a 200 body carry the same vocabulary per item: a failed setter is `{"ok": false, "error": ..., "code": ...}`, its `code` the raised error's own (`daemon_unavailable`, `daemon_refused`, `invalid_input`). A standalone preset save that fails is a refusal like load and delete; the apply response carries the autosave outcome as data.

### 8.3 The meter feed streams only to an attached page

`GET /api/meter/feed` (`api/routes/meter.py`) relays the metering reader's `engine/meterfeed.py` as server-sent events: a `geometry` event ahead of the frames it describes, then one `frame` per stride of whole frames nearest 40 ms of frame time, with peak max-held and rms and the 1/12-octave band spectrum power-averaged per channel, and the frame time the stride covers in milliseconds. Nothing is reduced while no subscriber is attached, each subscriber's queue drops its oldest event rather than hold the reader back, and the feed resets on every metering connect so a resume never mixes frames from before a pause. With metering off the route answers 204, which an `EventSource` does not retry.

## 9. Background tasks

**The advisor, auto-pilot and the METER page are withdrawn for rework**: `Config.advisor_enabled`, a build constant in `config.py`, is off, so the reader is never built, `presetlane.switch_autopilot` writes nothing, a live snapshot records no auto-pilot state, `/api/status` reports `advisor` false and auto-pilot off whatever its store holds, and the UI renders none of the three; every stored state stays where it is for the build that turns the constant back on. <!-- history-ok: owner ruling; the withdrawal is the reason the constant exists and reads off -->

### 9.1 Metering reader

The backend reads the engine's metering stream (`engine/metering.py`, wire in `protocol.md` §7). The connection is held **only while the engine is playing**: the daemon streams unconditionally, so closing the socket is the only way to stop paying for frames nobody ingests. A pause mid-track keeps the aggregate; a broken stream discards it. `HQPTUNER_METERING_ENABLED=0` switches the reader off entirely. Stream absence means "no recommendation", never a user-facing error.

### 9.2 Junk-filter advisor advises and never acts

The advisor classifies the playing track's spectrum (`engine/junkadvisor.py`; signatures, thresholds and design rationale live in its module docstring) and surfaces a note in the alert-strip chip, present in both the tabs and LIVE views. The note has no apply button and no dismiss: the user acts or ignores it. Auto-pilot is the one thing that acts on it.

Detection (`classify`) and treatment (`treats`) are separate and the caller combines them: the note goes quiet under treatment, while auto-pilot needs the untreated signature to know what to engage and what to let go of. The note clears once the engaged junk filter treats it (corner at or below the recommended one, or any rate-relative choice); `none` never clears it. Rate-relative filters (2x/4x/8x) are never recommended.

Each verdict holds differently:

- **Ramp**: a property of the spectrum in front of the rules, recomputed on every read and held by nothing, so the note clears as soon as the current minimum stops carrying the signature.
- **20k**: a run over closed block readings (`engine/junkrun.py`), engaging on the second block that reads junk within three blocks of the first, standing through blocks that read nothing at all, and clearing on the first block that reads real.
- **Spur**: held per bin, each bin engaging when its excess over the local baseline crosses the engage split and releasing once that excess falls under the lower release split or the bin stops standing clear of the floor, so a loud passage that lifts the baseline over a tone does not drop the advice and bring it back.

Where more than one rule fires, the lowest corner wins, among the held spur bins too. The hold has no track boundary of its own: a held bin releases when the rules stop seeing it, not when the track changes, and the aggregate behind it is rebuilt only when the frame geometry changes or the stream breaks.

### 9.3 Auto-pilot is the advisor's write path, off by default

With it on, auto-pilot moves the junk filter to what the playing track's signature asks for and back again (`core/autopilotops.py`, decision in `lanes/autopilot.py`, state in `presets/store/autopilot.py`). It is a **background task of its own**, started by the lifespan beside the metering reader whose verdict it acts on, and only where that reader is, so `HQPTUNER_METERING_ENABLED=0` means auto-pilot never runs. It is not a route: `GET /api/status` only fires while a browser is open, and auto-pilot has to keep working for someone who is only listening. Its cadence follows the status poll, because everything the decision reads is refreshed by it. The switch grays when the metering reader is off.

**Auto-pilot's resting state is nothing engaged, and it stores no baseline.** The junk filter is a corrective rather than a preference, so with auto-pilot on it is engaged for the signature that calls for it and released the moment that signature clears; a filter that happened to be engaged when the switch was flipped is released too, rate-relative filters included. The one thing that stays its hand is `junkadvisor.treats`: a spur verdict is also treated by a main filter from one of its families, so switching to a hires filter drops the junk filter and switching away brings it back. Auto-pilot engages as soon as the stream carries a signature it can read, and follows each verdict's hold as the advisor defines it.

**Setting the junk filter by hand switches auto-pilot off** (`POST /api/config/live` carrying `junk_filter`): the user taking the control back, before the write rather than after, so no poll can revert the choice they just made, and the only way to hold a filter of one's own. The write is the ordinary LIVE lane, readback-verified and audited like any other; it costs the stream nothing (manual §2.8).

## 10. Event log

### 10.1 Every durable write is recorded

**Every durable write records what it was handed, and the volume trace records what was read** (`hqptuner/audit.py`). Append-only JSON Lines, off unless `HQPTUNER_DEBUG_LOG` names a path; the disabled instance is `AuditLog(None)` and its emitters are no-ops, so no call site ever guards on `enabled`.

**The success path is the point.** Staged edits live in a server-side buffer, and the apply that drains it clears it in the same request (`api/routes/apply.py` `/config/apply`), so a write that landed wrong has no evidence left unless it was recorded as it happened. Failure-only logging answers nothing here.

### 10.2 Event log rules

- **One instance, threaded from `ConnectionManager.audit`.** Each instance resumes `seq` from the file on construction, so a second copy reissues numbers the first already used. A sequence that repeats is worse than none: it reads authoritative.
- **`conf/` stays pure.** XML editors take bytes and return bytes, with no logging inside them. Profile writes emit at the two callers that land an element, the fan-out into a stored preset (`target` is `preset:<name>`) and the running config (`target` is `config`), which is also where the pre-edit XML is in hand, so `replaced` is answerable.
- **Emitters are typed per event, never free-form.** The vocabulary is the contract, and it is what tests assert; log *text* stays off-limits per `docs/testing.md` rule 1. A new durable write path gets an emitter or reuses one; a silent write is a defect.
- **Values are captured whole to 128 KB**, so a payload is recoverable from the log rather than merely described by it; larger ones truncate, and the record carries `truncated` plus `full_digests` keyed by dotted field path. The file rolls to `<path>.1` past `max_bytes`.
- **`password` / `secret` / `token` never reach a record**, at any depth.
- **The volume trace is the one reader in the vocabulary** (`hqptuner/voltrace.py`). Volume rides two mechanisms, the config file's `defaults_volume` the daemon boots on and the live 4321 value, and two write paths reach the second, so `volume.write` names which path and `volume.observe` records a checkpoint's reading. Every observation carries `last_write`, the level HQPTuner most recently asked for: a reading that has moved to something else is a move HQPTuner did not make. The trace's own entry points suppress `OSError` around the emitter, because two checkpoints sit inside the poll tick and an unwritable log path would otherwise stall every reading in the app.
- **No UI, deliberately.** It is an operator's tool: set on the container, read with `jq`, or over `GET /api/audit`, which exists only while the variable is set.

## 11. Code structure

### 11.1 Import layering

`api > core > presets > lanes > engine > conf`, absolute imports only. The contract is `[tool.importlinter]` in `pyproject.toml`, gated by `lint-imports`. A move that inverts an edge is fixed by splitting the crossing function, never by loosening the contract.

### 11.2 `core/manager.py` is the composition root

It holds construction, the lifecycle flags, the supervisor loop, the clock and network seams and the client accessors, and nothing that fills a reading on demand. Connect and poll steps go to `core/loader.py`, post-restart resyncs and waits to `lanes/settle.py`, backup-archive readers to `presets/fileconfig.py`, engine readers to `core/engineread.py`, and anything a lane can own to that lane. An addition to the manager names which of those it could not live in and why.

## 12. Provenance

The Control API implementation is derived from Jussi Laako's official `hqp-control` utility source, itself MIT-licensed, with attribution. `unified-hifi-control` (PolyForm Noncommercial) and `hqpwv` (GPL-3) are **not** to be opened or copied. HQPTuner carries MIT. Jussi has no objection to alternative interfaces.
