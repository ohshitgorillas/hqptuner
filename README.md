# HQPTuner: an improved configuration interface for HQPlayer Embedded

A free, polished, and enhanced web UI for HQPlayer Embedded's settings — filters, modulators, rates, volume, matrix pipelines, and hardware acceleration — with the manual's knowledge at your fingertips.

<img width="1202" height="1303" alt="HQPTuner's Output tab during DSD512 playback" src="https://github.com/user-attachments/assets/3b1cf017-d33f-4378-84f3-98f05975649e" />

*The Output tab during DSD512 playback: live signal path across the top, Backend / Mode / Rate master switches, and every setting explained in place.*

## Inspiration

HQPlayer is, in my humble opinion, the best deal in all of high-end digital audio, with two caveats:
1. You may go broke trying to afford CPUs and GPUs to feed it the power it craves.
2. The UI is bad.

The second point is the inspiration for HQPTuner. It's not just that the default UI is poorly organized with zero aesthetic appeal, but that I saw so much untapped potential. And let's be honest: HQPlayer is a complex program that takes time to learn. A bad UI doesn't just frustrate experienced users, it holds newbies back. HQPTuner's mission is to demystify and enhance the HQPlayer experience as much as possible. It's a UI that both newbies and experts should be able to use with ease.

Let's take filter narrowing as an example—HQPTuner's #1 flagship feature, and the one thing most badly missing from the stock UI.

The web interface presents you with four dropdowns: 1x and Nx filters, PCM and SDM, each populated by over 50 filters. To select one, you open the manual, read the descriptions, find one that seems appropriate, and go hunting for it in the dropdown. Say you're listening to Redbook content (16bit/44.1kHz): you probably want an apodizing filter to correct for errors. Which of the 50 are apodizing? The dropdown won't tell you. If you want the manual's information in the web UI, clicking "Help" takes you to another page with everything listed out rote-style for you to Ctrl+F through.

HQPTuner integrates all of the manual's knowledge directly into the interface, so filters can be narrowed by quality, genre, focus, phase, and length. A simple checkbox restricts the 1x lists to apodizing filters only. Rather than cross-referencing a PDF against a list of 50 items, you're down to a handful of relevant filters in a few clicks.

Filter narrowing is just one example, and the same philosophy runs through the whole project: every setting explained in place, every invalid option grayed out with the reason why. You shouldn't need the manual open in another window to figure out what you're doing in HQPlayer.

## Flagship features

**1. Filter narrowing.** The story above: the manual's knowledge folded into the filter lists, so 50 opaque names narrow to the 15–20 that fit your source material and taste — with each filter's description right under the dropdown.

**2. Headphone Auto EQ.** A built-in AutoEq library of 8850+ headphone models: search your headphones, A/B the correction curve against your current response, and load it into a stereo pipeline pair in one click. AutoEq/REW ParametricEQ text files import directly too, and every EQ band becomes a draggable dot on the live response plot — tune by ear, REW-style, without leaving the page.

**3. Crossfeed, two ways.** HQPlayer ships Bauer crossfeed (libbs2b): a three-preset model with a crossover frequency and a level in dB, which are coefficients of its own filter rather than anything you can picture. HQPTuner keeps it, adds the compensation nobody else offers, and then offers an alternative built from the physics instead.

*Bauer + compensation.* Crossfeed dulls centered sound — vocals, bass, most of the mix — by ~1–2.7 dB toward the treble. The polished implementations (Goodhertz CanOpener, Meier) build compensation into their own DSP; Bauer has no such option. HQPTuner compensates it from the outside: it reads your configured crossfeed parameters, generates matched inverse EQ stages (verified against the bs2b source), and compiles your headphone EQ into a mid/side pipeline block correcting exactly the center coloration while leaving the stereo width effect untouched. Strength slider, live correction plot, a "what you hear" overlay, and staleness detection with one-click rebuild.

*Structural crossfeed.* A second implementation modelling an actual head and an actual pair of speakers, from Brown & Duda's structural HRTF model. Three controls, all quantities you can picture: **speaker angle**, **head circumference** (measured with a tape, the way hat sizes are — the radius the model uses is shown beneath), and **center character**. It compiles to sixteen matrix pipelines carrying an explicit interaural delay and a head-shadow filter; the shadow filter factors exactly into a flat row plus a first-order lowpass, so nothing is numerically fitted and nothing is sample-rate-bound.

