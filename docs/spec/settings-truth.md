# Settings truth: binding for all contributors, human or agent

Violations are rejected in review even when every test passes. Which lane each field writes on is `docs/spec/settings-classification.md` and stays there; this document says which store answers for a field, when, and how a value moves between stores. Tests of this code are also bound by `docs/spec/testing.md`, rules 4, 7, 10, 11, 13 and 17 above all. Where the daemon stands, and whether a restart was HQPTuner's own, is `docs/spec/lifecycle.md`. This document takes its generation and its three outcomes, own restart landed, own restart settled in place and foreign departure, and defines nothing about them. It hands one fact back: whether a write's readback confirmed on a standing connection.

## Words

Each word below means one thing in this document, in code and in review.

| Word | Meaning |
|---|---|
| **Field** | One setting the user can change, named by its `/config` form field name or its `State` attribute. |
| **Engine** | The running hqplayerd process's settings, read by `State` and the enumeration queries on 4321, written by `Set*`. |
| **File** | The daemon's working config, `hqplayerd.xml` as `/backup` carries it and `/config` renders it, written by `POST /restore` and the form routes on 8088. |
| **Record** | A file HQPTuner owns that holds what the user saved: a config preset, a live snapshot, an auto-pilot entry. It holds what was saved, never what runs. |
| **Staged** | The pending buffer: edits the user has made and not yet applied. |
| **Realized config** | The File with the Engine's live-domain fields written in, composed once for one write. |
| **Chain** | The PCM or SDM enumeration set the Engine is on. |
| **Generation** | The lifecycle policy's ordering token, a count of proven departures. Every reading is stamped with the generation it was read in. |
| **Outcome** | One of the lifecycle policy's three: own restart landed, own restart settled in place, foreign departure. A foreign departure may be an idle close; the readings say whether the Engine changed. |
| **Source** | Which of Engine, File, Record or Staged a value was read from. |
| **Domain** | What a value's digits mean: list index, enum ID, Hz, flag, text. |

## The two stores and no third

The daemon has two stores and no third.

| Store | What it says | Its only read surface | Its only write surface | Lifetime |
|---|---|---|---|---|
| **Engine** | What the daemon is running now | `State`, `Status`, `GetModes`, `GetFilters`, `GetShapers`, `GetRates`, `GetJunkFilters`, `VolumeRange` on 4321 | `Set*`, `Volume`, `MatrixSetProfile` on 4321 | Until Down or the next outcome (lifecycle rule 6) |
| **File** | What the daemon will run after its next restart | `/backup` archive, `/config` form on 8088 | `POST /restore`, `POST /matrix`, `POST /speakers` on 8088 | Until the next write |

The Engine never writes the File, and the File reaches the Engine only through a restart. They differ in normal use, and the difference is information: it is read from both and shown, never averaged, overlaid or reconciled into a value that neither store holds.

Every other copy of a setting in the program is a view of one store, or a Record. A view names the store it was read from and dies with that store's lifetime: a view of the Engine dies at the connection's Down and at every outcome, a view of the File dies at the next write to the File. A copy that outlives its store, or that holds values from two stores under one name, is a third store, and is a defect.

Every value that carries a setting names its source and its domain in its doc comment: `filter: str  # engine, list index`, `filter: str  # file, enum ID`. The comment declares the source for review; the stamp of rule 1 carries it at runtime; a value whose stamp and comment disagree is a defect, and so is a setting with no source named.

## Who answers for a field

Each field class has one row. A row names the store that answers for a read, the lane that writes, the readback that confirms the write, and what carries the value across the two breaks the program has: a restart and a chain switch. "Nothing" is an answer; a value that is carried by nothing is gone at the break, and the program says so rather than putting it back. A mechanism that carries a value and has no row is a defect.

