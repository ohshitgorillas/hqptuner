# Matrix pipeline editing — design of record

The behavior HQPTuner owes on the matrix: profiles, pipelines, EQ import and the response plot. The daemon's matrix wire, its probe findings and the `Matrix*` commands are `docs/spec/protocol.md` §3.7 and §6; crossfeed compensation is `docs/spec/crossfeed-compensation.md`; layout is `docs/spec/faceplate-spec.md`.

**Headings are the citation contract.** Code cites this file by heading text, and `scripts/gates/check_doc_refs.py` fails the build when a cited heading vanishes. Reword a heading and update its citers in the same commit.

## Spec

### Speakers / headphones belongs to the preset

The speakers/headphones switch is a view selector, and it **binds to the preset, not to the browser**: which half a configuration is listened through is a property of that configuration, so the same preset opens the same way on the phone and on the desktop. hqplayerd's config has nowhere to carry it, since the daemon re-serializes configuration from its own model, so HQPTuner stores it keyed by preset **name** in one JSON file beside the descriptions (`HQPTUNER_MATRIX_MODE_FILE`, `GET`/`PUT /api/matrixmodes`). The storable values are `speakers` and `headphones` and nothing else; the strings are HQPTuner's, not the daemon's.

**The view follows the previewed preset while one is staged but not applied, and the active one otherwise**, because the preview is what is on screen. **A preset with no recorded mode leaves the view where it is**, falling back to the last-used mode in `localStorage`: nothing migrates existing presets, because "nobody has said" is not "this one is for speakers". The same fallback covers the case with no preset at all, where there is nothing to key a choice to and nothing is written.

**Every hand click records, including a click on the half already on screen (binding).** That click is how a preset with no recorded mode gets bound to the side it opened on; refusing it because nothing moved would leave the preset unrecorded forever. Nothing changed, so there is nothing to suppress or put back.

**Binding the view to a preset stages nothing (binding).** The hand-driven switch suppresses crossfeed on the way to speakers and restores it on the way back; a preset switch must not, because the preset carries its own pipelines and crossfeed in its own config, and suppression would stage edits over settings the preset already accounts for. Only the user's click suppresses and restores. A refused write leaves the switch where the user put it: a view choice costs nothing to be wrong about until the next reload.

### Profiles

A profile carries **Load**, **Save as new**, **Save** and **Delete**.

**Load rides 4321 `MatrixSetProfile` (live, no reload) and stages nothing.** A profile is the whole matrix context, `<post_process>` included (readme §1.11.2), so the switch already installs the rows and the plugin chain in the running engine; staging them too would pend a config write whose only effect at apply is an engine restart that changes nothing. A Load therefore lasts until the daemon restarts, which is HQPlayer's own semantics, and persisting the matrix is Save's job. The one profile with no live half is one the daemon never read (saved this session, not yet applied): staging is its only lane, and it stages the profile's rows and its `post_*` values both. The lane tag beside the picker says which half a Load gets: `live — no reload` for a profile the daemon read at startup, `stages — applies at next apply` for one saved but not applied.

Load and Switch are **one button**: they differ only in whether the choice persists, and a button that deliberately does not persist is not worth its own control.

**Save and Delete are staged `<matrix_profile>` edits on the restore lane**, so a saved profile lands in `hqplayerd.xml` and the daemon reads it at startup. HQPTuner writes the element itself, so a save to an existing name replaces it, and no delete-then-save recipe is needed. Save, Load and Delete cost **zero engine reloads**; the only restart is the apply the user chooses. The form lane carries no profile operation, because a profile saved through it does not persist (`docs/spec/protocol.md` "Saved matrix profiles do not persist").

**The live-active profile grounds the pipeline baseline (binding).** A switch is memory-only, so the config file keeps its own rows while the engine runs the profile's, the one case where file truth is not running truth. The pipeline baseline therefore takes the daemon's `/matrix` rows whenever `live_active` names a profile, and the file otherwise (and as the fallback when the daemon reported no rows). The editor and the matrix graph show what is playing, and an edit stages its diff against that; otherwise a Load leaves the user reading the config's EQ curve and pipelines while a different profile plays.

**A load through `/matrix/load` keeps the post-process the user had.** That route replaces the whole matrix context (`docs/spec/protocol.md` "Matrix form lane"), so HQPTuner snapshots the form's `post_*` slice, wire-encoded with the checkbox contract intact, re-applies it with a plain `POST /matrix` once the load settles, and verifies by readback past the reload transient.

**A profile without a chain gets the running chain at apply.** Switching to a chain-less profile installs an empty chain (`docs/spec/protocol.md` "Matrix profile commands"), so every stored profile with no `<post_process>` is filled from the live `<matrix>` when a config is applied: the applied config from its own matrix, stored presets from theirs. A profile that already carries a chain is never overwritten; that chain is the user's saved choice.

### Profile descriptions

A profile name is a filename-shaped thing and the conditions a filter set was measured under are not, so a profile carries a user-written description beside it: room, mic, target, date. **It is not in the config XML and cannot be**: `<matrix_profile>` carries exactly one attribute, `name` (readme §1.12), and the daemon re-serializes profiles from its own model at startup, so an attribute of ours would not survive. HQPTuner stores it in one JSON file beside the favorites (`HQPTUNER_DESCRIPTION_FILE`), keyed by profile **name**, the stable join key of architecture §3.1 and the same rule favorites follow for filter names.