Center character is the control with no hardware equivalent, and it exists because of what the model measures. Real speakers don't just dull centered sound — they notch it: at 30° the center response has an 11.6 dB dip at 1426 Hz, straight through vocal presence. That is genuinely what a speaker pair does, but a room fills the null with reflections and headphones reproduce it bare. The control scales that coloration continuously from literal to none, and the stereo image is byte-identical at every setting — only centered tone changes. Presets take their values from the measured curve rather than by feel (Standard 30°/70%, Anechoic 30°/100%, Intimate 22°/70%, Wide 45°/50%, Neutral center 30°/0%); head size is excluded from presets and persists across them, being anatomy rather than taste. Your headphone EQ rides through untouched, per ear, so asymmetric measured corrections are carried rather than refused. Derivation and measurements: `docs/crossfeed-math.md`.

## Benefits of HQPTuner

HQPTuner is an improvement over the stock web configuration UI in many ways:

* **More sensible organization**: Settings are organized into five tabs: Output, Volume, Resampling, DSP, and System.
* **Easier rate selection**: No more memorizing raw Hz values: select, e.g., PCM 4x or DSD512 from the rate selection menu.
* **Every feature has a description**: All of the information from the manual is optionally surfaced with explanations and descriptions for every feature and filter.
* **Smart option availability**: Only see options that are appropriate for the settings you've selected; e.g., PCM options gray out/collapse in SDM output mode, DSD options in PCM mode, and modulators below their minimum rate — each grayed control carries a caption explaining why.
* **Full matrix pipeline editing**: Visual signal-flow editing of matrix pipelines, with a stage editor for every plugin type, headphone EQ import, and live response plots. See below.
* **Live response plots**: Crossfeed, loudness, and matrix pipelines all render their frequency response as you adjust them — and EQ bands are draggable dots right on the plot, REW-style.
* **Live volume control**: For those who rely on HQPlayer for volume adjustment.
* **Exposes more options**: Critical hardware acceleration options like multicore DSP, CUDA mode, and E-core modes are all exposed and explained.
* **Consistent behavior**: No unexpected profile switches or surprise default profile loads; HQPTuner always comes back with the settings you sent.
* **Log tail in the browser**: The daemon's log, right in the System tab.

## Matrix pipeline editing

The Matrix tab replaces hqplayerd's `/matrix` page with a visual pipeline editor:

* **Signal-flow rows**: each pipeline renders as source channel → stage chips → gain → target channel. Add, remove, and drag-reorder stages; add and remove pipelines; clear a row's chain with one click. Everything stages client-side and applies atomically.
* **Stage editor**: click a chip to edit it inline — all 11 IIR types (including raw biquad coefficients), delay, RIAA, and per-stage convolution with file upload (sample-rate warning included). A footer shows the generated raw spec string live, and the whole row can flip to an editable raw comma-string with two-way sync — the manual's example strings round-trip byte-identical.
* **EQ import**: paste or upload AutoEq / REW ParametricEQ text; preamp lines map to pipeline gain, and stereo mirroring targets an adjacent channel pair in one step. Or skip the file entirely and load a profile straight from the built-in AutoEq library with search and A/B preview.
* **Response card**: overlaid magnitude + phase for any plot-toggled pipelines, computed client-side (RBJ biquads, analytic RIAA, FFT of uploaded convolution impulses) and validated numerically against an independent reference. Gain-carrying EQ stages appear as draggable dots — drag to retune frequency and gain, with stereo pairs kept in sync.
* **Matrix profiles**: switch profiles live over the Control API (no restart, playback undisturbed); save-as-new and delete via the config lane. Plain overwrite-save is deliberately absent — the daemon's own `/matrix/save` to an existing name is a silent no-op, so the honest overwrite recipe is delete-then-save.
* **Crossfeed**: one card, two implementations behind a Bauer | Structural toggle. Bauer is HQPlayer's own, with the mid/side compensation block described above. Structural is sixteen pipelines modelling a head and a speaker pair, with an explicit interaural delay, a live top-down geometry diagram, and computed readouts for ear-to-ear delay, far-ear treble and center shift. Both compile to literal, badged, hand-editable pipelines — an edit that breaks the pattern drops the badge rather than being blocked or rewritten.