| Field class | Read authority | Write path | Verified by | Across a restart | Across a chain switch |
|---|---|---|---|---|---|
| Chain fields: 1x filter, Nx filter, dither or modulator | Engine | Live lane, `SetFilter`, `SetShaping` | `State` readback | The realized config, when the outcome is an own restart; nothing on a foreign departure | Nothing; the Engine's own answer after the switch is read back and shown. A live snapshot is the way back |
| Output mode | Engine | Live lane, `SetMode` | `State` readback | The realized config, when the outcome is an own restart; nothing on a foreign departure | It is the switch |
| Direct flags: adaptive volume, junk filter | Engine | Live lane, `SetAdaptiveVolume`, `SetJunkFilter` | `State` readback | The realized config for adaptive volume; the auto-pilot Record for the junk filter; nothing else | The Engine's own answer, read back |
| Rate pin | Engine, `State.rate` | Live lane, `SetRate` | `State` readback | Nothing; the File's fixed slots are forced to `0` on every write | Nothing; `SetMode` clears it |
| Playback volume | Engine, `State.volume` | `Volume` | `State` readback | Nothing | Nothing |
| Active matrix profile | Engine, `State.matrix_profile` | Matrix lane, `MatrixSetProfile`, name checked against `MatrixListProfiles` first | `State` readback | Nothing | The Engine's own answer, read back |
| Rate limit, `defaults_samplerate`, `defaults_bitrate` | File | Restore lane | `/backup` readback | It is the File | It is the File |
| Form fields with a live setter too: `mode`, `adaptive_volume`, `filter`, `shaper` and the rest of the live-domain form fields | File for what the next restart boots on; Engine for what runs | Restore lane | `/backup` readback | It is the File | It is the File |
| Form fields with no live setter: backend, device, bits, DoP, buffer, channels, pipelines, FFT length, crossfeed, DAC correction, DSD sources, volume limits, gain, log | File | Restore lane | `/backup` readback | It is the File | It is the File |
| `volume_fixed` | File, from `/backup`; the `/config` form cannot carry `2` | Restore lane | `/backup` readback | It is the File | It is the File |
| `<engine>` attributes: `cuda`, `multicore`, `ecores`, `nblocks`, `cuda_dev`, `cuda_cdev` | File, from `/backup` | Restore lane | `/backup` readback | It is the File | It is the File |
| Host interfaces: `<upnp interface>`, `<network mcast_interface>` | File | Restore lane | `/backup` readback | It is the File. A preset load keeps the running File's values over the Record's: these name the host, not the preset | It is the File |
| Fixed rate slots, `samplerate`, `bitrate`, `auto_family` | Never read | Forced to `0`, `0`, `1` on every restore write | `/backup` readback | It is the File | It is the File |
| Matrix and speaker forms | File | Form lane, `POST /matrix`, `POST /speakers` | Form readback after the reload settles | It is the File | It is the File |
| Matrix profiles saved through `/matrix/save` | Engine memory only | Form lane | `MatrixListProfiles` | Nothing | The Engine's own list |

Three questions about a field have one answer each, and one pure function each:

- **What is this field running at?** The Engine's last verified reading since the last outcome. Before the first reading after an outcome the answer is "not read yet", never the reading from before it and never the File's.
- **What does a restore boot on?** The realized config: the File as `/backup` last returned it, the Staged edits written in, and for the live-domain fields the table names, the Engine's last verified value since the last outcome. Composed once per write, before the request goes out, by one function, and that function is the only place an Engine value is ever written into a File-shaped document.
- **What does a save store?** The same realized config, by the same function. A save stores what a restore would boot on, so a saved preset loaded back runs what the user was hearing when they saved.

## Rules

