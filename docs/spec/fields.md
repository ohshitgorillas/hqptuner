# Field register: binding for all contributors, human or agent

Every fact about a setting lives in one register, and every other module asks the register. The fact is the setting's name, where the File keeps it, its live setter, the State attribute that reports it, the enumeration it joins through, its chain, and what a snapshot, a restart or a restore does with it. A module that keeps its own table of field names, or its own copy of one of these facts, is a defect.

Which store answers for a field is `docs/spec/settings-truth.md`; which lane it writes on is `docs/spec/settings-classification.md`; the wire itself is `docs/spec/protocol.md`. This document names the facts those rules read and the one way an Engine list index, an enum ID and a display name are joined.

## Words

| Word | Meaning |
|---|---|
| **Field** | One setting, named by its `/config` form field name; a setting the form does not carry is named by its HQPTuner wire key (`junk_filter`, `rate`, `volume`, `matrix_profile`, the `<engine>` attribute names). |
| **Register** | The one table of every field and its facts. |
| **Setter** | One Control API command on 4321 that writes Engine values: `SetMode`, `SetFilter`, `SetShaping`, `SetRate`, `SetJunkFilter`, `SetAdaptiveVolume`, `Volume`. |
| **Location** | Where the File keeps a field: one attribute of one element, one attribute of one `<post_process>` plugin, or a codec this document names. |
| **Enumeration** | One of the five lists the Engine answers on 4321: `modes`, `filters`, `shapers`, `rates`, `junk_filters`. Each item carries `index`, and some carry `name`, `value` (the enum ID) or `rate`. |
| **Join** | Which item attribute a field's form value matches: the enum ID, the mode name, the rate in Hz, or the list index itself. |
| **Engine view** | One Engine reading held as a value: State, Status, the enumerations and the matrix profile list, read in one generation. Every join is a question put to a view. |

## The register

### Fields with a setter

| Field | Location | Setter, argument | State attribute | Enumeration, join | Chain | Staged edit can route live | Live control takes it | Snapshot holds it | Across a restart |
|---|---|---|---|---|---|---|---|---|---|
| `mode` | `<mode value>` | `SetMode`, `value` | `mode` | `modes`, by name | none | yes | yes | yes | realized config |
| `filter1x` | `<pcm filter1x>` | `SetFilter`, `value1x` | `filter1x` | `filters`, enum ID | PCM | yes | yes | yes | realized config |
| `filter` | `<pcm filter>` | `SetFilter`, `value` | `filterNx` | `filters`, enum ID | PCM | yes | yes | yes | realized config |
| `dither` | `<pcm dither>` | `SetShaping`, `value` | `shaper` | `shapers`, enum ID | PCM | yes | yes | yes | realized config |
| `oversampling1x` | `<sdm oversampling1x>` | `SetFilter`, `value1x` | `filter1x` | `filters`, enum ID | SDM | yes | yes | yes | realized config |
| `oversampling` | `<sdm oversampling>` | `SetFilter`, `value` | `filterNx` | `filters`, enum ID | SDM | yes | yes | yes | realized config |
| `modulator` | `<sdm modulator>` | `SetShaping`, `value` | `shaper` | `shapers`, enum ID | SDM | yes | yes | yes | realized config |
| `adaptive_volume` | `<engine volume_adaptive>` | `SetAdaptiveVolume`, `value` | `adaptive` | none, a 0/1 flag | none | no | yes | yes | realized config |
| `junk_filter` | none | `SetJunkFilter`, `value` | `filter_junk` | `junk_filters`, list index | none | no | yes | no | the auto-pilot Record |
| `rate` | none | `SetRate`, `value` | `rate` | `rates`, rate in Hz | none | no | yes | no | nothing |
| `volume` | none | `Volume`, `value` | `volume` | none, a decimal number | none | no | no | no | nothing |
| `matrix_profile` | none | `MatrixSetProfile` on the matrix lane | `matrix_profile` | the `MatrixListProfiles` list, by name | none | no | no | yes | nothing |

"Staged edit can route live" means a staged form edit of the field may be written by its setter instead of by a restore. "Live control takes it" means `POST /api/config/live` accepts the field. "Across a restart" is the carrier `docs/spec/settings-truth.md` names; the realized config carries exactly the fields this column marks, and no other.

### Setters

The setters are written in this order within one live batch, and the pending buffer takes every setting key but `rate`.

| Order | Setting key | Setter | State attributes read back | Pending buffer takes it |
|---|---|---|---|---|
| 1 | `mode` | `SetMode` | `mode` | yes |
| 2 | `filter` | `SetFilter` | `value` reads back as `filterNx`, `value1x` as `filter1x` | yes |
| 3 | `shaper` | `SetShaping` | `shaper` | yes |
| 4 | `rate` | `SetRate` | `rate` | no |
| 5 | `junk_filter` | `SetJunkFilter` | `filter_junk` | yes |
| 6 | `adaptive_volume` | `SetAdaptiveVolume` | `adaptive` | yes |
| 7 | `volume` | `Volume` | `volume`, within 0.05 | yes |