**The description binds to the profile in focus: the Save-as name when there is one, and the picker's selection otherwise.** The moment a description exists in the user's head is the moment they are naming the profile, so the box has to be reachable then; a save moves the picker onto the new name as the name field clears, which keeps the text on screen standing for the same profile. `[Default]` takes none: it has no name to key one by, so the box is present, disabled, and says which of the two to do first. Writes are queued and drain on a pause, on blur and on unmount; a box that unmounts flushes on the way out, because blur alone loses the paragraph. **The box is a draft, never bound to stored text**, since the config poll refreshes every two seconds and would otherwise rewrite it mid-sentence. A failed write keeps the text queued rather than reverting the box: what the user typed is the thing being protected.

**Descriptions ride the backup archive** as one member, `hqptuner/descriptions.json`. `GET /api/backup` adds it, and `POST /api/restore` takes it out and merges it before the archive reaches hqplayerd, so the daemon never sees a member it did not write. A name in both takes the archive's, a restore being the thing that should win. This is the only lane that carries descriptions between installs.

**A carried payload is refused by its envelope and cleaned by its entries (binding).** Bytes that are not readable JSON, or that are not a descriptions store at all, are refused whole and change nothing, which is the case the user needs telling about. An entry inside a readable store that is not storable is dropped on the way in and the rest merges, exactly as a corrupt entry in the store's own file is dropped rather than raising. Refusing a whole archive over one malformed row would cost the user every other description in it, and the two roads into the store must not disagree about the same bytes.

### Pipeline flow rows

Each pipeline is one row: source channel, its ordered stages, its gain, and its target channel. Rows are grouped by target so summing is visible, and the section header shows the active and maximum count. Source and target cover wire values 0–127, shown as 1–128 ("In n" / "Out n"). Gain ships in **dB and Lin**, negative Lin included for polarity inversion. Clearing a chain empties its process chain and resets its gain to 0 dB while keeping its routing. Edits stage through the ordinary apply lane.

### Stage editor

Selecting a stage opens an inline editor for it, never a modal. It has plugin-specific fields for all 11 IIR types (the raw biquad's `b0`..`a2` included), `delay` (`s`/`t`/`d`/`v`), `riaa`, and convolution (a file upload per stage, with the filename shown and a warning when the sample rate departs from the 352.8 kHz recommendation). The generated raw spec string shows live, and a toggle flips the whole row between the stage view and the editable raw comma-string. The two stay synced: stages regenerate on blur, and a parse error shows inline without destroying the string. Specs are emitted case-sensitively, per manual §7.

**Round-trip contract (binding):** every example string in the stock manual round-trips string → stages → string **byte-identical**, and invalid raw input never crashes the row or silently drops stages; an unparseable chain is kept verbatim and flagged inline.

### AutoEq / REW import

The vendored AutoEq library and a `.txt` file both parse into ParametricEQ stages, appended to the chosen pipeline or mirrored to a stereo pair in one step. A `Preamp:` line maps to the pipeline's gain. The library loads lazily on first open, and closing it clears its selection and preview.

**Mirroring is per lane (binding).** The mirror checkbox governs only the lanes beside it, the `.txt` load and a row's **Import EQ**, and defaults on for headphones and off for speakers, each mode holding its own value. The library lane always mirrors, a headphone profile having no one-ear form. Each lane reports in its own place, so a lane never writes into a surface the click did not come from.

**The vendored library** is built by `scripts/build_autoeq_db.py` from a blob-filtered sparse checkout of `ParametricEQ.txt` only (~35 MB, not multi-GB) from jaakkopasanen/AutoEq, **pinned by sha in the blob's meta**. The pin is **current master, not a release tag**: upstream's last release, v4.0.0, is from 2023 and its results have moved since, and pinning master means the database only ever holds what upstream ships now. The rebuild is deterministic (sorted entries, zeroed gzip mtime). `GET /api/autoeq` serves it pre-gzipped with `Content-Encoding`. Upstream's MIT license is vendored beside it and linked from the picker's credit line. Search ranks token matches at the start, then at a word boundary, then mid-word, prefers oratory1990 on ties, always shows the source rather than merging, and caps at 40 hits with a visible "…N more". Applying a library profile routes its verbatim text through the same import path as a pasted one, so the two lanes are identical by construction.

### Response plot

The response plot is always present; with nothing toggled it draws its axes and says how to plot a pipeline. It overlays magnitude (solid, dB, auto-fit to ±36) and phase (dashed, ±180° on a second axis) for each toggled row, on a log frequency axis from 20 Hz to 20 kHz, one hue per row. It is computed client-side, and a convolution stage uses a client-side FFT of its uploaded impulse, since the daemon renders no plot (`docs/spec/protocol.md` "`/matrix/plot` as a numeric oracle"). It updates live while a stage field changes. An AutoEq preview draws as a dashed accent trace labelled "preview", for A/B against the plotted rows.

### Filter upload

`POST /api/matrix/filter` parks an uploaded filter and the next apply carries it to the daemon as a `data/` member of the restore archive (`docs/spec/protocol.md` "Matrix filter upload"). The route refuses (422 `invalid_input`):

- an upload over `HQPTUNER_FILTER_MAX_BYTES`;
- a name that is not a plain `.wav` or `.txt` filename: no path, no `,` `:` `;` (the `process` attribute parses those), no control bytes;
- a `.wav` that is not a RIFF/WAVE container with `fmt ` and `data` chunks;
- a `.txt` that is not UTF-8 text;
- any upload that would take the park over 256 MiB between applies.

### Visual checks

Visual work on the matrix measures against **both** the live daemon state **and** a 16-row, 8-stage worst-case mock served by intercepting `/api/matrix`.