1. **A value carries its source.** A setting value is stamped with its source and the generation it was read in at the one site where it arrives: the 4321 reader for the Engine, the archive and form parsers for the File, the store readers for a Record, the pending buffer for Staged. A value with no source is a defect. Provenance is stamped there and nowhere else; no checkpoint later in the pipeline re-derives where a value came from.
2. **One question, one function.** Each of the three questions above is answered by one pure function whose return value is the answer (testing rule 17). A second site that composes the File with the Engine, under any name, is a second answer, and is a defect.
3. **The client decides nothing about truth.** The server answers every field with its Engine value, its File value and its Staged value, each stamped, and the lane the field writes on. The client shows the value the lane names and marks a divergence; it holds no priority order, no per-field truth flag and no list of which fields apply live. A client-side rule of the form "for these fields read the file" is the server's rule copied, and drifts.
4. **Divergence is surfaced, never merged.** No read path returns a document in which some fields are the Engine's and some the File's under one source. Where the Engine and the File disagree on a field, both values reach the user, each with its source. The realized config is the one composite, it is a write payload, and it is never served as a reading.
5. **A view is bound to one store's lifetime.** A copy of Engine values dies at Down and at every outcome the lifecycle policy names, settled in place included: a reload the connection survived still replaced the Engine. The next reading starts from nothing, not from the copy. A copy of File values dies at the next write to the File. A view that lives across the break it was bound to is a third store.
6. **A break carries nothing on its own.** A restart and a chain switch each end what the Engine held. A value present after the break is either the Engine's own answer, read back, or a value the table says is carried and names the carrier of. The program never replays a remembered value into the Engine after a break to make it look as if the break had not happened; where a user wants a chain back, a live snapshot is the mechanism, and it is theirs to invoke.
7. **A write is verified against its own store.** `result="OK"` and HTTP 200 are not proof. A live write is confirmed by `State` readback from the Engine; a restore by `/backup` readback from the File after the restart settles; a form write by the form after the reload settles. A write is never confirmed by reading the other store, and never by reading a view. The verify step reports to the lifecycle policy whether its readback confirmed on a standing connection (lifecycle rule 10); that is the one fact this side hands back.
8. **The drop report is a comparison of two readings, not a memory.** What the Engine ran before a restart and does not run after it is computed once, at the first verified reading after an outcome, from that reading against the last verified reading before it. That earlier reading is held, stamped with its generation, until the report is made and not after. Its input is two stamped readings, and it replays nothing. After a foreign departure that was an idle close the two readings are equal and the report is empty.
9. **Tests assert invariants on a disagreeing wire.** A test of this code runs on a fake daemon that speaks the wire (testing rule 4) from tables (rule 13) in which the Engine and the File disagree on at least one field. It asserts a property the rules promise: a reading names its source, a composite is served by no read route, a view is empty after an outcome until the next reading, a restore payload carries the Engine's value for a chain field and not for a pinned rate. It never asserts a worked example of which value wins (rules 10 and 11).
10. **Enumerations are mode-relative; never pre-capture.** Re-run the enumeration queries on every mode switch rather than filtering a cached list; never flip modes to pre-capture the other one. Mode index 0 (`[source]`) keeps the current lists.
11. **Live vs restart split is all-or-nothing per batch.** One restart-required field sends the whole staged batch down the restore lane: the restart happens anyway, and a value applied live never reaches the config file the restart boots from, so a split batch would revert its own live half.
12. **Two write paths share no staging state.** The stage drawers' rows stage into the shared pending store, and a drawer's apply button flushes **everything** in it. The live controls write one batch on the spot, through `POST /api/config/live`. Every such write is readback-verified and touches neither the pending store nor the 8088 lane, so it can never restart the daemon. The rule binds in both directions: a live control routed through stage and apply would apply edits the user staged elsewhere and never asked for.
13. **Mode rides alone, then the rest re-resolves.** `SetMode` swaps the enumerations the remaining indices were resolved against, so routing refuses a batch carrying mode and chain fields together. Applying mode alone, re-enumerating, then resolving the rest against the post-switch lists is legal, and is what a preset apply does; a live apply runs the same sequence after any verified mode write. The refusal is about one batch, never about what the engine can be told.

    **A live mode write always goes through that re-enumerating path, whatever else is staged with it.** A mode routed as an ordinary edit leaves the enumeration cache holding the departed mode's lists. Because it also refreshes the manager's state, it consumes the mode transition the poll watches to re-enumerate on its own, so the next apply resolves a filter's enum ID against the wrong list and the engine takes a different filter than the one named.