### Fields the File keeps at one attribute

Each of these is a single-instance element in the config XML. None has a setter.

| Element | Field and attribute |
|---|---|
| `<title>` | `title` at `value` |
| `<output>` | `backend` at `type` |
| `<pcm>` | `samplerate` at `samplerate` |
| `<sdm>` | `bitrate` at `bitrate` |
| `<defaults>` | `defaults_samplerate` at `samplerate`, `defaults_bitrate` at `bitrate`, `defaults_volume` at `volume` |
| `<alsa>` | `alsa_device` at `device`, `alsa_bits` at `dac_bits`, `alsa_period` at `period_time`, `alsa_offset` at `channel_offset`, `alsa_anydsd` at `any_dsd`, `alsa_dop` at `pack_sdm` |
| `<network>` | `net_bits` at `dac_bits`, `net_period` at `period_time`, `net_anydsd` at `any_dsd`, `net_ipv6` at `ipv6`, `net_dop` at `pack_sdm` |
| `<asio>`, `<wasapi>` | `<prefix>_device` at `device`, `<prefix>_bits` at `dac_bits`, `<prefix>_period` at `period_time`, `<prefix>_offset` at `channel_offset`, `<prefix>_anydsd` at `any_dsd`, `<prefix>_dop` at `pack_sdm`, where the prefix is `asio` or `wasapi` and names the element |
| `<engine>` | `auto_family`, `idle_time`, `channels`, `fft_size`, `pipelines`, `direct_sdm`, `dsd_6db`, `sdm_conversion`, `gain_comp`, `playlist_album_gain`, `pre_before_meter`, `quick_pause`, `short_buffer`, `volume_max`, `volume_min` and `volume_fixed` each at the attribute of its own name; `integrator` at `sdm_integrator`, `pcm_conversion` at `pdm_conv`, `noise_filter` at `pdm_filt` |
| `<matrix>` | `matrix_enabled` at `enabled`, `matrix_engine` at `engine`, `matrix_expand_hf` at `expand_hf`, `matrix_iir2fir` at `iir2fir` |
| `<log>` | `log_enabled` at `enabled`, `log_file` at `file` |
| `<upnp>` | `upnp_freewheel` at `freewheel` |

### Fields the File keeps on a plugin

Each is one attribute of the `<plugin type="…">` of that type under `<post_process>`.

| Plugin type | Field and attribute |
|---|---|
| `bauer` | `post_bauer_enabled` at `enabled`, `post_bauer_preset` at `preset`, `post_bauer_frequency` at `frequency`, `post_bauer_level` at `level` |
| `correction` | `post_correction_enabled` at `enabled`, `post_correction_dac0` at `dac0` |
| `loudness` | `post_loudness_enabled` at `enabled`, `post_loudness_lowfreq` at `low_frequency`, `post_loudness_lowlevel` at `low_level`, `post_loudness_lowsteep` at `low_steepness`, `post_loudness_lowtype` at `low_type`, `post_loudness_highfreq` at `high_frequency`, `post_loudness_highlevel` at `high_level`, `post_loudness_highsteep` at `high_steepness`, `post_loudness_hightype` at `high_type`, `post_loudness_rangelow` at `range_low`, `post_loudness_rangehigh` at `range_high` |

### Fields the File keeps through a codec

| Field | Codec |
|---|---|
| `net_device` | One value, `address/device`, split at its first `/` into `<network address>` and `<network device>`, and joined back the same way on read. |
| `fixed_volume_enabled` | The presence of a top-level `<fixed>` element is the flag; there is no attribute. |
| `fixed_volume` | `<fixed volume>`, read from the live element, or from the commented line that parks it while fixed volume is off. |
| `matrix_pipelines` | Every `<pipeline>` row of the live matrix, as one JSON value written whole. |
| `matrix_profiles` | Read only: every stored matrix profile, as canonical JSON. It is the readback that proves the two verbs below. |
| `matrix_profile_save`, `matrix_profile_delete` | Write-only verbs on the stored matrix profiles, proven by `matrix_profiles`. |

### `<engine>` hardware attributes

These are written by the engine-attribute path (`docs/spec/settings-truth.md`, the write paths), never by the `/config` form, and each value is checked before anything is written.

| Field | Domain |
|---|---|
| `cuda` | `0`, `1`, `convolution` |
| `multicore` | `auto`, `0`, `1` |
| `ecores` | `default`, `pool`, `filter` |
| `nblocks` | an integer |
| `cuda_dev` | an integer |
| `cuda_cdev` | an integer |