Known limits: convolution stages plot only when their impulse file was uploaded in the current session (the daemon offers no way to read impulses back); editing the same config from HQPTuner and the stock `/matrix` page at the same instant is unsupported (the stock page always submits its complete form and will silently revert concurrent edits — a daemon-level limitation).

<img width="1213" height="1885" alt="HQPTuner's Matrix tab with EQ pipelines, the AutoEq library, and the response plot" src="https://github.com/user-attachments/assets/7a3d8e53-46c8-49dd-a5a4-7403a6aa352a" />

*The Matrix tab: a stereo pair of 10-band EQ pipelines with the inline stage editor open, the built-in AutoEq library previewing a Sennheiser HD 650 profile against the current curve, and draggable EQ dots on the response plot.*

## Drawbacks of HQPTuner

While it should cover 95% of use cases, this is **not** a full-featured configuration interface.

Unavailable features:
* Media metadata and controls
* Library management
* The standalone convolution engine page (convolution *within* matrix pipelines is fully supported)

Furthermore, to maintain "friendly" output rate options, the "Auto-rate family" option is always forced and only the most common output rates (multiples of 44.1k and 48k) are available.

**HQPlayer Embedded only.** HQPlayer Desktop has no web interface — the port-8088 configuration lane HQPTuner depends on doesn't exist there.

## How it works

HQPTuner is a single small Python backend plus a no-build-step web frontend. It talks to a running `hqplayerd` over two lanes:

* **Control API (TCP 4321)** — live, restart-free settings (filters, dither/modulator, mode, rate, volume, matrix profile switching) plus status and enumerations. The running engine is the sole authority for filter/modulator names and IDs; HQPTuner never trusts shipped lists.
* **HTTP configuration interface (TCP 8088, Digest auth)** — persistent settings. HQPTuner submits the daemon's own config form, and the daemon writes `hqplayerd.xml` itself and restarts (~10 s); HQPTuner rides out the restart and verifies every change by readback. Settings the form doesn't expose (CUDA offload, multicore DSP, E-core allocation, blocks/cycle) go through a backup → surgical XML edit → `/restore` cycle on the same lane.