## The write paths

Each hop owns one decision. A diff that makes a decision outside its owner is rejected.

| Hop | Owns | Module |
|---|---|---|
| 4321 reader | Reading `State` and the enumerations; stamping each value Engine, with the generation | `engine/`, `core/engineread.py` |
| Archive and form parsers | Reading `/backup` and `/config`; stamping each value File | `presets/fileconfig.py`, `conf/` |
| Readings | Holding the current stamped readings of each store, and nothing composed from them | `core/readings.py` |
| Pending buffer | Holding Staged edits; deciding which staged value the stores already hold | `core/pending.py` |
| Routing | Splitting one apply into its live batch and its restart batch | `lanes/live/routing.py` |
| Live lane | Writing one live batch, mode first, and verifying each field by `State` readback | `lanes/live/lane.py` |
| Realized config | Composing the one write payload a restore or a save takes | `presets/realized.py` |
| Restore lane | Writing a realized config by `POST /restore`, forcing the fixed rate slots, keeping the host interfaces | `lanes/http/restore.py` |
| Settle | Waiting for the daemon to serve again on the manager's clock | `lanes/settle.py` |
| Verify | Reading the written store back and reporting what landed | The lane that wrote |
| Drop report | Comparing the first reading after an outcome against the last reading before it | `lanes/live/dropped.py` |
| Preset store | Holding Records; a load restores one, a save stores the realized config, neither reads the other store | `presets/store/presets.py`, `presets/presetlane.py` |
| Live snapshot store | Holding Records of chain fields; an apply writes them through the live lane | `presets/store/live.py`, `presets/livesnapshots.py` |
| API | Serving each field's stamped Engine, File and Staged values and its lane; serving no composite | `api/routes/config.py` |
| Client store | Showing the value the lane names; marking divergence; deciding nothing | `static/store/` |

**HQPTuner's persistent writes ride `POST /restore`, not `POST /config`.** The `/config` form cannot express every owned setting (`volume_fixed`'s third state, the `<engine>` hardware attributes), and its submission contract is hostile. HQPTuner fetches `/backup`, surgically edits the config XML, and pushes the archive. The `/config` contract in `docs/spec/protocol.md` "HTTP configuration routes (port 8088)" is documented because the daemon's own UI uses it and because a partial POST is a live footgun, not because HQPTuner calls it.

HQPTuner's engine-attribute write path is: fetch `/backup`, surgically edit the `<engine>` tag (byte-faithful) in the base config plus the active (or all) snapshot, `POST /restore` `scope=system`, verify by reading the `<engine>` tag back from a fresh `/backup`.

## Measured facts

These are measurements, not assumptions. Code reads the wire rather than relying on them; tests use them as table rows.