An integer here is an optional leading `-` and then digits, nothing else.

### Sets the register names

| Set | Members |
|---|---|
| Forced on every restore write | `auto_family` = `1`, `samplerate` = `0`, `bitrate` = `0` |
| Host interfaces, kept from the running File on a preset load | `<upnp interface>`, `<network mcast_interface>` |
| Read from `/backup`, because the form is lossy | `volume_fixed` |
| Traced by the volume trace | `defaults_volume`, `volume_max`, `volume_min`, `volume_fixed`, `fixed_volume`, `fixed_volume_enabled`, `adaptive_volume` |
| The field naming each backend's device | `network`: `net_device`; `alsa`: `alsa_device`; `asio`: `asio_device`; `wasapi`: `wasapi_device`; `combo`: none, because it drives both devices and the daemon announces one |

## Joins

Every join is a lookup in the running enumeration, never arithmetic on a number, and is asked of one Engine view.

1. **Enum ID to list index.** A filter or shaper's form value is an enum ID. It becomes the `index` of the item whose `value` is that ID, and a list index becomes the `value` of the item at that `index`. An ID the list does not carry has no index.
2. **Mode by name.** The modes list depends on the device, so its positions are not stable and a mode is matched by its item's name. The form values are `auto`, `pcm` and `sdm`. An item whose name begins with `[source]` is `auto`, one that begins with `PCM` is `pcm`, and one that begins with `SDM` or `DSD` is `sdm`, compared without regard to case.
3. **Junk filter by index.** The junk filter is in the list-index domain on both sides, so its join is a membership check: an index the running list does not carry is refused before the write, not by its readback after it. Auto-pilot settles on a junk filter by name, and the name becomes the index of the item carrying it.
4. **Rate by Hz.** A pinned rate's form value is a rate in Hz, and it becomes the `index` of the item whose `rate` is that number. A rates item has no name.
5. **A reading is a value and a name.** One field read from State is its form value and the name the enumeration gives that item. Where the item has no name, as a rate or a 0/1 flag has none, the value stands as its own name.
6. **The configured chain.** The chain State's mode configures is the chain its mode item's name denotes: `pcm` or `sdm`, and none for `auto`.
7. **The loaded chain.** The chain the filters and shapers belong to is the configured chain when there is one. In `auto` the engine switches per source and `Status.active_mode` echoes `[source]`, so Status answers instead: the chain `Status.active_mode` names, else the family of `Status.active_rate`, which is SDM at 2822400 Hz and above and PCM below. A rate of `0` or none answers nothing, and then there is no loaded chain.
8. **A field reads only on its chain.** The enumerations answer for the loaded chain only, and the two chains number their enum IDs differently. A PCM field has an Engine value only while PCM is loaded, an SDM field only while SDM is loaded, and a field of the chain not loaded has none.

## Rules

1. **One register, every fact.** The facts above are rows of one table and are read through it. A per-module table of field names, a field-name literal used to branch, and a derived set kept apart from the register are each a second copy, and a defect.
2. **One view, every join.** A join, a chain decision and a list-membership check are questions put to one Engine view. A loop over an enumeration list outside the view is a second join, and a defect.
3. **SetFilter takes both halves.** `SetFilter value` alone sets both the 1x and the Nx filter, so a write of one half carries the other explicitly, filled from State's `filterNx` or `filter1x`. Where State reports neither, the half cannot be filled: a staged batch holding such an edit goes to the restore lane whole, and a live batch is refused, naming each filter field.
4. **The rate limit is not a pin.** `defaults_samplerate` and `defaults_bitrate` are a per-family ceiling under the forced auto family, and `SetRate` writes the fixed slot, which is a different setting. The two are never equated, so neither limit field routes live.
5. **A flag is `0` or `1` by string.** A 0/1 field takes the two strings `0` and `1` and nothing else; `01` and `1.5` are refused, not parsed.
6. **A pin needs a configured chain.** A rate pin is refused unless the configured chain is PCM or SDM, because `[source]` ignores `SetRate`. The loaded chain does not settle it.
7. **A refusal names its cause, one per field.** A value that does not resolve is refused with one of these causes, and the wording for each cause has one home: not a 0/1 flag; not in the engine's live list of its enumeration; belongs to the chain the engine has not loaded; not a live setting; for a snapshot's mode, not `pcm` or `sdm`; for a matrix profile, not one the engine lists. The wording is owner copy and moves unchanged.

## Enforcement

- A gate refuses a module-level mapping or set keyed by field names outside the register's home.
- A gate refuses an iteration over an enumeration list outside the Engine view's home.
- The register's own tests are invariants over its rows: every field with a setter names a State attribute, every chain field names an enumeration, the realized config's fields are exactly the fields the table marks, and no forced field has a setter.
- Exemptions are owner-approved, site by site, as for every gate.