Edits are staged in a pending-changes bar showing the live/restart split before you apply. Presets are full-config XML snapshots stored and managed by HQPTuner itself (the daemon's native profile subsystem proved unreliable), mirrored into the daemon's own config directory so the stock UI stays populated.

Descriptions, tooltips, and constraint data (e.g. each modulator's minimum rate) are extracted once from the HQPlayer manual into JSON and joined against the live engine's enumerations by name at runtime. The headphone EQ library is a pinned, vendored snapshot of [AutoEq](https://github.com/jaakkopasanen/AutoEq) (MIT).

## Requirements

* Python 3.12+
* A running HQPlayer **Embedded** daemon (developed and verified against 6.0.4; Desktop is not supported — see above)
* The hqplayerd management credential (set via `hqplayerd -u/-s` or the `/auth` page) — required for persistent-config writes and presets; read-only use and live settings work without it
* Same-host installation recommended (enables the log tail; the wire lanes themselves work over the network)

## Install & run

### Docker (recommended)

Grab [`compose.yaml`](compose.yaml) and start:

```sh
mkdir -p state   # backups + presets live here; create it first so it's owned by you
docker compose up -d
```

Credentials default to hqplayerd's stock management credential (`hqplayer` / `password`). If your daemon's auth was re-provisioned, put yours in a `.env` file next to the compose file:

```sh
printf 'HQPTUNER_HQP_USERNAME=<user>\nHQPTUNER_HQP_PASSWORD=<pass>\n' > .env
```

Then open `http://<serverIP>:8090`.

Images are published to `ghcr.io/ohshitgorillas/hqptuner` (amd64 + arm64) — `latest` tracks master, version tags track releases.

### From a clone (no Docker)

```sh
python3 -m venv .venv
.venv/bin/pip install -e .

.venv/bin/python -m hqptuner
# non-stock daemon credential:
# HQPTUNER_HQP_USERNAME=<user> HQPTUNER_HQP_PASSWORD=<pass> .venv/bin/python -m hqptuner
```

## Configuration reference

All knobs are environment variables (see `hqptuner/config.py`):

| Variable | Default | Purpose |
|---|---|---|
| `HQPTUNER_HQP_HOST` | `127.0.0.1` | hqplayerd host |
| `HQPTUNER_HQP_CONTROL_PORT` | `4321` | Control API port |
| `HQPTUNER_HQP_HTTP_PORT` | `8088` | hqplayerd web config port |
| `HQPTUNER_HQP_USERNAME` | `hqplayer` | Management username (Digest auth); default is hqplayerd's stock credential |
| `HQPTUNER_HQP_PASSWORD` | `password` | Management password; default is hqplayerd's stock credential |
| `HQPTUNER_HQP_HOME` | `/var/lib/hqplayer/home` | hqplayerd's data/home directory on the daemon host (uploaded convolution impulses land here) |
| `HQPTUNER_LISTEN_HOST` | `127.0.0.1` | HQPTuner bind address |
| `HQPTUNER_LISTEN_PORT` | `8090` | HQPTuner port |
| `HQPTUNER_POLL_INTERVAL` | `2.0` | Status poll cadence (s) |
| `HQPTUNER_ALARM_THRESHOLD` | `15.0` | Seconds unreachable before alarm |
| `HQPTUNER_REQUEST_TIMEOUT` | `5.0` | Per-request timeout (s) |
| `HQPTUNER_DATA_DIR` | packaged `hqptuner/data/` | Static metadata JSON |
| `HQPTUNER_BACKUP_DIR` | `backups/` | Pre-apply config backups |
| `HQPTUNER_PRESET_DIR` | `presets/` | HQPTuner-owned preset store |

## Development

Backend and frontend carry matching gate suites. Run `npm install` once alongside the venv — the JS tooling is dev-only and never ships.

* `make check` — everything below. Must be green before every commit.
* `make lint` — Python: ruff, black, xenon complexity, vulture, strict mypy, file-length and test-assertion checks.
* `make lint-js` — frontend, one-for-one with the above: eslint (ruff), prettier (black), `tsc --checkJs` (mypy), knip (vulture), file-length. The complexity ceiling is 10, matching `xenon --max-absolute B`.
* `make test` — offline Python suite (fake daemons speaking the real wire protocol).
* `make test-live` — adds `live`-marked tests; needs a reachable hqplayerd.
* `make test-js` — frontend suite on node's built-in runner. No browser, no bundler: a loader hook reads the importmap out of `index.html` so tests exercise the same vendored preact/htm the browser loads, and components render through `preact-render-to-string`.

Pre-commit runs both lint suites and the Python tests; the JS suite is `make check` only, to keep the commit path from carrying two full suites.

Design and reference docs:

* `outline.md` — design outline (architecture, UI, behavior rules)
* `roadmap.md` — phase plan and per-phase decisions
* `docs/protocol.md` — Control API + HTTP lane wire reference (derived from the official MIT-licensed `hqp-control` source, verified against a live daemon)
* `docs/matrix-spec.md` — matrix pipeline editing design of record, probe findings, delivery checklist
* `docs/settings-classification.md` — every setting tagged live vs restart
* `docs/testing.md` — binding testing policy

## Status

**Beta.** Backend and frontend are feature-complete and live-validated against hqplayerd 6.0.4, and Docker packaging is in. Testers welcome — especially advanced matrix users: pipeline setups beyond stereo EQ (multichannel routing, crossovers, per-stage convolution chains) have had far less real-world exercise than the rest of the app. Expect rough edges; back up your config (System → About → Backup) before experimenting. Bug reports with the raw pipeline strings involved are gold.

## License

[MIT](LICENSE). The Control API implementation is derived from Jussi Laako's official `hqp-control` utility source, itself MIT-licensed, with attribution. The vendored headphone EQ database is from [AutoEq](https://github.com/jaakkopasanen/AutoEq) (MIT).