| Fact | Value | Measured by |
|---|---|---|
| Control API changes never reach the File | A restart reverts every `Set*` to what `hqplayerd.xml` holds | `docs/spec/protocol.md` "Transport and framing", settings persistence |
| `POST /restore` restarts the daemon | Self-restart, about 5.6 s; the daemon lands on `[default]`; success is confirmed by `/backup` readback, never by the 200 | `docs/spec/protocol.md` "HTTP configuration routes (port 8088)" |
| `POST /config` is not HQPTuner's write path | The form must be complete; a rejection is HTTP 200 with `Failed!`; the readback must poll | `docs/spec/protocol.md` "HTTP configuration routes (port 8088)" |
| The `/config` form is lossy | `volume_fixed` has domain 0, 1, 2 and renders as a checkbox, so the form cannot report `2` | `docs/spec/settings-classification.md`, Optimal ISO |
| `Set*` and `State` speak list index; the File speaks enum ID | `SetFilter value="6"` is index 6; `filter="40"` in the File is an enum ID | `docs/spec/protocol.md` "Response conventions" |
| Enumerations are chain-relative | The engine returns the current chain's lists only; they differ wholesale between chains | `docs/spec/protocol.md`, SetMode |
| `SetMode` clears the rate pin | The engine keeps one pin and drops it on every mode switch | `docs/spec/protocol.md`, SetRate, `scripts/probes/rate/probe_mode_rate_pin.py` |
| A matrix profile switch is memory-only | `MatrixSetProfile` leaves the File untouched and reverts on restart; an unknown name answers `result="OK"` | `docs/spec/protocol.md`, Matrix profile commands |
| A `/matrix/save` profile is lost at the next restart | No shutdown flush; profiles register at process start only | `docs/spec/protocol.md`, matrix profile persistence |

## Checklists

**Adding a field.**

- Give it a row in the table above, or add it to the row of its class: read authority, write path, readback, and what carries it across each break.
- Add its lane to `docs/spec/settings-classification.md`.
- Stamp it where it arrives, with source and domain, and name both in its doc comment.
- If a restore must carry its live value, add it to the realized config's field set and to nothing else.

**Adding a value that holds a setting.**

- Name its source and its domain in its doc comment.
- Bind its lifetime to its store: Engine values clear at Down and at every outcome, File values at the next File write.
- If it holds values from two stores, stop: that is the realized config, and it has one home.

**Adding a write path.**

- Route it through the live lane, the restore lane or a form lane; a fourth path is a defect.
- Verify it by reading back the store it wrote, on the manager's clock.
- If it restarts the daemon, it goes out through the lifecycle policy's one restart function, so the outcome reads as HQPTuner's own and the drop report after it knows.

**Adding a client surface that shows a setting.**

- Take the value the server's lane names; take the divergence from the server's two stamped values.
- Add no flag that says which store to prefer.

## Examples

A reading that overlays the Engine on the File, and the two readings served apart:

```python
# Rejected: a document neither store holds, served as the file.
file = {**file_config, **live_overrides}

# Holds: each store answers for itself, stamped, and the client marks where they differ.
field = FieldReading(engine=state.filter, file=file_config.filter, lane="live")
```

A value with no source, and one that names it:

```python
# Rejected: which store this came from is decided by whoever reads it next.
filter: str

# Holds: the source and the domain travel with the value.
filter: str  # engine, list index
```

A memory replayed into the Engine after a chain switch, and the Engine's own answer read back:

```python
# Rejected: the dormant chain's remembered fields are written back so the switch looks lossless.
await replay(memory.chain[chain])

# Holds: the Engine says what it is on after the switch, and that is what the user sees.
state = await client.get_state()
```

The client re-deriving the server's rule, and the client taking the server's answer:

```js
// Rejected: a second copy of the ownership table, kept by hand.
const value = fileTruth[key] ? file[key] : form[key];

// Holds: the server said which store answers; the client shows it.
const value = reading[reading.show];
```

A test that restates which value wins, and one that asserts the invariant. Shape only, not values to copy:

```python
# Rejected: the expected value is the implementation's own precedence order.
assert config["filter"] == "40"

# Holds: no read route serves a value that neither store holds.
assert served["filter"] in {engine_filter, file_filter}
```

## Enforcement

- A gate refuses a per-field flag naming a store to prefer under `hqptuner/static/`: no `fileTruth`, no `appliesLive`, no priority list of sources.
- A gate refuses any module outside the realized config's home that writes an Engine reading and a File reading of the same field into one value.
- Review checks every settings diff against the table: one row per carried value, one function per question.
- Exemptions are owner-approved, site by site, as for every gate.
